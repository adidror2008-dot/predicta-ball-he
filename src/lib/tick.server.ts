import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { MatchSnapshot } from "@/lib/notifications.server";
import { noteProviderResponse, sofascoreGate } from "@/lib/provider-gate.server";
import type { CatchUpResult } from "@/lib/catch-up-matches.server";
import { buildScoreUpdate } from "@/lib/catch-up/plan";

const SOFASCORE_HOST = "sportapi7.p.rapidapi.com";
const SOURCE = "sofascore";

/** status.type values that mean the match will not change any more. */
const FINAL_STATUS_TYPES = ["finished", "canceled", "postponed", "awarded", "removed"];

const ACTIVE_WINDOW_BEFORE_MS = 4 * 60 * 60 * 1000;
const ACTIVE_WINDOW_AFTER_MS = 10 * 60 * 1000;
const STALE_AFTER_MS = 100 * 60 * 1000;
const NEEDS_REVIEW_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_SETTLE_COMPETITIONS = 3;
/** Lineups are usually published about an hour before kickoff. */
const LINEUP_WINDOW_MIN_MS = 55 * 60 * 1000;
const LINEUP_WINDOW_MAX_MS = 65 * 60 * 1000;
const MAX_LINEUP_FETCHES = 4;
const MAX_FINAL_FETCHES = 4;

/**
 * Catch-up piggybacks on the existing 2-minute tick schedule (no new cron job):
 * at most once per CATCHUP_INTERVAL_MS, at most CATCHUP_CALLS_PER_SLOT provider
 * requests per slot and CATCHUP_DAILY_CAP per UTC day — the rest of the non-live
 * budget stays available for the daily sync / stats / lineup jobs.
 */
const CATCHUP_INTERVAL_MS = 15 * 60 * 1000;
const CATCHUP_CALLS_PER_SLOT = 4;
const CATCHUP_DAILY_CAP = 200;
const CATCHUP_LAST_KEY = "catchup_last_run_at";
const CATCHUP_DAILY_KEY = "catchup_daily_calls";

async function maybeRunCatchUp(): Promise<CatchUpResult | { skipped: string } | null> {
  const { data: rows } = await supabaseAdmin
    .from("cron_config")
    .select("key, value")
    .in("key", [CATCHUP_LAST_KEY, CATCHUP_DAILY_KEY]);
  const last = rows?.find((r) => r.key === CATCHUP_LAST_KEY)?.value;
  if (last && Date.now() - Date.parse(last) < CATCHUP_INTERVAL_MS) return null;

  const today = new Date().toISOString().slice(0, 10);
  const dailyRaw = rows?.find((r) => r.key === CATCHUP_DAILY_KEY)?.value ?? "";
  const [dailyDay, dailyCountRaw] = dailyRaw.split(":");
  const usedToday = dailyDay === today ? Number(dailyCountRaw) || 0 : 0;
  const slot = Math.min(CATCHUP_CALLS_PER_SLOT, CATCHUP_DAILY_CAP - usedToday);

  await supabaseAdmin
    .from("cron_config")
    .upsert({ key: CATCHUP_LAST_KEY, value: new Date().toISOString() }, { onConflict: "key" });
  if (slot <= 0) return { skipped: "daily_cap_reached" };

  const { runCatchUpMatches } = await import("@/lib/catch-up-matches.server");
  const r = await runCatchUpMatches({ maxCalls: slot });
  await supabaseAdmin
    .from("cron_config")
    .upsert({ key: CATCHUP_DAILY_KEY, value: `${today}:${usedToday + r.calls_used}` }, { onConflict: "key" });
  return r;
}

export type TickResult = {
  status: "success" | "partial" | "failed";
  api_calls_made: number;
  active_matches: number;
  live_matches_updated: number;
  stale_matches: number;
  competitions_settled: number;
  matches_settled: number;
  needs_review_flagged: number;
  lineups_prefetched: number;
  finals_fetched: number;
  notifications_sent: number;
  reason?: string;
};

function liveMinute(ev: Record<string, any>): number | null {
  const time = ev["time"] as Record<string, any> | undefined;
  const start = time?.["currentPeriodStartTimestamp"];
  if (typeof start !== "number") return null;
  const initialSeconds = typeof time?.["initial"] === "number" ? time["initial"] : 0;
  const elapsed = Math.floor(Date.now() / 1000) - start + initialSeconds;
  if (elapsed < 0) return null;
  const minute = Math.floor(elapsed / 60) + 1;
  const max = typeof time?.["max"] === "number" ? Math.floor(time["max"] / 60) : null;
  return max != null ? Math.min(minute, max) : minute;
}

