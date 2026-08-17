import { supabaseAdmin } from "@/integrations/supabase/client.server";

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
      result_metric: liveUpdated + matchesSettled,
      result_detail: detail as never,
      error: error ?? null,
    });
  };

  const takeBudget = async () => {
    const { data: ok } = await supabaseAdmin.rpc("api_budget_take", {
      p_provider: SOURCE,
      p_category: "live",
      p_count: 1,
    });
    return ok === true;
  };

  const call = async (path: string) => {
    const res = await fetch(`https://${SOFASCORE_HOST}${path}`, {
      headers: { "x-rapidapi-key": apiKey!, "x-rapidapi-host": SOFASCORE_HOST },
    });
    apiCalls += 1;
    const text = await res.text();
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
    .select("id, external_id, competition_id, kickoff_at, status, needs_review, live_source")
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
    .select("id, external_id, kickoff_at")
    .eq("source", SOURCE)
    .not("external_id", "is", null)
    .gte("kickoff_at", new Date(now + LINEUP_WINDOW_MIN_MS).toISOString())
    .lte("kickoff_at", new Date(now + LINEUP_WINDOW_MAX_MS).toISOString())
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

  if (active.length === 0 && lineupCandidates.length === 0) {
    await finish("success", { reason: "nothing_active", api_calls: 0 });
    return baseResult("success", 0, "nothing_active");
  }

  if (!apiKey) {
    await finish(
      "failed",
      { active_matches: active.length, api_calls: 0 },
      "SPORTAPI_API_KEY missing",
    );
    return baseResult("failed", active.length, "SPORTAPI_API_KEY missing");
  }

  // The lineups fetcher owns its own budget gate ('lineups' category) and job_runs row.
  for (const candidate of lineupCandidates) {
    const { runFetchMatchLineups } = await import("@/lib/fetch-match-lineups.server");
    const r = await runFetchMatchLineups({ matchExternalId: String(candidate.external_id) });
    if (r.budget_exhausted) break;
    apiCalls += r.http_status != null ? 1 : 0;
    if (r.lineups_upserted > 0) lineupsPrefetched += 1;
  }

  const byExternalId = new Map(active.map((m) => [String(m.external_id), m]));


  // ---- STEP 2: one live sweep for the whole world
  const seenLive = new Set<string>();
  let budgetBlocked = false;

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
        if (!error) liveUpdated += 1;
      }
    }
  } else {
    budgetBlocked = true;
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
      const statusType: string | null = ev["status"]?.["type"] ?? null;
      const { error } = await supabaseAdmin
        .from("matches")
        .update({
          status: statusType,
          home_score: ev["homeScore"]?.["current"] ?? null,
          away_score: ev["awayScore"]?.["current"] ?? null,
          minute: null,
          fetched_at: new Date().toISOString(),
        })
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
    const { error } = await supabaseAdmin
      .from("matches")
      .update({
        status: ev["status"]?.["type"] ?? m.status,
        home_score: ev["homeScore"]?.["current"] ?? null,
        away_score: ev["awayScore"]?.["current"] ?? null,
        minute: null,
        fetched_at: new Date().toISOString(),
      })
      .eq("id", m.id);
    if (!error) matchesSettled += 1;
  }

  const detail = {
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
  };
  const status = budgetBlocked ? "partial" : "success";
  await finish(status, detail);

  return baseResult(status, active.length, budgetBlocked ? "budget_blocked" : undefined);
}

