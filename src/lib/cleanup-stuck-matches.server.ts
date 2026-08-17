import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SOFASCORE_HOST = "sportapi7.p.rapidapi.com";
const SOURCE = "sofascore";
const RECENT_WINDOW_MS = 4 * 60 * 60 * 1000;
/** Safety ceiling for the one-off individual detail lookups. */
const MAX_DETAIL_CALLS = 20;

export type CleanupResult = {
  status: "success" | "partial" | "failed" | "skipped";
  rows_found: number;
  group_recent: number;
  group_old: number;
  rows_resolved: number;
  rows_still_stuck: number;
  needs_review_flagged: number;
  api_calls_used: number;
  reason?: string;
};

type StuckMatch = {
  id: string;
  external_id: string | null;
  status: string | null;
  kickoff_at: string | null;
};

export async function runCleanupStuckMatches(options?: { dryRun?: boolean }): Promise<CleanupResult> {
  const startedAt = new Date().toISOString();
  const apiKey = process.env["SPORTAPI_API_KEY"];

  let apiCalls = 0;
  let resolved = 0;
  let needsReviewFlagged = 0;

  const takeBudget = async (category: "live" | "bulk") => {
    const { data: ok } = await supabaseAdmin.rpc("api_budget_take", {
      p_provider: SOURCE,
      p_category: category,
      p_count: 1,
    });
    return ok === true;
  };

  const call = async (path: string) => {
    apiCalls += 1;
    const res = await fetch(`https://${SOFASCORE_HOST}${path}`, {
      headers: {
        "x-rapidapi-key": apiKey!,
        "x-rapidapi-host": SOFASCORE_HOST,
      },
    });
    const json = res.ok ? ((await res.json()) as Record<string, any>) : null;
    return { ok: res.ok, statusCode: res.status, json };
  };

  const nowMs = Date.now();
  const { data: stuckRows, error: selectError } = await supabaseAdmin
    .from("matches")
    .select("id, external_id, status, kickoff_at")
    .neq("status", "finished")
    .lt("kickoff_at", new Date(nowMs).toISOString())
    .order("kickoff_at", { ascending: false });

  const stuck = (stuckRows ?? []) as StuckMatch[];
  const recent = stuck.filter((m) => m.kickoff_at != null && Date.parse(m.kickoff_at) > nowMs - RECENT_WINDOW_MS);
  const old = stuck.filter((m) => !recent.includes(m));

  const finish = async (
    status: CleanupResult["status"],
    reason?: string,
    error?: string,
  ): Promise<CleanupResult> => {
    const { count: afterCount } = await supabaseAdmin
      .from("matches")
      .select("id", { count: "exact", head: true })
      .neq("status", "finished")
      .lt("kickoff_at", new Date().toISOString());
    const stillStuck = afterCount ?? stuck.length - resolved;
    const detail = {
      rows_found: stuck.length,
      group_recent: recent.length,
      group_old: old.length,
      rows_resolved: resolved,
      rows_still_stuck: stillStuck,
      needs_review_flagged: needsReviewFlagged,
      api_calls_used: apiCalls,
      reason: reason ?? null,
    };
    await supabaseAdmin.from("job_runs").insert({
      job_name: "cleanup-stuck-matches",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status,
      result_metric: resolved,
      result_detail: detail as never,
      error: error ?? null,
    });
    return {
      status,
      rows_found: stuck.length,
      group_recent: recent.length,
      group_old: old.length,
      rows_resolved: resolved,
      rows_still_stuck: stillStuck,
      needs_review_flagged: needsReviewFlagged,
      api_calls_used: apiCalls,
      ...(reason ? { reason } : {}),
    };
  };

  if (selectError) return finish("failed", "select_failed", selectError.message);
  if (!apiKey) return finish("failed", "SPORTAPI_API_KEY missing");
  if (stuck.length === 0) return finish("success", "nothing_stuck");
  if (options?.dryRun) return finish("skipped", "dry_run");
  if (old.length > MAX_DETAIL_CALLS) return finish("skipped", "too_many_old_matches");

  const applyEvent = async (m: StuckMatch, ev: Record<string, any>) => {
    const type = ev["status"]?.["type"] as string | undefined;
    const homeScore = ev["homeScore"]?.["current"];
    const awayScore = ev["awayScore"]?.["current"];
    // Never invent a final state: only write when the API actually reports one.
    const hasRealState = typeof type === "string" && type.length > 0;
    if (!hasRealState) {
      await supabaseAdmin.from("matches").update({ needs_review: true }).eq("id", m.id);
      needsReviewFlagged += 1;
      return;
    }
    const isStillOpen = type !== "finished";
    const update: Record<string, any> = {
      status: type,
      fetched_at: new Date().toISOString(),
    };
    if (typeof homeScore === "number") update["home_score"] = homeScore;
    if (typeof awayScore === "number") update["away_score"] = awayScore;
    if (type === "finished") update["minute"] = null;
    // Still not final even though kickoff passed -> keep it on the retry list.
    if (isStillOpen) {
      update["needs_review"] = true;
      needsReviewFlagged += 1;
    }
    const kickoffTs = ev["startTimestamp"];
    if (typeof kickoffTs === "number") {
      const apiKickoff = new Date(kickoffTs * 1000).toISOString();
      if (m.kickoff_at == null || Math.abs(Date.parse(m.kickoff_at) - Date.parse(apiKickoff)) > 60_000) {
        update["kickoff_at"] = apiKickoff;
      }
    }
    const { error } = await supabaseAdmin.from("matches").update(update as never).eq("id", m.id);
    if (!error) resolved += 1;
  };

  let budgetBlocked = false;

  // ---- Group (a): one single global live call covers every recently kicked-off match.
  if (recent.length > 0) {
    if (!(await takeBudget("live"))) {
      budgetBlocked = true;
    } else {
      const res = await call("/api/v1/sport/football/events/live");
      const events = (res.json?.["events"] ?? []) as Record<string, any>[];
      const byExternal = new Map(events.map((e) => [String(e["id"]), e]));
      for (const m of recent) {
        const ev = m.external_id ? byExternal.get(String(m.external_id)) : undefined;
        if (!ev) {
          await supabaseAdmin.from("matches").update({ needs_review: true }).eq("id", m.id);
          needsReviewFlagged += 1;
          continue;
        }
        const type = ev["status"]?.["type"] as string | undefined;
        const update: Record<string, any> = {
          status: type ?? m.status,
          home_score: ev["homeScore"]?.["current"] ?? null,
          away_score: ev["awayScore"]?.["current"] ?? null,
          live_source: SOURCE,
          fetched_at: new Date().toISOString(),
        };
        const { error } = await supabaseAdmin.from("matches").update(update as never).eq("id", m.id);
        if (!error) resolved += 1;
      }
    }
  }

  // ---- Group (b): individual detail lookups, one call per match.
  if (!budgetBlocked) {
    for (const m of old) {
      if (!m.external_id) {
        await supabaseAdmin.from("matches").update({ needs_review: true }).eq("id", m.id);
        needsReviewFlagged += 1;
        continue;
      }
      if (!(await takeBudget("live"))) {
        budgetBlocked = true;
        break;
      }
      const res = await call(`/api/v1/event/${m.external_id}`);
      const ev = res.json?.["event"] as Record<string, any> | undefined;
      if (!res.ok || !ev) {
        await supabaseAdmin.from("matches").update({ needs_review: true }).eq("id", m.id);
        needsReviewFlagged += 1;
        continue;
      }
      await applyEvent(m, ev);
    }
  }

  return finish(budgetBlocked ? "partial" : "success", budgetBlocked ? "budget_blocked" : undefined);
}
