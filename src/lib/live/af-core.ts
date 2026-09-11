/**
 * Pure helpers for the API-Football live score/status pipeline.
 *
 * API-Football is the PRIMARY source for score + status only. It never
 * creates teams, competitions or matches, never touches external_id/source,
 * and never rewrites kickoff_at — identity and schedule stay Sofascore-owned.
 */

export type AfStatusShort = string;

export type AfMappedStatus = {
  /** Internal status stored on matches.status. */
  status: string;
  /** No further change expected. */
  final: boolean;
  live: boolean;
};

/**
 * Provider status -> internal status. Unknown codes return null so the
 * caller writes nothing rather than guessing.
 */
export function mapAfStatus(short: AfStatusShort): AfMappedStatus | null {
  switch (short) {
    case "FT":
    case "AET":
    case "PEN":
      return { status: "finished", final: true, live: false };
    case "PST":
      return { status: "postponed", final: true, live: false };
    case "CANC":
    case "ABD":
      return { status: "canceled", final: true, live: false };
    case "AWD":
    case "WO":
      return { status: "awarded", final: true, live: false };
    case "1H":
    case "2H":
    case "HT":
    case "ET":
    case "BT":
    case "P":
    case "LIVE":
    case "INT":
    case "SUSP":
      return { status: "inprogress", final: false, live: true };
    case "NS":
    case "TBD":
      return { status: "notstarted", final: false, live: false };
    default:
      return null;
  }
}

export const FINAL_STATUSES = ["finished", "canceled", "postponed", "awarded", "removed"];

export type AfFixture = {
  fixture?: {
    id?: number;
    date?: string;
    status?: { short?: string; elapsed?: number | null };
  };
  league?: { id?: number; season?: number; round?: string };
  teams?: { home?: { name?: string }; away?: { name?: string } };
  goals?: { home?: number | null; away?: number | null };
  score?: {
    halftime?: { home?: number | null; away?: number | null };
    fulltime?: { home?: number | null; away?: number | null };
    extratime?: { home?: number | null; away?: number | null };
    penalty?: { home?: number | null; away?: number | null };
  };
};

export type MatchRowForUpdate = {
  status: string | null;
  home_score: number | null;
  away_score: number | null;
  minute?: number | null;
};

export type AfUpdate = {
  status: string;
  minute: number | null;
  home_score: number | null;
  away_score: number | null;
  live_source: string;
  fetched_at: string;
};

/**
 * Regulation/extra-time score to store. Penalty shootouts are NOT added to
 * the score — `score.penalty` decides the tie, not the match score.
 */
export function afScorePair(fx: AfFixture): { home: number | null; away: number | null } {
  const g = fx.goals ?? {};
  if (typeof g.home === "number" && typeof g.away === "number") {
    return { home: g.home, away: g.away };
  }
  const ft = fx.score?.fulltime ?? {};
  const et = fx.score?.extratime ?? {};
  if (typeof et.home === "number" && typeof et.away === "number") {
    return { home: et.home, away: et.away };
  }
  if (typeof ft.home === "number" && typeof ft.away === "number") {
    return { home: ft.home, away: ft.away };
  }
  return { home: null, away: null };
}

/**
 * Build the score/status update for one fixture, or null when nothing may be
 * written. Rules:
 * - unknown provider status -> no write
 * - "finished" requires both real scores -> never a fabricated final
 * - an already-final row is never downgraded to a non-final status
 * - a missing provider score never nulls a real score already stored
 */
export function buildAfUpdate(
  row: MatchRowForUpdate,
  fx: AfFixture,
  nowIso: string,
  liveSource = "api-football",
): AfUpdate | null {
  const short = fx.fixture?.status?.short;
  if (!short) return null;
  const mapped = mapAfStatus(short);
  if (!mapped) return null;

  const { home, away } = afScorePair(fx);
  if (mapped.status === "finished" && (home === null || away === null)) return null;

  const wasFinal = row.status != null && FINAL_STATUSES.includes(row.status);
  if (wasFinal && !mapped.final) return null;

  const elapsed = fx.fixture?.status?.elapsed;
  const minute = mapped.live && typeof elapsed === "number" ? elapsed : null;

  const nextHome = home ?? row.home_score;
  const nextAway = away ?? row.away_score;

  const unchanged =
    row.status === mapped.status &&
    row.home_score === nextHome &&
    row.away_score === nextAway &&
    (row.minute ?? null) === minute;
  if (unchanged) return null;

  return {
    status: mapped.status,
    minute,
    home_score: nextHome,
    away_score: nextAway,
    live_source: liveSource,
    fetched_at: nowIso,
  };
}

// ------------------------------------------------------------------ matching

const DROP_TOKENS = new Set([
  "fc", "sc", "sv", "ac", "as", "cf", "afc", "ssc", "vfb", "vfl", "bsc", "tsg",
  "rc", "cd", "ca", "ec", "se", "cr", "fk", "if", "bk", "us", "ud", "club",
  "de", "the", "cp", "sk", "ss", "kv", "rcd", "aj", "og", "sd", "tsv",
]);

