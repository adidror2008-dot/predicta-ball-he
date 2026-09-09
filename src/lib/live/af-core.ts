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

function tokenSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter += 1;
  return inter === 0 ? 0 : inter / Math.min(sa.size, sb.size);
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
