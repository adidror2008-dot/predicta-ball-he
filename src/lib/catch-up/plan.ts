/**
 * Pure planning helpers for the stuck-match catch-up. No I/O — unit tested.
 */

/** Observed: the provider intermittently lets a few calls through even while "monthly" is exceeded,
 *  so probe again after 2h (≤12 wasted requests/day when fully blocked). */
export const PAUSE_MONTHLY_MS = 2 * 60 * 60 * 1000;
export const PAUSE_RATE_LIMIT_MS = 10 * 60 * 1000;

/** Cooldown for a provider response: 429 -> bounded pause (longer for a monthly quota). Never permanent. */
export function pauseForResponse(status: number, body: string): number | null {
  if (status === 429) return /monthly/i.test(body) ? PAUSE_MONTHLY_MS : PAUSE_RATE_LIMIT_MS;
  return null;
}

/** Provider status.type values that never change again. */
export const FINAL_STATUS_TYPES = ["finished", "canceled", "postponed", "awarded", "removed"] as const;

/** Statuses for which the provider score fields are meaningful. */
const SCORED_TYPES = new Set(["finished", "inprogress", "interrupted", "suspended", "awarded"]);

export const STUCK_MIN_AGE_MS = 4 * 60 * 60 * 1000;
export const STUCK_REVIEW_AGE_MS = 24 * 60 * 60 * 1000;

export type MatchLite = {
  id: string;
  external_id: string | null;
  competition_id: string | null;
  kickoff_at: string | null;
  status: string | null;
};

export type ProviderEvent = Record<string, any>;

export function isFinalStatus(status: string | null | undefined): boolean {
  return status != null && (FINAL_STATUS_TYPES as readonly string[]).includes(status);
}

/**
 * A match is "unresolved past" when its kickoff is at least 4h ago and the
 * stored status is not final. Live-window matches (< 4h) belong to the tick.
 */
export function isUnresolvedPast(m: MatchLite, nowMs: number, minAgeMs = STUCK_MIN_AGE_MS): boolean {
  if (!m.kickoff_at || !m.external_id) return false;
  const kickoff = Date.parse(m.kickoff_at);
  if (!Number.isFinite(kickoff)) return false;
  if (nowMs - kickoff < minAgeMs) return false;
  return !isFinalStatus(m.status);
}

export function stuckBucket(m: MatchLite, nowMs: number): "live_window" | "stale_4h" | "stale_24h" {
  const age = nowMs - Date.parse(m.kickoff_at ?? "");
  if (age >= STUCK_REVIEW_AGE_MS) return "stale_24h";
  if (age >= STUCK_MIN_AGE_MS) return "stale_4h";
  return "live_window";
}

export type ScoreUpdate = {
  status: string;
  home_score?: number;
  away_score?: number;
  minute: null;
  needs_review: boolean;
  fetched_at: string;
  kickoff_at?: string;
};

/**
 * Build the DB update for a provider event. Returns null when the provider
 * did not report a usable state — we never invent a final state.
 *
 * - `finished` without both scores is NOT written as finished (false finalization).
 * - Non-final states (e.g. still `inprogress` at the provider) are written
 *   truthfully but keep needs_review = true so the match stays on the retry list.
 */
export function buildScoreUpdate(
  existing: MatchLite,
  ev: ProviderEvent,
  nowIso: string,
): { update: ScoreUpdate; resolved: boolean } | null {
  const type = ev?.["status"]?.["type"];
  if (typeof type !== "string" || type.length === 0) return null;

  const home = ev["homeScore"]?.["current"];
  const away = ev["awayScore"]?.["current"];
  const hasScores = typeof home === "number" && typeof away === "number";

  if (type === "finished" && !hasScores) return null;

  const final = isFinalStatus(type);
  const update: ScoreUpdate = {
    status: type,
    minute: null,
    needs_review: !final,
    fetched_at: nowIso,
  };
  if (SCORED_TYPES.has(type) && hasScores) {
    update.home_score = home;
    update.away_score = away;
  }
  const ts = ev["startTimestamp"];
  if (typeof ts === "number") {
    const apiKickoff = new Date(ts * 1000).toISOString();
    const stored = existing.kickoff_at ? Date.parse(existing.kickoff_at) : NaN;
    if (!Number.isFinite(stored) || Math.abs(stored - Date.parse(apiKickoff)) > 60_000) {
      update.kickoff_at = apiKickoff;
    }
  }
  return { update, resolved: final };
}

/** Group unresolved matches per competition, oldest competition first (fair order). */
export function groupByCompetitionOldestFirst<T extends MatchLite>(matches: T[]): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const m of matches) {
    if (!m.competition_id) continue;
    const list = groups.get(m.competition_id) ?? [];
    list.push(m);
    groups.set(m.competition_id, list);
  }
  const oldest = (list: T[]) => Math.min(...list.map((m) => Date.parse(m.kickoff_at ?? "")));
  return [...groups.entries()].sort((a, b) => oldest(a[1]) - oldest(b[1]));
}

