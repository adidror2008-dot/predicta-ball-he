import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { noteProviderResponse, sofascoreGate } from "@/lib/provider-gate.server";

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

  // Gate — provider pause + budget; one outgoing call, one token.
  const gate = await sofascoreGate("lineups");
  if (!gate.allowed) {
    budgetExhausted = true;
    return finish("skipped", gate.reason === "provider_paused" ? "provider paused" : "budget exhausted for category lineups");
  }

  // Single outgoing call. No retry.
  const res = await fetch(
    `https://${SOFASCORE_HOST}/api/v1/event/${matchExternalId}/lineups`,
    { headers: { "x-rapidapi-key": apiKey, "x-rapidapi-host": SOFASCORE_HOST } },
  );
  httpStatus = res.status;
  const body = await res.text();
  await noteProviderResponse(res.status, body);
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

export type BackfillMatchLineupsResult = {
  status: JobRunStatus;
  considered: number;
  processed: number;
  matches_with_ratings: number;
  ratings_upserted_total: number;
  budget_exhausted: boolean;
  job_run_error?: string;
};

/**
 * Batch backfill of player_ratings via the existing lineups fetcher.
 * No new data source; one outgoing call per match, budget-gated, no retries.
 */
export async function runBackfillMatchLineups({
  limit,
}: {
  limit?: number;
}): Promise<BackfillMatchLineupsResult> {
  const startedAt = new Date().toISOString();
  const cap = Math.max(1, Math.min(50, limit ?? 30));

  let considered = 0;
  let processed = 0;
  let matchesWithRatings = 0;
  let ratingsUpsertedTotal = 0;
  let budgetExhausted = false;

  const { data: rated } = await supabaseAdmin.from("player_ratings").select("match_id");
  const ratedSet = new Set((rated ?? []).map((r) => r.match_id));

  const { data: finished, error: finishedError } = await supabaseAdmin
    .from("matches")
    .select("id, external_id")
    .eq("source", SOURCE)
    .eq("status", "finished")
    .not("external_id", "is", null)
    .is("ratings_checked_at", null)
    .order("kickoff_at", { ascending: false })
    .limit(cap + ratedSet.size);

  const candidates = (finished ?? [])
    .filter((m) => !ratedSet.has(m.id))
    .slice(0, cap);
  considered = candidates.length;

  for (const candidate of candidates) {
    const result = await runFetchMatchLineups({
      matchExternalId: String(candidate.external_id),
      skipJobRun: true,
    });
    if (result.budget_exhausted) {
      budgetExhausted = true;
      break;
    }
    processed += 1;
    if (result.ratings_upserted > 0) {
      matchesWithRatings += 1;
      ratingsUpsertedTotal += result.ratings_upserted;
    }
    await supabaseAdmin
      .from("matches")
      .update({ ratings_checked_at: new Date().toISOString() })
      .eq("id", candidate.id);
  }

  const status: JobRunStatus = finishedError
    ? "failed"
    : considered === 0
      ? "skipped"
      : budgetExhausted
        ? "partial"
        : "success";

  let jobRunError: string | undefined;
  const { error: jobError } = await supabaseAdmin.from("job_runs").insert({
    job_name: "backfill-match-lineups",
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    status,
    result_metric: matchesWithRatings,
    result_detail: {
      considered,
      processed,
      matches_with_ratings: matchesWithRatings,
      ratings_upserted_total: ratingsUpsertedTotal,
      budget_exhausted: budgetExhausted,
    } as never,
    error: finishedError ? finishedError.message : null,
  });
  if (jobError) jobRunError = jobError.message;

  return {
    status,
    considered,
    processed,
    matches_with_ratings: matchesWithRatings,
    ratings_upserted_total: ratingsUpsertedTotal,
    budget_exhausted: budgetExhausted,
    ...(jobRunError ? { job_run_error: jobRunError } : {}),
  };
}
