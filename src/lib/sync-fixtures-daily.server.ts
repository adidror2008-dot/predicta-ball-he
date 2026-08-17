import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runSyncCompetition, type SyncResult } from "@/lib/sync-competition.server";

export type SyncFixturesDailyResult = {
  status: "success" | "partial" | "failed" | "skipped";
  full: boolean;
  competitions: number;
  api_calls: number;
  matches_upserted: number;
  teams_upserted: number;
  results: Array<Pick<SyncResult, "tournament_id" | "status" | "api_calls" | "matches_upserted" | "teams_upserted" | "message">>;
};

/**
 * Daily: one page of upcoming fixtures per active competition (1 call each) —
 * catches kickoff time changes and newly added fixtures in the near window.
 * Weekly (full=true): the complete both-direction, all-pages run.
 */
export async function runSyncFixturesDaily(
  data: { full?: boolean } = {},
): Promise<SyncFixturesDailyResult> {
  const full = data.full === true;
  const startedAt = new Date().toISOString();

  const { data: comps, error } = await supabaseAdmin
    .from("competitions")
    .select("tournament_id")
    .eq("is_active", true)
    .not("tournament_id", "is", null)
    .order("sort_order", { ascending: true });

  const results: SyncFixturesDailyResult["results"] = [];
  let apiCalls = 0;
  let matchesUpserted = 0;
  let teamsUpserted = 0;

  for (const comp of comps ?? []) {
    const tournamentId = Number(comp.tournament_id);
    if (!Number.isFinite(tournamentId)) continue;
    const r = await runSyncCompetition(
      full
        ? { tournamentId, mode: "both" }
        : { tournamentId, mode: "next", maxPages: 1 },
    );
    apiCalls += r.api_calls;
    matchesUpserted += r.matches_upserted;
    teamsUpserted += r.teams_upserted;
    results.push({
      tournament_id: r.tournament_id,
      status: r.status,
      api_calls: r.api_calls,
      matches_upserted: r.matches_upserted,
      teams_upserted: r.teams_upserted,
      ...(r.message ? { message: r.message } : {}),
    });
  }

  const okCount = results.filter((r) => r.status === "success").length;
  const status: SyncFixturesDailyResult["status"] = error
    ? "failed"
    : results.length === 0
      ? "skipped"
      : okCount === results.length
        ? "success"
        : okCount > 0
          ? "partial"
          : "failed";

  await supabaseAdmin.from("job_runs").insert({
    job_name: full ? "sync-fixtures-weekly" : "sync-fixtures-daily",
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    status,
    result_metric: matchesUpserted,
    result_detail: {
      full,
      competitions: results.length,
      api_calls: apiCalls,
      matches_upserted: matchesUpserted,
      teams_upserted: teamsUpserted,
      results,
    } as never,
    error: error?.message ?? null,
  });

  return {
    status,
    full,
    competitions: results.length,
    api_calls: apiCalls,
    matches_upserted: matchesUpserted,
    teams_upserted: teamsUpserted,
    results,
  };
}
