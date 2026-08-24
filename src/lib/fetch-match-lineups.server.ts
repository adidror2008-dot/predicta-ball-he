import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SOFASCORE_HOST = "sportapi7.p.rapidapi.com";
const SOURCE = "sofascore";

export type JobRunStatus = "success" | "partial" | "failed" | "skipped";

export type FetchMatchLineupsResult = {
  status: JobRunStatus;
  match_external_id: string;
  match_id: string | null;
  http_status: number | null;
  confirmed: boolean | null;
  players_upserted: number;
  lineups_upserted: number;
  ratings_upserted: number;
  budget_exhausted: boolean;
  message?: string;
  job_run_error?: string;
};

type AnyRec = Record<string, any>;

/**
 * Lineups fetcher — the single owner of players row creation.
 * Players are always upserted on unique(external_id, source); never blind-inserted.
 */
export async function runFetchMatchLineups(data: {
  matchExternalId: string;
  skipJobRun?: boolean;
}): Promise<FetchMatchLineupsResult> {
  const skipJobRun = data.skipJobRun === true;
  const startedAt = new Date().toISOString();
  const matchExternalId = String(data.matchExternalId);
  const apiKey = process.env["SPORTAPI_API_KEY"];

  let matchId: string | null = null;
  let httpStatus: number | null = null;
  let confirmed: boolean | null = null;
  let playersUpserted = 0;
  let lineupsUpserted = 0;
  let ratingsUpserted = 0;
  let budgetExhausted = false;

  // Writes exactly ONE job_runs row at the end of the run.
  const report = async (
    status: JobRunStatus,
    metric: number,
    error?: string,
  ): Promise<string | undefined> => {
    if (skipJobRun) return undefined;
    const { error: jobError } = await supabaseAdmin.from("job_runs").insert({
      job_name: "fetch-match-lineups",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status,
      result_metric: metric,
      result_detail: {
        match_external_id: matchExternalId,
        match_id: matchId,
        http_status: httpStatus,
        confirmed,
        players_upserted: playersUpserted,
        lineups_upserted: lineupsUpserted,
        ratings_upserted: ratingsUpserted,
        budget_exhausted: budgetExhausted,
      } as never,
      error: error ?? null,
    });
    if (jobError) {
      console.error(
        `[fetch-match-lineups] job_runs insert failed: ${jobError.message}`,
        jobError,
      );
      return jobError.message;
    }
    return undefined;
  };

  const finish = async (
    status: JobRunStatus,
    message?: string,
  ): Promise<FetchMatchLineupsResult> => {
    const jobRunError = await report(status, lineupsUpserted, message);
    return {
      status,
      match_external_id: matchExternalId,
      match_id: matchId,
      http_status: httpStatus,
      confirmed,
      players_upserted: playersUpserted,
      lineups_upserted: lineupsUpserted,
      ratings_upserted: ratingsUpserted,
      budget_exhausted: budgetExhausted,
      ...(message ? { message } : {}),
      ...(jobRunError ? { job_run_error: jobRunError } : {}),
    };
  };

  if (!apiKey || apiKey.trim() === "") {
    return finish("failed", "missing SPORTAPI_API_KEY");
  }

  // Step 0 — resolve internal match id. Never create a match here.
  const { data: match, error: matchError } = await supabaseAdmin
    .from("matches")
    .select("id, home_team_id, away_team_id")
    .eq("external_id", matchExternalId)
    .eq("source", SOURCE)
    .maybeSingle();

  if (matchError) return finish("failed", matchError.message);
  if (!match) return finish("skipped", `match ${matchExternalId} not found in matches`);
  matchId = match.id;

  // Budget gate — one outgoing call, one token.
  const { data: allowed, error: budgetError } = await supabaseAdmin.rpc("api_budget_take", {
    p_provider: SOURCE,
    p_category: "lineups",
    p_count: 1,
  });
  if (budgetError) return finish("failed", `budget: ${budgetError.message}`);
  if (allowed !== true) {
    budgetExhausted = true;
    return finish("skipped", "budget exhausted for category lineups");
  }

  // Single outgoing call. No retry.
  const res = await fetch(
    `https://${SOFASCORE_HOST}/api/v1/event/${matchExternalId}/lineups`,
    { headers: { "x-rapidapi-key": apiKey, "x-rapidapi-host": SOFASCORE_HOST } },
  );
  httpStatus = res.status;
  const body = await res.text();
  if (!res.ok) {
    return finish("failed", `lineups http ${res.status}: ${body.slice(0, 200)}`);
  }

  let json: AnyRec;
  try {
    json = JSON.parse(body) as AnyRec;
  } catch {
    return finish("failed", "lineups response is not valid JSON");
  }

  confirmed = json["confirmed"] === true;

  // Resolve team external ids -> internal uuids.
  const teamMap = new Map<string, string>();
  {
    const { data: teams } = await supabaseAdmin
      .from("teams")
      .select("id, external_id")
      .eq("source", SOURCE)
      .not("external_id", "is", null);
    for (const t of teams ?? []) teamMap.set(String(t.external_id), t.id);
  }

  const sides: Array<{ key: "home" | "away"; side: AnyRec }> = [];
  if (json["home"]) sides.push({ key: "home", side: json["home"] as AnyRec });
  if (json["away"]) sides.push({ key: "away", side: json["away"] as AnyRec });

  type Draft = {
    external_id: string;
    name_en: string | null;
    position: string | null;
    shirt_number: number | null;
    team_id: string | null;
    is_starting: boolean;
    formation: string | null;
    sort_order: number;
    rating: number | null;
  };
  const drafts: Draft[] = [];

  for (const { key, side } of sides) {
    const formation = side["formation"] != null ? String(side["formation"]) : null;
    const fallbackTeamId = key === "home" ? match.home_team_id : match.away_team_id;
    const sidePlayers = (side["players"] as AnyRec[] | undefined) ?? [];
    for (let idx = 0; idx < sidePlayers.length; idx += 1) {
      const entry = sidePlayers[idx] as AnyRec;
      const p = (entry["player"] ?? {}) as AnyRec;
      if (p["id"] == null) continue;
      const rawRating = (entry["statistics"] as AnyRec | undefined)?.["rating"];
      const rating =
        rawRating === null || rawRating === undefined || Number.isNaN(Number(rawRating))
          ? null
          : Number(rawRating);
      const teamExternalId = entry["teamId"] != null ? String(entry["teamId"]) : null;
      const teamId =
        (teamExternalId ? teamMap.get(teamExternalId) : undefined) ?? fallbackTeamId ?? null;
      const shirt = entry["shirtNumber"] ?? p["jerseyNumber"] ?? null;
      drafts.push({
        external_id: String(p["id"]),
        name_en: (p["name"] ?? p["shortName"] ?? null) as string | null,
        position: (entry["position"] ?? p["position"] ?? null) as string | null,
        shirt_number: shirt != null ? Number(shirt) : null,
        team_id: teamId,
        is_starting: entry["substitute"] !== true,
        formation,
        sort_order: idx,
        rating,
      });
    }
  }

  // Lineup not published yet — legitimate, not a failure.
  if (drafts.length === 0) {
    return finish("success", "no lineup players returned (lineup not published)");
  }

  const now = new Date().toISOString();

  const { data: savedPlayers, error: playersError } = await supabaseAdmin
    .from("players")
    .upsert(
      drafts.map((d) => ({
        external_id: d.external_id,
        source: SOURCE,
        name_en: d.name_en,
        position: d.position,
        shirt_number: d.shirt_number,
        team_id: d.team_id,
        fetched_at: now,
      })),
      { onConflict: "external_id,source" },
    )
    .select("id, external_id");
  if (playersError) return finish("failed", `players: ${playersError.message}`);
  playersUpserted = savedPlayers?.length ?? 0;

  const playerMap = new Map<string, string>();
  for (const p of savedPlayers ?? []) playerMap.set(String(p.external_id), p.id);

  const lineupRows = drafts
    .map((d) => {
      const playerId = playerMap.get(d.external_id);
      if (!playerId) return null;
      return {
        match_id: matchId as string,
        team_id: d.team_id,
        player_id: playerId,
        is_starting: d.is_starting,
        position: d.position,
        shirt_number: d.shirt_number,
        formation: d.formation,
        sort_order: d.sort_order,
        fetched_at: now,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (lineupRows.length > 0) {
    const { error: lineupsError } = await supabaseAdmin
      .from("lineups")
      .upsert(lineupRows, { onConflict: "match_id,player_id" });
    if (lineupsError) return finish("partial", `lineups: ${lineupsError.message}`);
    lineupsUpserted = lineupRows.length;
  }

  const ratingRows = drafts
    .filter((d) => d.rating !== null && playerMap.has(d.external_id))
    .map((d) => ({
      match_id: matchId as string,
      player_id: playerMap.get(d.external_id) as string,
      rating: d.rating as number,
      source: SOURCE,
      fetched_at: now,
    }));

  if (ratingRows.length > 0) {
    const { error: ratingsError } = await supabaseAdmin
      .from("player_ratings")
      .upsert(ratingRows, { onConflict: "match_id,player_id,source" });
    if (ratingsError) return finish("partial", `ratings: ${ratingsError.message}`);
    ratingsUpserted = ratingRows.length;
  }

  if (lineupRows.length < drafts.length) {
    return finish("partial", "some players could not be linked to lineup rows");
  }
  return finish("success");
}
