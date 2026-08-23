import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { PROVIDER_KEY_MAP, parseStatValue } from "@/lib/match-stats-keys";

const SOFASCORE_HOST = "sportapi7.p.rapidapi.com";
const SOURCE = "sofascore";
const DEFAULT_LIMIT = 10;

export type JobRunStatus = "success" | "partial" | "failed" | "skipped";

export type FetchMatchStatsResult = {
  status: JobRunStatus;
  matches_considered: number;
  matches_saved: number;
  rows_inserted: number;
  budget_exhausted: boolean;
  http_statuses: number[];
  message?: string;
  job_run_error?: string;
};

type AnyRec = Record<string, any>;

type MatchRow = {
  id: string;
  external_id: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
};

/**
 * Match statistics fetcher. Owns public.match_stats exclusively —
 * it never creates or touches teams / matches / players.
 * One outgoing call per match, gated by api_budget_take. No retries.
 */
export async function runFetchMatchStats(data: {
  matchExternalId?: string;
  limit?: number;
}): Promise<FetchMatchStatsResult> {
  const startedAt = new Date().toISOString();
  const apiKey = process.env["SPORTAPI_API_KEY"];

  let matchesConsidered = 0;
  let matchesSaved = 0;
  let rowsInserted = 0;
  let budgetExhausted = false;
  const httpStatuses: number[] = [];

  const finish = async (
    status: JobRunStatus,
    message?: string,
  ): Promise<FetchMatchStatsResult> => {
    let jobRunError: string | undefined;
    const { error: jobError } = await supabaseAdmin.from("job_runs").insert({
      job_name: "fetch-match-stats",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status,
      result_metric: matchesSaved,
      result_detail: {
        matches_considered: matchesConsidered,
        matches_saved: matchesSaved,
        rows_inserted: rowsInserted,
        budget_exhausted: budgetExhausted,
        http_statuses: httpStatuses,
      } as never,
      error: message ?? null,
    });
    if (jobError) jobRunError = jobError.message;
    return {
      status,
      matches_considered: matchesConsidered,
      matches_saved: matchesSaved,
      rows_inserted: rowsInserted,
      budget_exhausted: budgetExhausted,
      http_statuses: httpStatuses,
      ...(message ? { message } : {}),
      ...(jobRunError ? { job_run_error: jobRunError } : {}),
    };
  };

  if (!apiKey || apiKey.trim() === "") {
    return finish("failed", "missing SPORTAPI_API_KEY");
  }

  // Step 0 — pick candidates. Never create matches here.
  let candidates: MatchRow[] = [];
  if (data.matchExternalId) {
    const { data: match, error } = await supabaseAdmin
      .from("matches")
      .select("id, external_id, home_team_id, away_team_id")
      .eq("external_id", String(data.matchExternalId))
      .eq("source", SOURCE)
      .maybeSingle();
    if (error) return finish("failed", error.message);
    if (!match) return finish("skipped", `match ${data.matchExternalId} not found in matches`);
    candidates = [match];
  } else {
    const limit = Math.max(1, Math.min(50, data.limit ?? DEFAULT_LIMIT));
    const { data: existing, error: existingError } = await supabaseAdmin
      .from("match_stats")
      .select("match_id");
    if (existingError) return finish("failed", existingError.message);
    const withStats = new Set((existing ?? []).map((r) => r.match_id));

    const { data: finished, error: finishedError } = await supabaseAdmin
      .from("matches")
      .select("id, external_id, home_team_id, away_team_id")
      .eq("source", SOURCE)
      .eq("status", "finished")
      .not("external_id", "is", null)
      .order("kickoff_at", { ascending: false })
      .limit(limit + withStats.size);
    if (finishedError) return finish("failed", finishedError.message);
    candidates = (finished ?? []).filter((m) => !withStats.has(m.id)).slice(0, limit);
  }

  matchesConsidered = candidates.length;
  if (matchesConsidered === 0) return finish("skipped", "no candidate matches");

  let hadFailure = false;

  for (const match of candidates) {
    const externalId = match.external_id;
    if (!externalId) continue;

    const { data: allowed, error: budgetError } = await supabaseAdmin.rpc("api_budget_take", {
      p_provider: SOURCE,
      p_category: "bulk",
      p_count: 1,
    });
    if (budgetError) return finish("failed", `budget: ${budgetError.message}`);
    if (allowed !== true) {
      budgetExhausted = true;
      break;
    }

    // Single outgoing call per match. No retry.
    const res = await fetch(
      `https://${SOFASCORE_HOST}/api/v1/event/${externalId}/statistics`,
      { headers: { "x-rapidapi-key": apiKey, "x-rapidapi-host": SOFASCORE_HOST } },
    );
    httpStatuses.push(res.status);
    if (!res.ok) {
      hadFailure = true;
      continue;
    }

    let json: AnyRec;
    try {
      json = (await res.json()) as AnyRec;
    } catch {
      hadFailure = true;
      continue;
    }

    const periods = (json["statistics"] as AnyRec[] | undefined) ?? [];
    const all = periods.find((p) => String(p["period"]) === "ALL");
    if (!all) continue;

    const fetchedAt = new Date().toISOString();
    const seen = new Set<string>();
    const rows: {
      match_id: string;
      team_id: string | null;
      stat_key: string;
      stat_value: number;
      period: string;
      fetched_at: string;
    }[] = [];

    for (const group of (all["groups"] as AnyRec[] | undefined) ?? []) {
      for (const item of (group["statisticsItems"] as AnyRec[] | undefined) ?? []) {
        const canonical = PROVIDER_KEY_MAP[String(item["key"] ?? "")];
        if (!canonical || seen.has(canonical)) continue;
        const home = parseStatValue(item["home"]);
        const away = parseStatValue(item["away"]);
        if (home === null || away === null) continue;
        seen.add(canonical);
        if (match.home_team_id) {
          rows.push({
            match_id: match.id,
            team_id: match.home_team_id,
            stat_key: canonical,
            stat_value: home,
            period: "ALL",
            fetched_at: fetchedAt,
          });
        }
        if (match.away_team_id) {
          rows.push({
            match_id: match.id,
            team_id: match.away_team_id,
            stat_key: canonical,
            stat_value: away,
            period: "ALL",
            fetched_at: fetchedAt,
          });
        }
      }
    }

    if (rows.length === 0) continue;

    // No unique constraint on match_stats — clean replace keeps the run idempotent.
    const { error: delError } = await supabaseAdmin
      .from("match_stats")
      .delete()
      .eq("match_id", match.id);
    if (delError) {
      hadFailure = true;
      continue;
    }
    const { error: insError } = await supabaseAdmin.from("match_stats").insert(rows);
    if (insError) {
      hadFailure = true;
      continue;
    }
    matchesSaved += 1;
    rowsInserted += rows.length;
  }

  if (matchesSaved === 0 && hadFailure) return finish("failed", "no statistics saved");
  if (hadFailure || budgetExhausted) {
    return finish("partial", budgetExhausted ? "budget exhausted for category bulk" : undefined);
  }
  return finish("success");
}
