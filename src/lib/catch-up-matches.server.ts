import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  noteProviderResponse,
  readPause,
  sofascoreGate,
} from "@/lib/provider-gate.server";
import {
  buildScoreUpdate,
  detailNeeds,
  effectiveCallCeiling,
  groupByCompetitionOldestFirst,
  isProviderFailure,
  isUnavailableStatus,
  isUnresolvedPast,
  nextPageAfter,
  rotateAfter,
  shouldMarkChecked,
  stuckBucket,
  type MatchLite,
} from "@/lib/catch-up/plan";

const SOFASCORE_HOST = "sportapi7.p.rapidapi.com";
const SOURCE = "sofascore";
const PROGRESS_PREFIX = "catchup_page:";
/** Competition served last by Stage A — the next run starts after it (round-robin across runs). */
const RR_CURSOR_KEY = "catchup_rr_cursor";
/** Individual /event lookups per run for matches the league result pages did not contain. */
const MAX_INDIVIDUAL_PER_RUN = 6;
/** Finished matches examined for missing details per run. */
const MAX_DETAIL_MATCHES_PER_RUN = 25;

export type CatchUpStage = "scores" | "details" | "all";

export type CatchUpResult = {
  status: "success" | "partial" | "failed" | "skipped";
  reason?: string;
  calls_used: number;
  call_ceiling: number;
  scores: {
    unresolved_before: number;
    stale_4h: number;
    stale_24h: number;
    competitions_touched: number;
    pages_fetched: number;
    individual_lookups: number;
    resolved: number;
    still_open_at_provider: number;
    not_found_flagged: number;
    unresolved_after: number;
  };
  details: {
    matches_examined: number;
    lineups_fetched: number;
    lineups_rows: number;
    ratings_rows: number;
    stats_fetched: number;
    stats_rows: number;
    incidents_fetched: number;
    events_rows: number;
    unavailable: number;
  };
  provider_error?: string;
};

type AnyRec = Record<string, any>;

