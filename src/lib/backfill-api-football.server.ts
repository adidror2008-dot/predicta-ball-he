import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Verified, bounded backfill of overdue match results through API-Football.
 *
 * Iron rules honoured here:
 * - API-Football is a BACKUP source. It may only UPDATE status / score on
 *   matches that already exist (created by Sofascore, the identity owner).
 *   It never inserts teams, competitions or matches, never touches
 *   external_id / source, and never rewrites kickoff_at.
 * - Every outgoing call passes api_budget_take(provider='api-football').
 * - Provider truth only: status is copied from the provider, never inferred
 *   from the fact that the kickoff time has passed.
 *
 * Matching is league-scoped, not free fuzzy text: one request per competition
 * season returns the whole provider fixture list, and a DB row is only
 * accepted when it resolves to exactly one provider fixture id in that
 * league/season. Accepted evidence, per row:
 *   - "both"   – both club names match >= 0.90 and no rival candidate does
 *   - "anchor" – one side matches >= 0.90, the fixture is the only candidate
 *                in the +-3h window, and the other side is not contradictory
 *   - "pair"   – the club pair (both >= 0.90) occurs exactly once in the whole
 *                season, used when the stored kickoff is off by days
 * Anything else is left untouched and reported as unresolved evidence.
 */

const HOST = "https://v3.football.api-sports.io";
const PROVIDER = "api-football";
const LIVE_SOURCE = "api-football";

type AnyRec = Record<string, any>;

/** Sofascore tournament_id -> API-Football league id (verified via /leagues). */
const LEAGUE_BY_TOURNAMENT: Record<string, number> = {
  "7": 2, // UEFA Champions League
  "679": 3, // UEFA Europa League
  "17": 39, // Premier League
  "8": 140, // LaLiga
  "23": 135, // Serie A
  "35": 78, // Bundesliga
  "34": 61, // Ligue 1
  "37": 88, // Eredivisie
  "325": 71, // Brasileirão Série A
  "266": 383, // Ligat Ha'al
  "9355": 385, // Toto Cup Ligat Al
};

const MATCH_WINDOW_MS = 3 * 3600_000;
const PAIR_WINDOW_MS = 10 * 24 * 3600_000;
const STRONG = 0.9;
const NOT_CONTRADICTORY = 0.25;

export type BackfillEvidence = {
  match_id: string;
  match: string;
  competition: string;
  db_kickoff: string;
  db_status: string;
  matched_by: "both" | "anchor" | "pair" | null;
  provider_fixture_id: number | null;
  provider_kickoff: string | null;
  provider_teams: string | null;
  provider_status: string | null;
  provider_score: string | null;
  note?: string;
};

export type BackfillResult = {
  status: "success" | "partial" | "failed" | "skipped";
  reason?: string;
  key_present: boolean;
  plan: {
    requests_limit_day: number | null;
    requests_current: number | null;
    rate_limit_headers: Record<string, string>;
    quota_row_updated: boolean;
    daily_limit_applied: number | null;
    reserve_applied: number | null;
  };
  calls_used: number;
  candidates: number;
  leagues_fetched: number;
  matched: number;
  updated: number;
  unchanged: number;
  still_open_at_provider: number;
  unresolved: number;
  by_competition: Record<string, { before: number; updated: number }>;
  changes: BackfillEvidence[];
  remainder: BackfillEvidence[];
  conflicts: BackfillEvidence[];
  errors: string[];
  details_note: string;
};

const DROP_TOKENS = new Set([
  "fc", "sc", "sv", "ac", "as", "cf", "afc", "ssc", "vfb", "vfl", "bsc", "tsg",
  "rc", "cd", "ca", "ec", "se", "cr", "fk", "if", "bk", "us", "ud", "club",
  "de", "the", "cp", "sk", "ss", "kv", "rcd", "aj", "og", "sd", "tsv", "1",
]);