export function normalizeName(raw: string): string[] {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((t) => t.length > 0 && !DROP_TOKENS.has(t) && !/^\d+$/.test(t));
}

/**
 * Overlap over the LARGER token set, never the smaller one. Dividing by the
 * smaller set makes any subset a perfect match ("United" == "Manchester
 * United" == "Newcastle United"), which is exactly the unsafe behaviour this
 * pipeline must not have.
 */
function tokenSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter += 1;
  return inter === 0 ? 0 : inter / Math.max(sa.size, sb.size);
}


function diceSimilarity(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i += 1) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  let inter = 0;
  for (const [g, n] of ga) inter += Math.min(n, gb.get(g) ?? 0);
  return (2 * inter) / (a.length - 1 + (b.length - 1));
}

export function similarity(a: string[], b: string[]): number {
  return Math.max(tokenSimilarity(a, b), diceSimilarity(a.join(""), b.join("")));
}

/** Both sides must match strongly — there is no "non-contradictory" anchor. */
export const STRONG_NAME_MATCH = 0.9;

export function bestNameScore(forms: readonly string[][], providerName: string): number {
  const pn = normalizeName(providerName);
  let best = 0;
  for (const f of forms) best = Math.max(best, similarity(f, pn));
  return best;
}

export type MappingCandidate = {
  fixtureId: number;
  homeName: string;
  awayName: string;
  kickoffIso: string;
  round: string | null;
};

/**
 * Accept a mapping only when exactly one fixture in the league+season has
 * both club names matching strongly in the same home/away orientation.
 * Kickoff is evidence, never the decider — stored kickoffs may be stale.
 */
export function resolveUniqueFixture(
  homeForms: readonly string[][],
  awayForms: readonly string[][],
  candidates: readonly MappingCandidate[],
): { fixture: MappingCandidate; homeScore: number; awayScore: number } | null {
  const hits: Array<{ fixture: MappingCandidate; homeScore: number; awayScore: number }> = [];
  for (const c of candidates) {
    const homeScore = bestNameScore(homeForms, c.homeName);
    const awayScore = bestNameScore(awayForms, c.awayName);
    if (homeScore >= STRONG_NAME_MATCH && awayScore >= STRONG_NAME_MATCH) {
      hits.push({ fixture: c, homeScore, awayScore });
    }
  }
  return hits.length === 1 ? hits[0]! : null;
}

// ------------------------------------------------------- reconciliation pacing

/**
 * How long to wait before reading a mapped fixture again. Keeps the sweep
 * bounded and fair: a fixture the provider says has not started yet is not
 * probed again until shortly before its provider kickoff, so far-future rows
 * (e.g. league-phase fixtures stored with a placeholder kickoff) never starve
 * the rows that are actually due.
 */
export function nextCheckDelayMs(
  short: string | null,
  providerKickoffIso: string | null,
  nowMs: number,
): number {
  const mapped = short ? mapAfStatus(short) : null;
  if (mapped?.live) return 2 * 60_000;
  if (mapped?.final) return 24 * 60 * 60_000;
  if (mapped?.status === "notstarted") {
    const ts = providerKickoffIso ? Date.parse(providerKickoffIso) : NaN;
    if (Number.isFinite(ts) && ts > nowMs) {
      // wake up 5 minutes before the provider kickoff, never sooner than 30 min
      return Math.max(ts - nowMs - 5 * 60_000, 30 * 60_000);
    }
    return 30 * 60_000;
  }
  return 60 * 60_000;
}

/** Provider payloads that carry an error object/array are NOT successes. */
export function providerErrorText(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const errors = (json as Record<string, unknown>)["errors"];
  if (!errors) return null;
  if (Array.isArray(errors)) return errors.length > 0 ? String(errors[0]).slice(0, 200) : null;
  if (typeof errors === "object") {
    const entries = Object.entries(errors as Record<string, unknown>);
    if (entries.length === 0) return null;
    return entries.map(([k, v]) => `${k}: ${String(v)}`).join("; ").slice(0, 200);
  }
  const s = String(errors).trim();
  return s.length > 0 ? s.slice(0, 200) : null;
}

/** True when the provider error/status means "stop calling for a while". */
export function isQuotaError(text: string | null, httpStatus: number | null): boolean {
  if (httpStatus === 429) return true;
  if (!text) return false;
  return /quota|rate ?limit|too many requests|exceeded/i.test(text);
}

// ------------------------------------------------- failure classification

export type ProviderFailureKind = "none" | "minute" | "daily" | "unknown";

export type ProviderFailure = {
  kind: ProviderFailureKind;
  /** How long to stop calling the provider, in milliseconds. 0 when kind is "none". */
  cooldownMs: number;
  /** Sanitized, key-free explanation of what decided the classification. */
  evidence: string;
};

const MINUTE_BASE_MS = 65_000;
const MINUTE_MAX_MS = 15 * 60_000;
const UNKNOWN_BASE_MS = 5 * 60_000;