/**
 * True round-robin across runs: start right AFTER the competition the previous
 * run served last, so a small per-slot ceiling (4 calls, 5+ leagues) cannot
 * starve the leagues at the end of the list forever.
 */
export function rotateAfter<T extends [string, unknown]>(groups: T[], lastServed: string | null): T[] {
  if (!lastServed || groups.length < 2) return groups;
  const idx = groups.findIndex(([id]) => id === lastServed);
  if (idx < 0) return groups;
  return [...groups.slice(idx + 1), ...groups.slice(0, idx + 1)];
}

/** Provider states whose score fields are real (fixture sync). */
const FIXTURE_SCORED_TYPES = new Set(["finished", "inprogress", "interrupted", "suspended", "awarded"]);

/**
 * Status/score columns a fixture-sync upsert may write for one provider event.
 * - No provider status  -> write neither (never regress a known state to null).
 * - Scored state        -> status + both scores (a finished event without both
 *                          scores writes only the status, keeping existing values).
 * - Postponed/canceled  -> status + null scores (there is no result).
 * - notstarted          -> status only; existing scores are left untouched.
 */
export function fixtureStateFields(ev: ProviderEvent): Record<string, string | number | null> {
  const type = ev?.["status"]?.["type"];
  if (typeof type !== "string" || type.length === 0) return {};
  const home = ev["homeScore"]?.["current"];
  const away = ev["awayScore"]?.["current"];
  const hasScores = typeof home === "number" && typeof away === "number";
  if (FIXTURE_SCORED_TYPES.has(type)) {
    return hasScores ? { status: type, home_score: home, away_score: away } : { status: type };
  }
  if (type === "postponed" || type === "canceled" || type === "removed") {
    return { status: type, home_score: null, away_score: null };
  }
  return { status: type };
}

/**
 * A detail "checked" marker may be written only when the provider answered
 * (2xx or a per-item 404) AND the fetcher persisted without a database error.
 * Transient failures leave the marker empty so the item is retried later.
 */
export function shouldMarkChecked(jobStatus: string, httpStatus: number | null): boolean {
  if (jobStatus !== "success" && jobStatus !== "skipped") return false;
  if (httpStatus == null) return false;
  return (httpStatus >= 200 && httpStatus < 300) || isUnavailableStatus(httpStatus);
}

/**
 * After applying one `events/last/{page}` page, decide whether a deeper page
 * is still worth fetching: only when an unresolved match is OLDER than the
 * oldest event on this page and the provider has another page.
 */
export function nextPageAfter(
  remaining: MatchLite[],
  pageEvents: ProviderEvent[],
  page: number,
  hasNextPage: boolean,
): number | null {
  if (!hasNextPage || remaining.length === 0 || pageEvents.length === 0) return null;
  const oldestOnPage = Math.min(
    ...pageEvents
      .map((e) => (typeof e["startTimestamp"] === "number" ? e["startTimestamp"] * 1000 : NaN))
      .filter((n) => Number.isFinite(n)),
  );
  if (!Number.isFinite(oldestOnPage)) return null;
  const olderRemains = remaining.some((m) => Date.parse(m.kickoff_at ?? "") < oldestOnPage);
  return olderRemains ? page + 1 : null;
}

/** Total request ceiling for one run: the caller's cap, lowered by what the non-live budget can still afford. */
export function effectiveCallCeiling(requested: number, nonLiveRemaining: number | null): number {
  const cap = Math.max(0, Math.floor(requested));
  if (nonLiveRemaining == null) return cap;
  return Math.max(0, Math.min(cap, Math.floor(nonLiveRemaining)));
}

export type DetailKind = "lineups" | "stats" | "incidents";

export type DetailState = {
  status: string | null;
  home_score: number | null;
  away_score: number | null;
  has_lineups: boolean;
  has_stats: boolean;
  has_events: boolean;
  ratings_checked_at: string | null;
  stats_checked_at: string | null;
  incidents_checked_at: string | null;
};

/**
 * Which detail fetches a finished match still needs. A "checked" marker means
 * the provider was asked successfully and we accept its answer (possibly
 * "nothing available") — so we don't refetch complete or empty details forever.
 * Transient failures do NOT set markers, so they are retried later.
 */
export function detailNeeds(s: DetailState): DetailKind[] {
  if (s.status !== "finished") return [];
  const needs: DetailKind[] = [];
  if (!s.has_lineups && !s.ratings_checked_at) needs.push("lineups");
  if (!s.has_stats && !s.stats_checked_at) needs.push("stats");
  if (
    !s.has_events &&
    !s.incidents_checked_at &&
    s.home_score != null &&
    s.away_score != null
  ) {
    needs.push("incidents");
  }
  return needs;
}

/** Non-2xx that means "this item has no data" rather than "the provider is failing". */
export function isUnavailableStatus(status: number | null): boolean {
  return status === 404;
}

/** Any non-2xx other than a per-item 404 stops the run (no retry loops). */
export function isProviderFailure(status: number | null): boolean {
  if (status == null) return true;
  if (status >= 200 && status < 300) return false;
  return !isUnavailableStatus(status);
}