async function readProgress(competitionId: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from("cron_config")
    .select("value")
    .eq("key", `${PROGRESS_PREFIX}${competitionId}`)
    .maybeSingle();
  const n = Number(data?.value ?? 0);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

async function writeProgress(competitionId: string, page: number | null): Promise<void> {
  const key = `${PROGRESS_PREFIX}${competitionId}`;
  if (page == null || page === 0) {
    await supabaseAdmin.from("cron_config").delete().eq("key", key);
  } else {
    await supabaseAdmin.from("cron_config").upsert({ key, value: String(page) }, { onConflict: "key" });
  }
}

/** Remaining non-live budget for today (daily_limit - live_reserve - today's calls). */
async function nonLiveRemaining(): Promise<number | null> {
  const { data: q } = await supabaseAdmin
    .from("api_quotas")
    .select("daily_limit, live_reserve_daily, configured")
    .eq("provider", SOURCE)
    .maybeSingle();
  if (!q || q.configured !== true) return 0;
  if (q.daily_limit == null) return null;
  const today = new Date().toISOString().slice(0, 10);
  const { data: rows } = await supabaseAdmin
    .from("api_usage_daily")
    .select("calls")
    .eq("provider", SOURCE)
    .eq("day", today);
  const used = (rows ?? []).reduce((s, r) => s + (r.calls ?? 0), 0);
  return q.daily_limit - (q.live_reserve_daily ?? 0) - used;
}

/**
 * Bounded catch-up for matches the live tick can no longer see.
 *
 * Stage A (scores): every match with kickoff >= 4h ago whose status is not
 * final, in every competition. League result pages first (one call covers
 * ~30 matches), with per-competition page progress persisted in cron_config;
 * matches the pages never contain are looked up individually, oldest attempt
 * first. Provider states are copied verbatim — never inferred.
 *
 * Stage B (details): finished matches missing lineups/ratings, statistics or
 * events. Reuses the existing fetchers; each successful provider answer sets
 * a checked marker so nothing is refetched forever, while HTTP failures leave
 * the marker empty so the item is retried on a later run.
 *
 * Every request passes the provider pause + api_budget_take gate. The run
 * stops on the first provider failure (any non-2xx other than a per-item 404).
 */
export async function runCatchUpMatches(options: {
  maxCalls: number;
  stage?: CatchUpStage;
  skipJobRun?: boolean;
}): Promise<CatchUpResult> {
  const startedAt = new Date().toISOString();
  const stage: CatchUpStage = options.stage ?? "all";
  const apiKey = process.env["SPORTAPI_API_KEY"];

  const result: CatchUpResult = {
    status: "success",
    calls_used: 0,
    call_ceiling: 0,
    scores: {
      unresolved_before: 0,
      stale_4h: 0,
      stale_24h: 0,
      competitions_touched: 0,
      pages_fetched: 0,
      individual_lookups: 0,
      resolved: 0,
      still_open_at_provider: 0,
      not_found_flagged: 0,
      unresolved_after: 0,
    },
    details: {
      matches_examined: 0,
      lineups_fetched: 0,
      lineups_rows: 0,
      ratings_rows: 0,
      stats_fetched: 0,
      stats_rows: 0,
      incidents_fetched: 0,
      events_rows: 0,
      unavailable: 0,
    },
  };

  const finish = async (
    status: CatchUpResult["status"],
    reason?: string,
    error?: string,
  ): Promise<CatchUpResult> => {
    result.status = status;
    if (reason) result.reason = reason;
    if (error) result.provider_error = error;
    if (stage !== "details") {
      const { count } = await supabaseAdmin
        .from("matches")
        .select("id", { count: "exact", head: true })
        .eq("source", SOURCE)
        .not("external_id", "is", null)
        .lt("kickoff_at", new Date(Date.now() - 4 * 3600_000).toISOString())
        .or("status.is.null,status.not.in.(finished,canceled,postponed,awarded,removed)");
      result.scores.unresolved_after = count ?? result.scores.unresolved_before - result.scores.resolved;
    }
    if (!options.skipJobRun) {
      await supabaseAdmin.from("job_runs").insert({
        job_name: "catch-up-matches",
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        status,
        result_metric:
          result.scores.resolved +
          result.details.lineups_fetched +
          result.details.stats_fetched +
          result.details.incidents_fetched,
        result_detail: { stage, ...result } as never,
        error: error ?? null,
      });
    }
    return result;
  };

  if (!apiKey) return finish("failed", "SPORTAPI_API_KEY missing", "SPORTAPI_API_KEY missing");

  const pause = await readPause();
  if (pause) return finish("skipped", `provider_paused_until ${pause.until}`);

  result.call_ceiling = effectiveCallCeiling(options.maxCalls, await nonLiveRemaining());
  if (result.call_ceiling <= 0) return finish("skipped", "no_non_live_budget");

  let providerError: string | null = null;
  const callsLeft = () => result.call_ceiling - result.calls_used;

  /** One gated outgoing call. Returns null when the gate refused (no call made). */
  const call = async (
    path: string,
  ): Promise<{ status: number; json: AnyRec | null; body: string } | null> => {
    if (callsLeft() <= 0) return null;
    const gate = await sofascoreGate("bulk");
    if (!gate.allowed) {
      providerError = providerError ?? gate.reason;
      return null;
    }
    result.calls_used += 1;
    try {
      const res = await fetch(`https://${SOFASCORE_HOST}${path}`, {
        headers: { "x-rapidapi-key": apiKey, "x-rapidapi-host": SOFASCORE_HOST },
      });
      const body = await res.text();
      await noteProviderResponse(res.status, body);
      let json: AnyRec | null = null;
      try {
        json = JSON.parse(body) as AnyRec;
      } catch {
        json = null;
      }
      if (isProviderFailure(res.status)) {
        providerError = `http ${res.status}: ${body.slice(0, 160)}`;
      }
      return { status: res.status, json, body };
    } catch (e) {
      providerError = `network: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200);
      return { status: 0, json: null, body: "" };
    }
  };

  // ---------------------------------------------------------------- Stage A
  if (stage !== "details") {
    const nowMs = Date.now();
    const { data: rows, error } = await supabaseAdmin
      .from("matches")
      .select("id, external_id, competition_id, kickoff_at, status")
      .eq("source", SOURCE)
      .not("external_id", "is", null)
      .lt("kickoff_at", new Date(nowMs - 4 * 3600_000).toISOString())
      .or("status.is.null,status.not.in.(finished,canceled,postponed,awarded,removed)")
      .order("kickoff_at", { ascending: true })
      .limit(1000);
    if (error) return finish("failed", "select_failed", error.message);

    const unresolved = ((rows ?? []) as MatchLite[]).filter((m) => isUnresolvedPast(m, nowMs));
    result.scores.unresolved_before = unresolved.length;
    for (const m of unresolved) {
      const b = stuckBucket(m, nowMs);
      if (b === "stale_24h") result.scores.stale_24h += 1;
      else if (b === "stale_4h") result.scores.stale_4h += 1;
    }

    const remainingIds = new Set(unresolved.map((m) => m.id));
    const byId = new Map(unresolved.map((m) => [m.id, m]));

    const applyEvent = async (m: MatchLite, ev: AnyRec): Promise<boolean> => {
      const built = buildScoreUpdate(m, ev, new Date().toISOString());
      if (!built) return false;
      const { error: upErr } = await supabaseAdmin
        .from("matches")
        .update(built.update as never)
        .eq("id", m.id)
        .or("status.is.null,status.not.in.(finished,canceled,postponed,awarded,removed)");
      if (upErr) return false;
      if (built.resolved) {
        result.scores.resolved += 1;
        remainingIds.delete(m.id);
      } else {
        result.scores.still_open_at_provider += 1;
      }
      return true;
    };

    // A1 — league result pages, one page per competition per pass. The order is
    // oldest-first, rotated to start after the competition served last time, so
    // every league gets a turn even with a 4-call slot.
    const { data: cursorRow } = await supabaseAdmin
      .from("cron_config")
      .select("value")
      .eq("key", RR_CURSOR_KEY)
      .maybeSingle();
    const groups = rotateAfter(groupByCompetitionOldestFirst(unresolved), cursorRow?.value ?? null);
    const pageState = new Map<string, number | null>();
    for (const [compId] of groups) pageState.set(compId, await readProgress(compId));
    let lastServed: string | null = null;

    for (let pass = 0; pass < 2 && !providerError && callsLeft() > 0; pass += 1) {
      for (const [compId, list] of groups) {
        if (providerError || callsLeft() <= 0) break;
        const page = pageState.get(compId);
        if (page == null) continue;
        const stillOpen = list.filter((m) => remainingIds.has(m.id));
        if (stillOpen.length === 0) {
          pageState.set(compId, null);
          await writeProgress(compId, null);
          continue;
        }
        const { data: comp } = await supabaseAdmin
          .from("competitions")
          .select("tournament_id, current_season_id")
          .eq("id", compId)
          .maybeSingle();
        if (!comp?.tournament_id || !comp.current_season_id) {
          pageState.set(compId, null);
          continue;
        }
        const res = await call(
          `/api/v1/unique-tournament/${comp.tournament_id}/season/${comp.current_season_id}/events/last/${page}`,
        );
        if (!res) break;
        lastServed = compId;
        if (pass === 0) result.scores.competitions_touched += 1;
        if (isUnavailableStatus(res.status)) {
          // No (more) finished events for this season — nothing to page through.
          pageState.set(compId, null);
          await writeProgress(compId, null);
          continue;
        }
        if (providerError || !res.json) break;
        result.scores.pages_fetched += 1;
        const events = (res.json["events"] as AnyRec[] | undefined) ?? [];
        const byExternal = new Map(events.map((e) => [String(e["id"]), e]));
        for (const m of stillOpen) {
          const ev = byExternal.get(String(m.external_id));
          if (ev) await applyEvent(m, ev);
        }
        const next = nextPageAfter(
          stillOpen.filter((m) => remainingIds.has(m.id)),
          events,
          page,
          res.json["hasNextPage"] === true,
        );
        pageState.set(compId, next);
        await writeProgress(compId, next);
      }
    }
    if (lastServed) {
      await supabaseAdmin
        .from("cron_config")
        .upsert({ key: RR_CURSOR_KEY, value: lastServed }, { onConflict: "key" });
    }

    // A2 — matches the result pages did not contain: individual lookups, least-recently tried first.
    if (!providerError && callsLeft() > 0 && remainingIds.size > 0) {
      const { data: tried } = await supabaseAdmin
        .from("matches")
        .select("id, fetched_at")
        .in("id", [...remainingIds].slice(0, 500));
      const order = new Map((tried ?? []).map((r) => [r.id, r.fetched_at ? Date.parse(r.fetched_at) : 0]));
      const candidates = [...remainingIds]
        .map((id) => byId.get(id)!)
        .filter((m) => m.competition_id == null || pageState.get(m.competition_id) == null)
        .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
        .slice(0, MAX_INDIVIDUAL_PER_RUN);
      for (const m of candidates) {
        if (providerError || callsLeft() <= 0) break;
        const res = await call(`/api/v1/event/${m.external_id}`);
        if (!res) break;
        result.scores.individual_lookups += 1;
        const attemptedAt = new Date().toISOString();
        if (isUnavailableStatus(res.status)) {
          await supabaseAdmin
            .from("matches")
            .update({ needs_review: true, fetched_at: attemptedAt })
            .eq("id", m.id);
          result.scores.not_found_flagged += 1;
          continue;
        }
        if (providerError) break;
        const ev = res.json?.["event"] as AnyRec | undefined;
        const applied = ev ? await applyEvent(m, ev) : false;
        if (!applied) {
          await supabaseAdmin
            .from("matches")
            .update({ needs_review: true, fetched_at: attemptedAt })
            .eq("id", m.id);
          result.scores.not_found_flagged += 1;
        }
      }
    }
  }

  // ---------------------------------------------------------------- Stage B
  if (stage !== "scores" && !providerError && callsLeft() > 0) {
    const { data: finished } = await supabaseAdmin
      .from("matches")
      .select(
        "id, external_id, status, home_score, away_score, ratings_checked_at, stats_checked_at, incidents_checked_at",
      )
      .eq("source", SOURCE)
      .eq("status", "finished")
      .not("external_id", "is", null)
      .or("ratings_checked_at.is.null,stats_checked_at.is.null,incidents_checked_at.is.null")
      .order("kickoff_at", { ascending: false })
      .limit(MAX_DETAIL_MATCHES_PER_RUN * 4);

    const pool = finished ?? [];
    const ids = pool.map((m) => m.id);
    const has = async (table: "lineups" | "match_stats" | "events") => {
      const s = new Set<string>();
      if (ids.length === 0) return s;
      const { data } = await supabaseAdmin.from(table).select("match_id").in("match_id", ids);
      for (const r of data ?? []) s.add(r.match_id);
      return s;
    };
    const [hasLineups, hasStats, hasEvents] = await Promise.all([
      has("lineups"),
      has("match_stats"),
      has("events"),
    ]);

    const { runFetchMatchLineups } = await import("@/lib/fetch-match-lineups.server");
    const { runFetchMatchStats } = await import("@/lib/fetch-match-stats.server");
    const { runFetchMatchIncidents } = await import("@/lib/fetch-match-incidents.server");

    let examined = 0;
    for (const m of pool) {
      if (providerError || callsLeft() <= 0 || examined >= MAX_DETAIL_MATCHES_PER_RUN) break;
      const needs = detailNeeds({
        status: m.status,
        home_score: m.home_score,
        away_score: m.away_score,
        has_lineups: hasLineups.has(m.id),
        has_stats: hasStats.has(m.id),
        has_events: hasEvents.has(m.id),
        ratings_checked_at: m.ratings_checked_at,
        stats_checked_at: m.stats_checked_at,
        incidents_checked_at: m.incidents_checked_at,
      });
      // Rows that only lack a marker but already hold the data: mark them, no call.
      const markOnly: Record<string, string> = {};
      const now = new Date().toISOString();
      if (hasLineups.has(m.id) && !m.ratings_checked_at) markOnly["ratings_checked_at"] = now;
      if (hasStats.has(m.id) && !m.stats_checked_at) markOnly["stats_checked_at"] = now;
      if (hasEvents.has(m.id) && !m.incidents_checked_at) markOnly["incidents_checked_at"] = now;
      if (Object.keys(markOnly).length > 0) {
        await supabaseAdmin.from("matches").update(markOnly as never).eq("id", m.id);
      }
      if (needs.length === 0) continue;
      examined += 1;
      result.details.matches_examined += 1;
      const ext = String(m.external_id);

      for (const kind of needs) {
        if (providerError || callsLeft() <= 0) break;
        const paused = await readPause();
        if (paused) {
          providerError = "provider_paused";
          break;
        }
        if (kind === "lineups") {
          const r = await runFetchMatchLineups({ matchExternalId: ext, skipJobRun: true });
          if (r.http_status != null) {
            result.calls_used += 1;
            await noteProviderResponse(r.http_status, r.message ?? "");
          }
          if (r.budget_exhausted) {
            providerError = "budget_exhausted";
            break;
          }
          if (isProviderFailure(r.http_status)) {
            providerError = r.message ?? `lineups http ${r.http_status}`;
            break;
          }
          result.details.lineups_fetched += 1;
          result.details.lineups_rows += r.lineups_upserted;
          result.details.ratings_rows += r.ratings_upserted;
          if (r.lineups_upserted === 0) result.details.unavailable += 1;
          // Marker only after the fetcher persisted without a DB error; otherwise retry later.
          if (shouldMarkChecked(r.status, r.http_status)) {
            await supabaseAdmin
              .from("matches")
              .update({ ratings_checked_at: new Date().toISOString() })
              .eq("id", m.id);
          }
        } else if (kind === "stats") {
          const r = await runFetchMatchStats({ matchExternalId: ext, skipJobRun: true });
          const http = r.http_statuses[0] ?? null;
          if (http != null) {
            result.calls_used += 1;
            await noteProviderResponse(http, r.message ?? "");
          }
          if (r.budget_exhausted) {
            providerError = "budget_exhausted";
            break;
          }
          if (isProviderFailure(http)) {
            providerError = r.message ?? `stats http ${http}`;
            break;
          }
          result.details.stats_fetched += 1;
          result.details.stats_rows += r.rows_inserted;
          if (r.rows_inserted === 0) result.details.unavailable += 1;
          if (shouldMarkChecked(r.status, http)) {
            await supabaseAdmin
              .from("matches")
              .update({ stats_checked_at: new Date().toISOString() })
              .eq("id", m.id);
          }
        } else {
          const r = await runFetchMatchIncidents({ matchExternalId: ext, skipJobRun: true });
          if (r.http_status != null) {
            result.calls_used += 1;
            await noteProviderResponse(r.http_status, r.message ?? "");
          }
          if (r.budget_exhausted) {
            providerError = "budget_exhausted";
            break;
          }
          if (isProviderFailure(r.http_status)) {
            providerError = r.message ?? `incidents http ${r.http_status}`;
            break;
          }
          result.details.incidents_fetched += 1;
          result.details.events_rows += r.events_saved;
          if (r.events_saved === 0) result.details.unavailable += 1;
          if (shouldMarkChecked(r.status, r.http_status)) {
            await supabaseAdmin
              .from("matches")
              .update({ incidents_checked_at: new Date().toISOString() })
              .eq("id", m.id);
          }
        }
      }
    }
  }

  if (providerError) {
    const anyWork =
      result.scores.resolved + result.details.lineups_fetched + result.details.stats_fetched + result.details.incidents_fetched >
      0;
    const gateStop = providerError === "budget_exhausted" || providerError === "provider_paused";
    return finish(anyWork || gateStop ? "partial" : "failed", gateStop ? providerError : "provider_error", gateStop ? undefined : providerError);
  }
  return finish("success");
}