/**
 * Retry-After per RFC 9110: delta-seconds or an HTTP-date. Anything else, a
 * non-positive delta, or an absurd value is rejected rather than trusted.
 */
export function parseRetryAfter(raw: string | null | undefined, nowMs: number): number | null {
  if (raw == null) return null;
  const v = raw.trim();
  if (v.length === 0) return null;
  if (/^\d+$/.test(v)) {
    const secs = Number(v);
    if (secs <= 0 || secs > 86_400) return null;
    return secs * 1000;
  }
  const ts = Date.parse(v);
  if (!Number.isFinite(ts)) return null;
  const delta = ts - nowMs;
  if (delta <= 0 || delta > 86_400_000) return null;
  return delta;
}

/**
 * A header is only evidence when it is actually present AND numeric. A missing
 * header must never be read as 0 — that is how a per-minute hiccup used to be
 * mistaken for a whole day of exhausted quota.
 */
export function numericHeader(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const v = raw.trim();
  if (v.length === 0 || !/^-?\d+(\.\d+)?$/.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function boundedBackoff(base: number, max: number, consecutiveFailures: number): number {
  const n = Math.max(0, Math.min(consecutiveFailures, 10));
  return Math.min(max, base * Math.pow(2, n));
}

export type ProviderHeaders = {
  retryAfter?: string | null;
  /** x-ratelimit-requests-limit / -remaining (daily plan counters) */
  dayLimit?: string | null;
  dayRemaining?: string | null;
  /** x-ratelimit-limit / -remaining (per-minute counters) */
  minuteLimit?: string | null;
  minuteRemaining?: string | null;
};

/**
 * Decide WHY the provider refused and for how long to back off.
 *
 * - a per-minute rate limit is a short, self-healing condition
 * - a daily/plan exhaustion needs explicit evidence: the provider saying so,
 *   or a genuine remaining=0 against a positive daily limit
 * - anything else 429-ish gets a conservative bounded cooldown, never a
 *   day-long shutdown
 */
export function classifyProviderFailure(opts: {
  text: string | null;
  httpStatus: number | null;
  headers?: ProviderHeaders;
  nowMs: number;
  consecutiveFailures?: number;
}): ProviderFailure {
  const { text, httpStatus, nowMs } = opts;
  const headers = opts.headers ?? {};
  const fails = opts.consecutiveFailures ?? 0;
  if (!isQuotaError(text, httpStatus)) return { kind: "none", cooldownMs: 0, evidence: "" };

  const retryAfterMs = parseRetryAfter(headers.retryAfter, nowMs);
  const dayLimit = numericHeader(headers.dayLimit);
  const dayRemaining = numericHeader(headers.dayRemaining);
  const minuteLimit = numericHeader(headers.minuteLimit);
  const minuteRemaining = numericHeader(headers.minuteRemaining);

  const t = text ?? "";
  const saysMinute = /per minute|rate ?limit|too many requests/i.test(t);
  const saysDaily = /per day|daily|day quota|requests on your current plan|monthly/i.test(t);

  const minuteExhausted =
    minuteLimit != null && minuteLimit > 0 && minuteRemaining != null && minuteRemaining <= 0;
  const dayExhausted =
    dayLimit != null && dayLimit > 0 && dayRemaining != null && dayRemaining <= 0;

  if (saysDaily || (dayExhausted && !saysMinute)) {
    const untilNextDay = new Date(new Date(nowMs).setUTCHours(24, 5, 0, 0)).getTime() - nowMs;
    return {
      kind: "daily",
      cooldownMs: retryAfterMs ?? Math.max(untilNextDay, 60_000),
      evidence: saysDaily
        ? "provider text names a daily/plan quota"
        : `daily counters exhausted (remaining ${dayRemaining}/${dayLimit})`,
    };
  }

  if (saysMinute || minuteExhausted) {
    return {
      kind: "minute",
      cooldownMs: Math.min(
        MINUTE_MAX_MS,
        retryAfterMs ?? boundedBackoff(MINUTE_BASE_MS, MINUTE_MAX_MS, fails),
      ),
      evidence: saysMinute
        ? "provider text names a per-minute rate limit"
        : `minute counters exhausted (remaining ${minuteRemaining}/${minuteLimit})`,
    };
  }

  return {
    kind: "unknown",
    cooldownMs: Math.min(
      MINUTE_MAX_MS,
      retryAfterMs ?? boundedBackoff(UNKNOWN_BASE_MS, MINUTE_MAX_MS, fails),
    ),
    evidence: "unclassified 429 — conservative bounded cooldown",
  };
}

/**
 * A persisted pause is reclassifiable only when its stored reason is
 * unmistakably a per-minute rate limit. Daily quota, plan and account
 * problems stay untouched.
 */
export function isMinuteRateReason(reason: string | null | undefined): boolean {
  if (!reason) return false;
  if (/per day|daily|monthly|suspend|account|unauthor|forbidden|plan/i.test(reason)) return false;
  return /per minute|rate ?limit|too many requests/i.test(reason);
}

