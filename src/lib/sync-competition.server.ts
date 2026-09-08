import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { noteProviderResponse, sofascoreGate } from "@/lib/provider-gate.server";
import { fixtureStateFields } from "@/lib/catch-up/plan";

const SOFASCORE_HOST = "sportapi7.p.rapidapi.com";
const MAX_PAGES = 15;

export type SyncDirection = "next" | "last";
export type SyncMode = SyncDirection | "both";

export type DirectionStats = {
  pages_fetched: number;
  events_seen: number;
  matches_upserted: number;
  teams_upserted: number;
  stopped_reason: string;
};

export type SyncResult = {
  status: "success" | "partial" | "skipped" | "error";
  tournament_id: number;
  season_id: string | null;
  api_calls: number;
  teams_upserted: number;
  matches_upserted: number;
  directions: Partial<Record<SyncDirection, DirectionStats>>;
  legs_linked: number;
  message?: string;
};



function isQualifier(roundInfo: Record<string, any> | null | undefined): boolean {
  const text = `${roundInfo?.["slug"] ?? ""} ${roundInfo?.["name"] ?? ""}`.toLowerCase();
  return text.includes("qualif") || text.includes("prelim") || text.includes("play-off round");
}

export async function runSyncCompetition(data: {
  tournamentId: number;
  mode?: SyncMode;
  maxPages?: number;
}): Promise<SyncResult> {
  const tournamentId = data.tournamentId;
  const mode: SyncMode = data.mode ?? "both";
  const directions: SyncDirection[] =
    mode === "both" ? ["next", "last"] : [mode];
  const maxPages = Math.max(1, Math.min(Number(data.maxPages ?? MAX_PAGES), MAX_PAGES));
  const jobName = `sync-competition-${tournamentId}`;
  const apiKey = process.env["SPORTAPI_API_KEY"];
  const started = new Date().toISOString();

  let apiCalls = 0;
  const stats: Partial<Record<SyncDirection, DirectionStats>> = {};
  let teamsUpserted = 0;
  let matchesUpserted = 0;
  let legsLinked = 0;

  const finish = async (
    status: string,
    metric: number,
    detail: Record<string, any>,
    error?: string,
  ) => {
    await supabaseAdmin.from("job_runs").insert({
      job_name: jobName,
      started_at: started,
      finished_at: new Date().toISOString(),
      status,
      result_metric: metric,
      result_detail: detail as any,
      error: error ?? null,
    });
  };

  const fail = async (message: string): Promise<SyncResult> => {
    await finish("failed", 0, { tournament_id: tournamentId, mode, api_calls: apiCalls }, message);
    return {
      status: "error",
      tournament_id: tournamentId,
      season_id: null,
      api_calls: apiCalls,
      teams_upserted: 0,
      matches_upserted: 0,
      directions: stats,
      legs_linked: 0,
      message,
    };
  };

  if (!apiKey) return fail("SPORTAPI_API_KEY missing");

  const { data: comp } = await supabaseAdmin
    .from("competitions")
    .select("id, current_season_id, name_he")
    .eq("tournament_id", String(tournamentId))
    .maybeSingle();

  if (!comp) return fail(`competition row not found for tournament ${tournamentId}`);
  if (!comp.current_season_id) {
    return fail(
      `current_season_id is null for tournament ${tournamentId} — run discover-seasons first`,
    );
  }
  const seasonId = String(comp.current_season_id);

  // Provider pause + bulk budget; a paused provider fails closed like an empty budget.
  const takeBudget = async () => (await sofascoreGate("bulk")).allowed;

  const call = async (path: string) => {
    const res = await fetch(`https://${SOFASCORE_HOST}${path}`, {
      headers: { "x-rapidapi-key": apiKey, "x-rapidapi-host": SOFASCORE_HOST },
    });
    apiCalls += 1;
    const body = await res.text();
    await noteProviderResponse(res.status, body);
    let json: Record<string, any> | null = null;
    try {
      json = JSON.parse(body) as Record<string, any>;
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, body, json };
  };

  const teamIdCache = new Map<string, string>();
  const upsertTeam = async (team: Record<string, any> | undefined, counter: DirectionStats) => {
    if (!team?.["id"]) return null;
    const key = String(team["id"]);
    if (teamIdCache.has(key)) return teamIdCache.get(key)!;
    const { data: row, error } = await supabaseAdmin
      .from("teams")
      .upsert(
        {
          external_id: key,
          source: "sofascore",
          name_en: team["name"] ?? team["shortName"] ?? null,
          short_name: team["nameCode"] ?? team["shortName"] ?? null,
          country: team["country"]?.["name"] ?? null,
          fetched_at: new Date().toISOString(),
        },
        { onConflict: "external_id,source" },
      )
      .select("id")
      .maybeSingle();
    if (error || !row) return null;
    counter.teams_upserted += 1;
    teamsUpserted += 1;
    teamIdCache.set(key, row.id);
    return row.id;
  };

  let budgetExhausted = false;
  let hadHttpError = false;

  for (const direction of directions) {
    const counter: DirectionStats = {
      pages_fetched: 0,
      events_seen: 0,
      matches_upserted: 0,
      teams_upserted: 0,
      stopped_reason: "completed",
    };
    stats[direction] = counter;

    if (budgetExhausted) {
      counter.stopped_reason = "budget_exhausted_before_start";
      continue;
    }

    for (let page = 0; page < maxPages; page++) {
      if (!(await takeBudget())) {
        budgetExhausted = true;
        counter.stopped_reason = `budget_exhausted_at_page_${page}`;
        break;
      }

      const res = await call(
        `/api/v1/unique-tournament/${tournamentId}/season/${seasonId}/events/${direction}/${page}`,
      );

      if (res.status === 404) {
        counter.stopped_reason =
          direction === "last" ? "no_finished_matches_404" : "http_404";
        break;
      }
      if (!res.ok || !res.json) {
        hadHttpError = true;
        counter.stopped_reason = `http_${res.status}`;
        break;
      }

      counter.pages_fetched += 1;
      const events: Array<Record<string, any>> = res.json["events"] ?? [];
      counter.events_seen += events.length;

      for (const ev of events) {
        const homeId = await upsertTeam(ev["homeTeam"], counter);
        const awayId = await upsertTeam(ev["awayTeam"], counter);
        if (!homeId || !awayId) continue;

        const roundInfo = ev["roundInfo"] as Record<string, any> | undefined;
        const qualifier = isQualifier(roundInfo);
        const startTimestamp = ev["startTimestamp"];
        const previousLeg = ev["previousLegEventId"] != null ? String(ev["previousLegEventId"]) : null;

        const leg =
          previousLeg != null ? 2 : Number(ev["cupMatchesInRound"]) === 2 ? 1 : null;

        const venueName: string | null = ev["venue"]?.["stadium"]?.["name"] ?? null;

        // Status/scores are written only as far as the provider actually reports
        // them — a fixture page never regresses a stored result to null.
        const payload: Record<string, any> = {
          external_id: String(ev["id"]),
          source: "sofascore",
          competition_id: comp.id,
          home_team_id: homeId,
          away_team_id: awayId,
          kickoff_at: startTimestamp ? new Date(Number(startTimestamp) * 1000).toISOString() : null,
          time_confirmed: startTimestamp != null && ev["timeConfirmed"] === true,
          ...fixtureStateFields(ev),
          round: roundInfo?.["round"] != null ? String(roundInfo["round"]) : null,
          round_number: roundInfo?.["round"] != null ? Number(roundInfo["round"]) : null,
          round_name: roundInfo?.["name"] ?? null,
          is_qualifier: qualifier,
          stage: qualifier ? "qualification" : "main",
          leg,
          tie_key: ev["customId"] != null ? String(ev["customId"]) : null,
          previous_leg_external_id: previousLeg,
          aggregate_home: ev["aggregateHomeScore"] ?? null,
          aggregate_away: ev["aggregateAwayScore"] ?? null,
          fetched_at: new Date().toISOString(),
        };
        if (venueName) payload["venue"] = venueName;

        const { error } = await supabaseAdmin
          .from("matches")
          .upsert(payload, { onConflict: "external_id,source" });
        if (!error) {
          counter.matches_upserted += 1;
          matchesUpserted += 1;
        }
      }

      if (res.json["hasNextPage"] !== true) {
        counter.stopped_reason = "no_more_pages";
        break;
      }
      if (page === maxPages - 1) counter.stopped_reason = "page_cap_reached";
    }
  }

  // ---- second pass: link two-legged ties (SQL only, no API cost)
  const { data: legRows } = await supabaseAdmin
    .from("matches")
    .select("id, external_id, tie_key, previous_leg_external_id")
    .eq("competition_id", comp.id)
    .not("previous_leg_external_id", "is", null);

  for (const row of legRows ?? []) {
    const { data: first } = await supabaseAdmin
      .from("matches")
      .select("id")
      .eq("external_id", row.previous_leg_external_id!)
      .eq("source", "sofascore")
      .maybeSingle();
    if (!first) continue;
    const tieKey = row.tie_key ?? null;
    await supabaseAdmin.from("matches").update({ leg: 2, tie_key: tieKey }).eq("id", row.id);
    await supabaseAdmin.from("matches").update({ leg: 1, tie_key: tieKey }).eq("id", first.id);
    legsLinked += 1;
  }

  const status: SyncResult["status"] = budgetExhausted
    ? "partial"
    : hadHttpError
      ? "partial"
      : matchesUpserted > 0
        ? "success"
        : "skipped";

  await finish(status, matchesUpserted, {
    tournament_id: tournamentId,
    mode,
    season_id: seasonId,
    api_calls: apiCalls,
    teams_upserted: teamsUpserted,
    matches_upserted: matchesUpserted,
    legs_linked: legsLinked,
    directions: stats,
  });

  // Newly created teams get a Hebrew name in the same run; never breaks the sync.
  try {
    const { runTranslateTeamNames } = await import("@/lib/translate-team-names.server");
    await runTranslateTeamNames({ limit: 50 });
  } catch (e) {
    console.error("translate hook failed", e);
  }



  return {
    status,
    tournament_id: tournamentId,
    season_id: seasonId,
    api_calls: apiCalls,
    teams_upserted: teamsUpserted,
    matches_upserted: matchesUpserted,
    directions: stats,
    legs_linked: legsLinked,
  };
}