export async function runTick(): Promise<TickResult> {
  const startedAt = new Date().toISOString();
  const apiKey = process.env["SPORTAPI_API_KEY"];

  let apiCalls = 0;
  let liveUpdated = 0;
  let staleCount = 0;
  let competitionsSettled = 0;
  let matchesSettled = 0;
  let needsReviewFlagged = 0;
  let notificationDetail: Record<string, any> | null = null;

  const finish = async (
    status: "success" | "partial" | "failed",
    detail: Record<string, any>,
    error?: string,
  ) => {
    await supabaseAdmin.from("job_runs").insert({
      job_name: "tick",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status,
      result_metric: notificationsSent,
      result_detail: detail as never,
      error: error ?? null,
    });
  };

  // Provider pause + live budget. A paused provider fails closed like an empty budget.
  const takeBudget = async () => (await sofascoreGate("live")).allowed;

  const call = async (path: string) => {
    const res = await fetch(`https://${SOFASCORE_HOST}${path}`, {
      headers: { "x-rapidapi-key": apiKey!, "x-rapidapi-host": SOFASCORE_HOST },
    });
    apiCalls += 1;
    const text = await res.text();
    await noteProviderResponse(res.status, text);
    let json: Record<string, any> | null = null;
    try {
      json = JSON.parse(text) as Record<string, any>;
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json };
  };

  const now = Date.now();
  const windowStart = new Date(now - ACTIVE_WINDOW_BEFORE_MS).toISOString();
  const windowEnd = new Date(now + ACTIVE_WINDOW_AFTER_MS).toISOString();

  // ---- STEP 1: pure database
  const { data: activeMatches, error: activeError } = await supabaseAdmin
    .from("matches")
    .select(
      "id, external_id, competition_id, kickoff_at, status, needs_review, live_source, home_score, away_score",
    )
    .eq("source", SOURCE)
    .not("external_id", "is", null)
    .not("kickoff_at", "is", null)
    .gte("kickoff_at", windowStart)
    .lte("kickoff_at", windowEnd)
    .or(
      `status.is.null,status.not.in.(${FINAL_STATUS_TYPES.join(",")})`,
    )
    .order("kickoff_at", { ascending: true });

  let lineupsPrefetched = 0;
  let finalsFetched = 0;
  let notificationsSent = 0;

  const baseResult = (
    status: TickResult["status"],
    activeCount: number,
    reason?: string,
  ): TickResult => ({
    status,
    api_calls_made: apiCalls,
    active_matches: activeCount,
    live_matches_updated: liveUpdated,
    stale_matches: staleCount,
    competitions_settled: competitionsSettled,
    matches_settled: matchesSettled,
    needs_review_flagged: needsReviewFlagged,
    lineups_prefetched: lineupsPrefetched,
    finals_fetched: finalsFetched,
    notifications_sent: notificationsSent,
    ...(reason ? { reason } : {}),
  });

  if (activeError) {
    await finish("failed", { api_calls: apiCalls }, activeError.message);
    return baseResult("failed", 0, activeError.message);
  }

  const active = activeMatches ?? [];

  // ---- STEP 1b: lineup pre-fetch candidates (kickoff in 55-65 minutes, no lineups yet)
  const { data: lineupWindowMatches } = await supabaseAdmin
    .from("matches")
    .select("id, external_id, kickoff_at, status")
    .eq("source", SOURCE)
    .not("external_id", "is", null)
    .gte("kickoff_at", new Date(now + LINEUP_WINDOW_MIN_MS).toISOString())
    .lte("kickoff_at", new Date(now + LINEUP_WINDOW_MAX_MS).toISOString())
    .not("status", "in", `(${FINAL_STATUS_TYPES.join(",")})`)
    .order("kickoff_at", { ascending: true })
    .limit(20);

  const lineupCandidates: Array<{ id: string; external_id: string | null }> = [];
  for (const m of lineupWindowMatches ?? []) {
    if (lineupCandidates.length >= MAX_LINEUP_FETCHES) break;
    const { count } = await supabaseAdmin
      .from("lineups")
      .select("id", { count: "exact", head: true })
      .eq("match_id", m.id);
    if ((count ?? 0) === 0) lineupCandidates.push(m);
  }

  // A quiet tick by *stored kickoff* is not proof that nothing is being
  // played: stored kickoffs can be stale or unverified. The API-Football live
  // sweep below is keyed on the verified fixture mapping, not on kickoff_at,
  // so it still runs. Only the Sofascore-side work is skipped.
  const quiet = active.length === 0 && lineupCandidates.length === 0;

  // The lineups fetcher owns its own budget gate ('lineups' category) and job_runs row.
  if (apiKey) {
    for (const candidate of lineupCandidates) {
      const { runFetchMatchLineups } = await import("@/lib/fetch-match-lineups.server");
      const r = await runFetchMatchLineups({ matchExternalId: String(candidate.external_id) });
      if (r.budget_exhausted) break;
      apiCalls += r.http_status != null ? 1 : 0;
      if (r.lineups_upserted > 0) lineupsPrefetched += 1;
    }
  }


  const byExternalId = new Map(active.map((m) => [String(m.external_id), m]));

  // Snapshot BEFORE the live sweep — the notification engine needs the previous
  // status/score to detect a kickoff or a new goal without extra API calls.
  const snapshots = new Map<string, MatchSnapshot>(
    active.map((m) => [
      m.id,
      {
        match_id: m.id,
        external_id: String(m.external_id),
        competition_id: m.competition_id,
        status: m.status,
        prev_status: m.status,
        home_score: m.home_score,
        away_score: m.away_score,
        prev_home_score: m.home_score,
        prev_away_score: m.away_score,
      },
    ]),
  );

  // ---- STEP 2: score/status sweep.
  // API-Football is PRIMARY: one aggregated /fixtures?live=all request per
  // tick serves every user, plus one bounded reconciliation read. Sofascore
  // is only used for score/status when API-Football is unavailable, and keeps
  // owning identity, lineups, statistics and events.
  const seenLive = new Set<string>();
  let budgetBlocked = false;
  let afDetail: Record<string, any> | null = null;
  let afUsable = false;

  try {
    const { runAfLive } = await import("@/lib/live-api-football.server");
    const af = await runAfLive();
    afUsable = af.key_present && af.provider_error === null && !af.budget_blocked;
    for (const { row, update } of af.applied) {
      liveUpdated += 1;
      if (row.external_id) seenLive.add(String(row.external_id));
      const snap = snapshots.get(row.id) ?? {
        match_id: row.id,
        external_id: String(row.external_id ?? ""),
        competition_id: row.competition_id,
        status: row.status,
        prev_status: row.status,
        home_score: row.home_score,
        away_score: row.away_score,
        prev_home_score: row.home_score,
        prev_away_score: row.away_score,
      };
      snap.status = update.status;
      snap.home_score = update.home_score;
      snap.away_score = update.away_score;
      snapshots.set(row.id, snap);
    }
    const { applied: _applied, ...summary } = af;
    afDetail = summary;
    if (af.budget_blocked) budgetBlocked = true;
  } catch (e) {
    afDetail = { error: e instanceof Error ? e.message : "api-football live failed" };
  }

  if (!afUsable && !quiet && apiKey) {
    // Fallback only — the primary provider could not be used this tick.
    if (await takeBudget()) {
      const res = await call(`/api/v1/sport/football/events/live`);
      if (res.ok && res.json) {
        const events: Array<Record<string, any>> = res.json["events"] ?? [];
        for (const ev of events) {
          const externalId = String(ev["id"]);
          const mine = byExternalId.get(externalId);
          if (!mine) continue; // never insert from the live feed
          seenLive.add(externalId);

          const { error } = await supabaseAdmin
            .from("matches")
            .update({
              status: ev["status"]?.["type"] ?? mine.status,
              minute: liveMinute(ev),
              home_score: ev["homeScore"]?.["current"] ?? null,
              away_score: ev["awayScore"]?.["current"] ?? null,
              live_source: SOURCE,
              fetched_at: new Date().toISOString(),
            })
            .eq("id", mine.id);
          if (!error) {
            liveUpdated += 1;
            const snap = snapshots.get(mine.id);
            if (snap) {
              snap.status = ev["status"]?.["type"] ?? snap.status;
              snap.home_score = ev["homeScore"]?.["current"] ?? snap.home_score;
              snap.away_score = ev["awayScore"]?.["current"] ?? snap.away_score;
            }
          }
        }
      }
    } else {
      budgetBlocked = true;
    }
  }



  // ---- STEP 3: settle stale matches per competition
  const stale = active.filter(
    (m) =>
      !seenLive.has(String(m.external_id)) &&
      m.kickoff_at != null &&
      now - new Date(m.kickoff_at).getTime() > STALE_AFTER_MS,
  );
  staleCount = stale.length;

  // needs_review is an indicator only — the match keeps being retried.
  for (const m of stale) {
    if (
      m.needs_review !== true &&
      m.kickoff_at != null &&
      now - new Date(m.kickoff_at).getTime() > NEEDS_REVIEW_AFTER_MS
    ) {
      const { error } = await supabaseAdmin
        .from("matches")
        .update({ needs_review: true })
        .eq("id", m.id);
      if (!error) needsReviewFlagged += 1;
    }
  }

  const staleByCompetition = new Map<string, typeof stale>();
  for (const m of stale) {
    if (!m.competition_id) continue;
    const list = staleByCompetition.get(m.competition_id) ?? [];
    list.push(m);
    staleByCompetition.set(m.competition_id, list);
  }

  // oldest stale first
  const competitionOrder = Array.from(staleByCompetition.entries())
    .sort((a, b) => {
      const oldest = (list: typeof stale) =>
        Math.min(...list.map((m) => new Date(m.kickoff_at!).getTime()));
      return oldest(a[1]) - oldest(b[1]);
    })
    .slice(0, MAX_SETTLE_COMPETITIONS);

  for (const [competitionId, matches] of competitionOrder) {
    const { data: comp } = await supabaseAdmin
      .from("competitions")
      .select("tournament_id, current_season_id")
      .eq("id", competitionId)
      .maybeSingle();
    if (!comp?.tournament_id || !comp.current_season_id) continue;

    if (!(await takeBudget())) {
      budgetBlocked = true;
      break;
    }

    const res = await call(
      `/api/v1/unique-tournament/${comp.tournament_id}/season/${comp.current_season_id}/events/last/0`,
    );
    competitionsSettled += 1;
    if (!res.ok || !res.json) continue;

    const events: Array<Record<string, any>> = res.json["events"] ?? [];
    const eventById = new Map(events.map((ev) => [String(ev["id"]), ev]));

    for (const m of matches) {
      const ev = eventById.get(String(m.external_id));
      if (!ev) continue;
      // Shared rule: no provider state -> no write; "finished" needs both scores.
      const built = buildScoreUpdate(m, ev, new Date().toISOString());
      if (!built) continue;
      const { error } = await supabaseAdmin
        .from("matches")
        .update(built.update as never)
        .eq("id", m.id);
      if (!error) matchesSettled += 1;
    }
  }

  // ---- STEP 3b: matches that were live on an earlier tick but dropped out of the feed
  const droppedFromLive = active
    .filter(
      (m) =>
        !seenLive.has(String(m.external_id)) &&
        m.live_source === SOURCE &&
        !FINAL_STATUS_TYPES.includes(String(m.status)),
    )
    .slice(0, MAX_FINAL_FETCHES);

  for (const m of droppedFromLive) {
    if (!(await takeBudget())) {
      budgetBlocked = true;
      break;
    }
    const res = await call(`/api/v1/event/${m.external_id}`);
    finalsFetched += 1;
    const ev = res.json?.["event"] as Record<string, any> | undefined;
    if (!res.ok || !ev) continue;
    const built = buildScoreUpdate(m, ev, new Date().toISOString());
    if (!built) continue;
    const { error } = await supabaseAdmin
      .from("matches")
      .update(built.update as never)
      .eq("id", m.id);
    if (!error) matchesSettled += 1;
  }

  // ---- STEP 4: notification engine (no extra live calls)
  try {
    const { runNotifications } = await import("@/lib/notifications.server");
    const notif = await runNotifications([...snapshots.values()]);
    notificationsSent = notif.notifications_sent;
    notificationDetail = notif;
  } catch (e) {
    notificationDetail = { error: e instanceof Error ? e.message : "notifications failed" };
  }

  // ---- STEP 5: bounded catch-up slot (its own 'bulk' budget; never touches the live reserve)
  let catchUp: Awaited<ReturnType<typeof maybeRunCatchUp>> = null;
  if (!budgetBlocked) {
    try {
      catchUp = await maybeRunCatchUp();
    } catch (e) {
      catchUp = { skipped: e instanceof Error ? e.message : "catch-up failed" };
    }
  }

  const detail = {
    notifications: notificationDetail,
    notifications_sent: notificationsSent,
    api_calls_made: apiCalls,
    active_matches: active.length,
    live_matches_updated: liveUpdated,
    stale_matches: staleCount,
    competitions_settled: competitionsSettled,
    matches_settled: matchesSettled,
    needs_review_flagged: needsReviewFlagged,
    lineups_prefetched: lineupsPrefetched,
    finals_fetched: finalsFetched,
    budget_blocked: budgetBlocked,
    catch_up: catchUp,
  };
  const status = budgetBlocked ? "partial" : "success";
  await finish(status, detail);

  return baseResult(status, active.length, budgetBlocked ? "budget_blocked" : undefined);
}

