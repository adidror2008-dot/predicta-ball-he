import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SOFASCORE_HOST = "sportapi7.p.rapidapi.com";
const SOURCE = "sofascore";

export type JobRunStatus = "success" | "partial" | "failed" | "skipped";

export type MatchVenueOutcome = {
  match_id: string;
  home_team_external_id: string | null;
  venue: string | null;
  updated: boolean;
  error?: string;
};

export type FetchMatchVenuesResult = {
  status: JobRunStatus;
  matches_considered: number;
  matches_updated: number;
  api_calls: number;
  budget_exhausted: boolean;
  outcomes: MatchVenueOutcome[];
  message?: string;
  job_run_error?: string;
};

type TeamVenue = { name: string | null; city: string | null } | null;

/**
 * Backfills matches.venue. The provider's event payload carries no venue, but the
 * home team payload does (venue.stadium.name + venue.city.name), so the venue of a
 * non-neutral match is the home team's stadium. One API call per distinct home team.
 */
export async function runFetchMatchVenues(
  data: { limit?: number; matchExternalId?: string } = {},
): Promise<FetchMatchVenuesResult> {
  const startedAt = new Date().toISOString();
  const apiKey = process.env["SPORTAPI_API_KEY"];
  const limit = Math.max(1, Math.min(Number(data.limit ?? 100), 500));

  let matchesConsidered = 0;
  let matchesUpdated = 0;
  let apiCalls = 0;
  let budgetExhausted = false;
  const outcomes: MatchVenueOutcome[] = [];

  const finish = async (
    status: JobRunStatus,
    message?: string,
  ): Promise<FetchMatchVenuesResult> => {
    const { error: jobError } = await supabaseAdmin.from("job_runs").insert({
      job_name: "fetch-match-venues",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status,
      result_metric: matchesUpdated,
      result_detail: {
        matches_considered: matchesConsidered,
        matches_updated: matchesUpdated,
        api_calls: apiCalls,
        budget_exhausted: budgetExhausted,
        outcomes,
      } as never,
      error: message ?? null,
    });
    return {
      status,
      matches_considered: matchesConsidered,
      matches_updated: matchesUpdated,
      api_calls: apiCalls,
      budget_exhausted: budgetExhausted,
      outcomes,
      ...(message ? { message } : {}),
      ...(jobError ? { job_run_error: jobError.message } : {}),
    };
  };

  if (!apiKey || apiKey.trim() === "") return finish("failed", "missing SPORTAPI_API_KEY");

  let query = supabaseAdmin
    .from("matches")
    .select("id, external_id, home_team_id, is_neutral, venue")
    .eq("source", SOURCE)
    .is("venue", null)
    .eq("is_neutral", false)
    .not("home_team_id", "is", null)
    .limit(limit);
  if (data.matchExternalId) query = query.eq("external_id", String(data.matchExternalId));

  const { data: matches, error: matchesError } = await query;
  if (matchesError) return finish("failed", matchesError.message);
  matchesConsidered = matches?.length ?? 0;
  if (matchesConsidered === 0) return finish("skipped", "no matches missing venue");

  const teamIds = [
    ...new Set((matches ?? []).map((m) => m.home_team_id).filter((v): v is string => !!v)),
  ];
  const { data: teams, error: teamsError } = await supabaseAdmin
    .from("teams")
    .select("id, external_id")
    .in("id", teamIds);
  if (teamsError) return finish("failed", teamsError.message);
  const externalByTeamId = new Map((teams ?? []).map((t) => [t.id, t.external_id]));

  const venueCache = new Map<string, TeamVenue>();

  const loadVenue = async (teamExternalId: string): Promise<TeamVenue> => {
    if (venueCache.has(teamExternalId)) return venueCache.get(teamExternalId) ?? null;

    const { data: allowed, error: budgetError } = await supabaseAdmin.rpc("api_budget_take", {
      p_provider: SOURCE,
      p_category: "bulk",
      p_count: 1,
    });
    if (budgetError) throw new Error(`budget: ${budgetError.message}`);
    if (allowed !== true) {
      budgetExhausted = true;
      throw new Error("budget exhausted");
    }

    apiCalls += 1;
    const res = await fetch(`https://${SOFASCORE_HOST}/api/v1/team/${teamExternalId}`, {
      headers: { "x-rapidapi-key": apiKey, "x-rapidapi-host": SOFASCORE_HOST },
    });
    if (!res.ok) throw new Error(`team http ${res.status}`);

    const json = (await res.json()) as {
      team?: {
        venue?: {
          name?: string | null;
          city?: { name?: string | null } | null;
          stadium?: { name?: string | null } | null;
        } | null;
      };
    };
    const v = json.team?.venue ?? null;
    const parsed: TeamVenue = v
      ? { name: v.stadium?.name ?? v.name ?? null, city: v.city?.name ?? null }
      : null;
    venueCache.set(teamExternalId, parsed);
    return parsed;
  };

  for (const match of matches ?? []) {
    const teamExternalId = match.home_team_id
      ? (externalByTeamId.get(match.home_team_id) ?? null)
      : null;
    if (!teamExternalId) {
      outcomes.push({
        match_id: match.id,
        home_team_external_id: null,
        venue: null,
        updated: false,
        error: "home team has no external_id",
      });
      continue;
    }

    let venueParts: TeamVenue = null;
    try {
      venueParts = await loadVenue(String(teamExternalId));
    } catch (err) {
      outcomes.push({
        match_id: match.id,
        home_team_external_id: String(teamExternalId),
        venue: null,
        updated: false,
        error: err instanceof Error ? err.message : String(err),
      });
      if (budgetExhausted) break;
      continue;
    }

    const venue = venueParts
      ? [venueParts.name, venueParts.city].filter((p) => p && p.trim() !== "").join(" · ")
      : "";
    if (!venue) {
      outcomes.push({
        match_id: match.id,
        home_team_external_id: String(teamExternalId),
        venue: null,
        updated: false,
        error: "source has no venue",
      });
      continue;
    }

    const { error: updateError } = await supabaseAdmin
      .from("matches")
      .update({ venue })
      .eq("id", match.id);
    if (updateError) {
      outcomes.push({
        match_id: match.id,
        home_team_external_id: String(teamExternalId),
        venue,
        updated: false,
        error: `update: ${updateError.message}`,
      });
      continue;
    }

    matchesUpdated += 1;
    outcomes.push({
      match_id: match.id,
      home_team_external_id: String(teamExternalId),
      venue,
      updated: true,
    });
  }

  if (matchesUpdated === 0) return finish("failed", "no match venue was written");
  if (matchesUpdated < matchesConsidered) {
    return finish("partial", budgetExhausted ? "budget exhausted mid-run" : "some matches failed");
  }
  return finish("success");
}