function normalizeName(raw: string): string[] {
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

function similarity(a: string[], b: string[]): number {
  return Math.max(tokenSimilarity(a, b), diceSimilarity(a.join(""), b.join("")));
}

function mapStatus(short: string): { status: string; final: boolean; live: boolean } | null {
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

/** Provider season key: calendar competitions use the year, others the start year. */
function seasonFor(kickoffIso: string, method: string | null): number {
  const d = new Date(kickoffIso);
  const y = d.getUTCFullYear();
  if (method === "calendar") return y;
  return d.getUTCMonth() + 1 >= 7 ? y : y - 1;
}

export async function runBackfillApiFootball(options: {
  cutoffIso: string;
  maxCalls?: number;
  dryRun?: boolean;
}): Promise<BackfillResult> {
  const startedAt = new Date().toISOString();
  const apiKey = process.env["API_FOOTBALL_KEY"];
  const maxCalls = options.maxCalls ?? 20;

  const result: BackfillResult = {
    status: "success",
    key_present: Boolean(apiKey && apiKey.length > 0),
    plan: {
      requests_limit_day: null,
      requests_current: null,
      rate_limit_headers: {},
      quota_row_updated: false,
      daily_limit_applied: null,
      reserve_applied: null,
    },
    calls_used: 0,
    candidates: 0,
    leagues_fetched: 0,
    matched: 0,
    updated: 0,
    unchanged: 0,
    still_open_at_provider: 0,
    unresolved: 0,
    by_competition: {},
    changes: [],
    remainder: [],
    conflicts: [],
    errors: [],
    details_note:
      "Project rule: API-Football may only update status/score on existing matches. Identity, kickoff times, lineups, events and statistics stay Sofascore-owned and were not written.",
  };

  const finish = async (status: BackfillResult["status"], reason?: string) => {
    result.status = status;
    if (reason) result.reason = reason;
    await supabaseAdmin.from("job_runs").insert({
      job_name: "backfill-api-football",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status,
      result_metric: result.updated,
      result_detail: result as never,
      error: result.errors[0] ?? null,
    });
    return result;
  };

  if (!apiKey) return finish("failed", "API_FOOTBALL_KEY missing");

  const call = async (
    path: string,
  ): Promise<{ status: number; json: AnyRec | null; headers: Headers } | null> => {
    if (result.calls_used >= maxCalls) return null;
    const { data: ok } = await supabaseAdmin.rpc("api_budget_take", {
      p_provider: PROVIDER,
      p_category: "bulk",
      p_count: 1,
    });
    if (ok !== true) {
      result.errors.push("budget_exhausted");
      return null;
    }
    result.calls_used += 1;
    const res = await fetch(`${HOST}${path}`, {
      headers: { "x-apisports-key": apiKey, accept: "application/json" },
    });
    const body = await res.text();
    let json: AnyRec | null = null;
    try {
      json = JSON.parse(body) as AnyRec;
    } catch {
      json = null;
    }
    if (res.status < 200 || res.status >= 300) {
      result.errors.push(`http ${res.status} on ${path.split("?")[0]}`);
    }
    return { status: res.status, json, headers: res.headers };
  };

  // ---------------------------------------------------------------- plan check
  const statusRes = await call("/status");
  if (!statusRes) return finish("failed", "status_call_blocked");
  for (const h of [
    "x-ratelimit-limit",
    "x-ratelimit-remaining",
    "x-ratelimit-requests-limit",
    "x-ratelimit-requests-remaining",
    "x-ratelimit-reset",
  ]) {
    const v = statusRes.headers.get(h);
    if (v) result.plan.rate_limit_headers[h] = v;
  }
  const reqs = statusRes.json?.["response"]?.["requests"] as AnyRec | undefined;
  const limitDay =
    (typeof reqs?.["limit_day"] === "number" ? (reqs["limit_day"] as number) : null) ??
    (Number(result.plan.rate_limit_headers["x-ratelimit-requests-limit"]) || null);
  result.plan.requests_limit_day = limitDay;
  result.plan.requests_current =
    typeof reqs?.["current"] === "number" ? (reqs["current"] as number) : null;
  if (statusRes.status !== 200) return finish("failed", "provider_status_not_ok");

  if (limitDay && limitDay > 0) {
    const reserve = Math.max(1, Math.round(limitDay * 0.05));
    const { error: qErr } = await supabaseAdmin.from("api_quotas").upsert(
      {
        provider: PROVIDER,
        daily_limit: limitDay,
        monthly_limit: null,
        per_minute_limit: null,
        live_reserve_daily: reserve,
        configured: true,
        notes: `PRO plan verified against provider /status on ${new Date().toISOString().slice(0, 10)}; daily_limit=${limitDay}, 5% reserve kept.`,
      } as never,
      { onConflict: "provider" },
    );
    if (qErr) result.errors.push(`quota_upsert: ${qErr.message}`);
    else {
      result.plan.quota_row_updated = true;
      result.plan.daily_limit_applied = limitDay;
      result.plan.reserve_applied = reserve;
    }
  }

  // ---------------------------------------------------------------- candidates
  const { data: rows, error: selErr } = await supabaseAdmin
    .from("matches")
    .select("id, kickoff_at, status, home_score, away_score, competition_id, home_team_id, away_team_id")
    .lt("kickoff_at", options.cutoffIso)
    .or("status.is.null,status.not.in.(finished,canceled,postponed,awarded,removed)")
    .order("kickoff_at", { ascending: true })
    .limit(500);
  if (selErr) return finish("failed", selErr.message);

  const candidates = (rows ?? []).filter((m) => m.kickoff_at && m.competition_id);
  result.candidates = candidates.length;
  if (candidates.length === 0) return finish("success", "nothing_to_do");

  const teamIds = [
    ...new Set(candidates.flatMap((m) => [m.home_team_id, m.away_team_id]).filter(Boolean)),
  ] as string[];
  const compIds = [...new Set(candidates.map((m) => m.competition_id).filter(Boolean))] as string[];

  const [{ data: teams }, { data: comps }, { data: aliases }] = await Promise.all([
    supabaseAdmin.from("teams").select("id, name_en, name_he, short_name").in("id", teamIds),
    supabaseAdmin
      .from("competitions")
      .select("id, name_he, tournament_id, season_calc_method")
      .in("id", compIds),
    supabaseAdmin.from("team_aliases").select("team_id, alias").in("team_id", teamIds),
  ]);

  const teamNames = new Map<string, string[][]>();
  for (const t of teams ?? []) {
    const forms = [t.name_en, t.short_name].filter(Boolean) as string[];
    teamNames.set(t.id, forms.map(normalizeName).filter((f) => f.length > 0));
  }
  for (const a of aliases ?? []) {
    const cur = teamNames.get(a.team_id) ?? [];
    const n = normalizeName(a.alias);
    if (n.length > 0) cur.push(n);
    teamNames.set(a.team_id, cur);
  }
  const compById = new Map((comps ?? []).map((c) => [c.id, c]));
  const teamLabel = new Map((teams ?? []).map((t) => [t.id, t.name_en ?? t.name_he ?? t.id]));

  const nameScore = (teamId: string | null, providerName: string): number => {
    if (!teamId) return 0;
    const pn = normalizeName(providerName);
    let best = 0;
    for (const f of teamNames.get(teamId) ?? []) best = Math.max(best, similarity(f, pn));
    return best;
  };

  for (const m of candidates) {
    const key = compById.get(m.competition_id ?? "")?.name_he ?? "ללא תחרות";
    result.by_competition[key] ??= { before: 0, updated: 0 };
    result.by_competition[key]!.before += 1;
  }

  // ------------------------------------------------- group by league + season
  const groups = new Map<string, { league: number; season: number; rows: typeof candidates }>();
  for (const m of candidates) {
    const comp = compById.get(m.competition_id ?? "");
    const league = comp?.tournament_id ? LEAGUE_BY_TOURNAMENT[String(comp.tournament_id)] : undefined;
    if (!league) {
      result.unresolved += 1;
      result.remainder.push({
        match_id: m.id,
        match: `${teamLabel.get(m.home_team_id ?? "") ?? "?"} - ${teamLabel.get(m.away_team_id ?? "") ?? "?"}`,
        competition: comp?.name_he ?? "ללא תחרות",
        db_kickoff: String(m.kickoff_at),
        db_status: m.status ?? "null",
        matched_by: null,
        provider_fixture_id: null,
        provider_kickoff: null,
        provider_teams: null,
        provider_status: null,
        provider_score: null,
        note: "no verified provider league mapping for this competition",
      });
      continue;
    }
    const season = seasonFor(String(m.kickoff_at), comp?.season_calc_method ?? null);
    const key = `${league}:${season}`;
    const g = groups.get(key) ?? { league, season, rows: [] as typeof candidates };
    g.rows.push(m);
    groups.set(key, g);
  }

  for (const [, group] of groups) {
    if (result.calls_used >= maxCalls) break;
    const res = await call(`/fixtures?league=${group.league}&season=${group.season}&timezone=UTC`);
    if (!res) break;
    if (res.status !== 200 || !res.json) continue;
    result.leagues_fetched += 1;
    const fixtures = (res.json["response"] as AnyRec[] | undefined) ?? [];

    for (const m of group.rows) {
      const comp = compById.get(m.competition_id ?? "");
      const compKey = comp?.name_he ?? "ללא תחרות";
      const label = `${teamLabel.get(m.home_team_id ?? "") ?? "?"} - ${teamLabel.get(m.away_team_id ?? "") ?? "?"}`;
      const koMs = Date.parse(String(m.kickoff_at));

      const scored = fixtures.map((fx) => {
        const h = nameScore(m.home_team_id, String(fx["teams"]?.["home"]?.["name"] ?? ""));
        const a = nameScore(m.away_team_id, String(fx["teams"]?.["away"]?.["name"] ?? ""));
        const when = Date.parse(String(fx["fixture"]?.["date"] ?? ""));
        return { fx, h, a, min: Math.min(h, a), max: Math.max(h, a), delta: Math.abs(when - koMs) };
      });

      const near = scored.filter((c) => Number.isFinite(c.delta) && c.delta <= MATCH_WINDOW_MS);
      const strongBoth = near.filter((c) => c.min >= STRONG);
      const anchored = near.filter((c) => c.max >= STRONG && c.min >= NOT_CONTRADICTORY);
      const pairSeason = scored.filter((c) => c.min >= STRONG && c.delta <= PAIR_WINDOW_MS);

      let pick: (typeof scored)[number] | null = null;
      let matchedBy: BackfillEvidence["matched_by"] = null;
      if (strongBoth.length === 1) {
        pick = strongBoth[0]!;
        matchedBy = "both";
      } else if (strongBoth.length === 0 && anchored.length === 1) {
        pick = anchored[0]!;
        matchedBy = "anchor";
      } else if (strongBoth.length === 0 && anchored.length === 0 && pairSeason.length === 1) {
        pick = pairSeason[0]!;
        matchedBy = "pair";
      }

      const evidence: BackfillEvidence = {
        match_id: m.id,
        match: label,
        competition: compKey,
        db_kickoff: String(m.kickoff_at),
        db_status: m.status ?? "null",
        matched_by: matchedBy,
        provider_fixture_id: pick ? Number(pick.fx["fixture"]?.["id"]) : null,
        provider_kickoff: pick ? String(pick.fx["fixture"]?.["date"]) : null,
        provider_teams: pick
          ? `${String(pick.fx["teams"]?.["home"]?.["name"])} vs ${String(pick.fx["teams"]?.["away"]?.["name"])}`
          : null,
        provider_status: pick ? String(pick.fx["fixture"]?.["status"]?.["short"]) : null,
        provider_score: pick
          ? `${pick.fx["goals"]?.["home"] ?? "null"}-${pick.fx["goals"]?.["away"] ?? "null"}`
          : null,
      };

      if (!pick || !matchedBy) {
        result.unresolved += 1;
        evidence.note =
          near.length === 0
            ? "no provider fixture within 3h of the stored kickoff, and no unique season pair"
            : "ambiguous candidates — left untouched";
        result.remainder.push(evidence);
        continue;
      }

      result.matched += 1;
      const st = pick.fx["fixture"]?.["status"] as AnyRec | undefined;
      const mapped = mapStatus(String(st?.["short"] ?? ""));
      if (!mapped) {
        evidence.note = "unmapped provider status";
        result.conflicts.push(evidence);
        continue;
      }
      if (mapped.status === "notstarted") {
        // Provider says the fixture has not been played: the stored kickoff is
        // a placeholder, not a missing result. Never invent an outcome.
        result.still_open_at_provider += 1;
        evidence.note = "provider has this fixture as not started — stored kickoff is a placeholder";
        result.remainder.push(evidence);
        continue;
      }

      const goals = pick.fx["goals"] as AnyRec | undefined;
      const hs = typeof goals?.["home"] === "number" ? (goals["home"] as number) : null;
      const as_ = typeof goals?.["away"] === "number" ? (goals["away"] as number) : null;
      if (mapped.status === "finished" && (hs == null || as_ == null)) {
        evidence.note = "provider finished without a score — skipped";
        result.conflicts.push(evidence);
        continue;
      }

      const update: AnyRec = {
        status: mapped.status,
        live_source: LIVE_SOURCE,
        fetched_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      if (mapped.status === "finished" || mapped.status === "awarded" || mapped.live) {
        if (hs != null) update["home_score"] = hs;
        if (as_ != null) update["away_score"] = as_;
      }
      update["minute"] = mapped.live && typeof st?.["elapsed"] === "number" ? st["elapsed"] : null;
      if (mapped.live) result.still_open_at_provider += 1;

      if (m.status === mapped.status && m.home_score === hs && m.away_score === as_) {
        result.unchanged += 1;
        continue;
      }

      if (!options.dryRun) {
        const { error: upErr } = await supabaseAdmin
          .from("matches")
          .update(update as never)
          .eq("id", m.id)
          .or("status.is.null,status.not.in.(finished,canceled,postponed,awarded,removed)");
        if (upErr) {
          result.errors.push(`update ${m.id}: ${upErr.message}`);
          continue;
        }
      }
      result.updated += 1;
      result.by_competition[compKey] ??= { before: 0, updated: 0 };
      result.by_competition[compKey]!.updated += 1;
      result.changes.push(evidence);
    }
  }

  return finish(result.errors.length > 0 ? "partial" : "success");
}
