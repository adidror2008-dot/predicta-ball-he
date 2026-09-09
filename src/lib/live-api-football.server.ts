import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  buildAfUpdate,
  FINAL_STATUSES,
  normalizeName,
  resolveUniqueFixture,
  type AfFixture,
  type AfUpdate,
  type MappingCandidate,
} from "@/lib/live/af-core";

/**
 * API-Football is the PRIMARY source for live SCORE + STATUS.
 *
 * Hard boundaries kept from the project rules:
 * - it never inserts teams / competitions / matches, never touches
 *   external_id, source or kickoff_at — Sofascore still owns identity and
 *   schedule, and lineups / stats / events stay Sofascore-owned;
 * - every outgoing request passes api_budget_take(provider='api-football');
 * - absence from the live feed NEVER means "finished": a dropped match is
 *   reconciled with an explicit fixture read, and only the provider status
 *   decides;
 * - no automatic retries. A failed call is reported and the tick stops using
 *   the provider for this run.
 */

const HOST = "https://v3.football.api-sports.io";
export const AF_PROVIDER = "api-football";

/** Sofascore tournament_id -> API-Football league id (verified via /leagues). */
const LEAGUE_BY_TOURNAMENT: Record<string, number> = {
  "7": 2,
  "679": 3,
  "17": 39,
  "8": 140,
  "23": 135,
  "35": 78,
  "34": 61,
  "37": 88,
  "325": 71,
  "266": 383,
  "9355": 385,
};

type AnyRec = Record<string, any>;

export type MatchRow = {
  id: string;
  external_id: string | null;
  competition_id: string | null;
  status: string | null;
  minute: number | null;
  home_score: number | null;
  away_score: number | null;
  kickoff_at: string | null;
  live_source: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
};

export type AfApplied = { row: MatchRow; update: AfUpdate };

export type AfLiveResult = {
  key_present: boolean;
  calls_used: number;
  budget_blocked: boolean;
  provider_error: string | null;
  live_fixtures: number;
  mapped_live: number;
  updated: number;
  reconciled_checked: number;
  reconciled_settled: number;
  mappings_created: number;
  mapping_calls: number;
  applied: AfApplied[];
};

async function take(category: "live" | "bulk", count = 1): Promise<boolean> {
  const { data } = await supabaseAdmin.rpc("api_budget_take", {
    p_provider: AF_PROVIDER,
    p_category: category,
    p_count: count,
  });
  return data === true;
}

function makeCaller(apiKey: string, result: AfLiveResult) {
  return async function call(
    path: string,
    category: "live" | "bulk",
  ): Promise<AnyRec | null> {
    if (!(await take(category))) {
      result.budget_blocked = true;
      return null;
    }
    result.calls_used += 1;
    const res = await fetch(`${HOST}${path}`, {
      headers: { "x-apisports-key": apiKey, accept: "application/json" },
    });
    const text = await res.text();
    if (res.status < 200 || res.status >= 300) {
      // No automatic retry — surface and stop.
      result.provider_error = `http ${res.status} on ${path.split("?")[0]}`;
      return null;
    }
    try {
      return JSON.parse(text) as AnyRec;
    } catch {
      result.provider_error = `unparsable body on ${path.split("?")[0]}`;
      return null;
    }
  };
}

function toCandidate(fx: AfFixture): MappingCandidate | null {
  const id = fx.fixture?.id;
  const home = fx.teams?.home?.name;
  const away = fx.teams?.away?.name;
  const date = fx.fixture?.date;
  if (typeof id !== "number" || !home || !away || !date) return null;
  return { fixtureId: id, homeName: home, awayName: away, kickoffIso: date, round: fx.league?.round ?? null };
}

const MATCH_COLUMNS =
  "id, external_id, competition_id, status, minute, home_score, away_score, kickoff_at, live_source, home_team_id, away_team_id";

/** Season key: calendar competitions use the year, others the start year. */
function seasonFor(kickoffIso: string, method: string | null): number {
  const d = new Date(kickoffIso);
  const y = d.getUTCFullYear();
  if (method === "calendar") return y;
  return d.getUTCMonth() + 1 >= 7 ? y : y - 1;
}

/**
 * Batched, bounded, cached mapping discovery: one league+season fixture list
 * per call, shared by every match in that group. Never per user, never per
 * match. A mapping is stored only when exactly one fixture in the season has
 * both club names matching strongly in the same orientation.
 */
async function discoverMappings(
  call: ReturnType<typeof makeCaller>,
  result: AfLiveResult,
  maxCalls: number,
  windowBeforeMs: number,
  windowAfterMs: number,
): Promise<void> {
  if (maxCalls <= 0) return;
  const now = Date.now();

  const { data: rows } = await supabaseAdmin
    .from("matches")
    .select(MATCH_COLUMNS)
    .gte("kickoff_at", new Date(now - windowBeforeMs).toISOString())
    .lte("kickoff_at", new Date(now + windowAfterMs).toISOString())
    .or(`status.is.null,status.not.in.(${FINAL_STATUSES.join(",")})`)
    .limit(500);

  const candidates = (rows ?? []).filter(
    (m) => m.kickoff_at && m.competition_id && m.home_team_id && m.away_team_id,
  ) as MatchRow[];
  if (candidates.length === 0) return;

  const { data: existing } = await supabaseAdmin
    .from("match_provider_map")
    .select("match_id")
    .eq("provider", AF_PROVIDER)
    .in("match_id", candidates.map((m) => m.id));
  const mapped = new Set((existing ?? []).map((r) => r.match_id));
  const todo = candidates.filter((m) => !mapped.has(m.id));
  if (todo.length === 0) return;

  const teamIds = [
    ...new Set(todo.flatMap((m) => [m.home_team_id, m.away_team_id]).filter(Boolean) as string[]),
  ];
  const compIds = [...new Set(todo.map((m) => m.competition_id).filter(Boolean) as string[])];

  const [{ data: teams }, { data: comps }, { data: aliases }] = await Promise.all([
    supabaseAdmin.from("teams").select("id, name_en, short_name").in("id", teamIds),
    supabaseAdmin
      .from("competitions")
      .select("id, tournament_id, season_calc_method")
      .in("id", compIds),
    supabaseAdmin.from("team_aliases").select("team_id, alias").in("team_id", teamIds),
  ]);

  const forms = new Map<string, string[][]>();
  const push = (id: string, raw: string | null) => {
    if (!raw) return;
    const n = normalizeName(raw);
    if (n.length === 0) return;
    const cur = forms.get(id) ?? [];
    cur.push(n);
    forms.set(id, cur);
  };
  for (const t of teams ?? []) {
    push(t.id, t.name_en);
    push(t.id, t.short_name);
  }
  for (const a of aliases ?? []) push(a.team_id, a.alias);

  const compById = new Map((comps ?? []).map((c) => [c.id, c]));

  const groups = new Map<string, { league: number; season: number; rows: MatchRow[] }>();
  for (const m of todo) {
    const comp = compById.get(m.competition_id!);
    const league = comp?.tournament_id ? LEAGUE_BY_TOURNAMENT[String(comp.tournament_id)] : undefined;
    if (!league) continue;
    const season = seasonFor(String(m.kickoff_at), comp?.season_calc_method ?? null);
    const key = `${league}:${season}`;
    const g = groups.get(key) ?? { league, season, rows: [] };
    g.rows.push(m);
    groups.set(key, g);
  }

  for (const [, group] of groups) {
    if (result.mapping_calls >= maxCalls) break;
    const json = await call(`/fixtures?league=${group.league}&season=${group.season}`, "bulk");
    result.mapping_calls += 1;
    if (!json) break;
    const fixtures = ((json["response"] as AfFixture[] | undefined) ?? [])
      .map(toCandidate)
      .filter((c): c is MappingCandidate => c !== null);
    if (fixtures.length === 0) continue;

    for (const m of group.rows) {
      const hit = resolveUniqueFixture(
        forms.get(m.home_team_id!) ?? [],
        forms.get(m.away_team_id!) ?? [],
        fixtures,
      );
      if (!hit) continue;
      const { error } = await supabaseAdmin.from("match_provider_map").insert({
        match_id: m.id,
        provider: AF_PROVIDER,
        provider_fixture_id: hit.fixture.fixtureId,
        league_id: group.league,
        season: group.season,
        round: hit.fixture.round,
        evidence: {
          provider_teams: `${hit.fixture.homeName} - ${hit.fixture.awayName}`,
          provider_kickoff: hit.fixture.kickoffIso,
          db_kickoff: m.kickoff_at,
          home_name_score: Number(hit.homeScore.toFixed(3)),
          away_name_score: Number(hit.awayScore.toFixed(3)),
          rule: "unique strong both-name match inside league+season",
        } as never,
      } as never);
      if (!error) result.mappings_created += 1;
    }
  }
}

async function applyFixtures(
  fixtures: AfFixture[],
  byFixtureId: Map<number, MatchRow>,
  result: AfLiveResult,
): Promise<number> {
  const nowIso = new Date().toISOString();
  let written = 0;
  for (const fx of fixtures) {
    const id = fx.fixture?.id;
    if (typeof id !== "number") continue;
    const row = byFixtureId.get(id);
    if (!row) continue;
    const update = buildAfUpdate(row, fx, nowIso, AF_PROVIDER);
    if (!update) continue;
    const { error } = await supabaseAdmin.from("matches").update(update as never).eq("id", row.id);
    if (error) continue;
    written += 1;
    result.applied.push({ row, update });
  }
  return written;
}

export async function runAfLive(options?: {
  mappingCalls?: number;
  reconcileLimit?: number;
}): Promise<AfLiveResult> {
  const apiKey = process.env["API_FOOTBALL_KEY"];
  const result: AfLiveResult = {
    key_present: Boolean(apiKey && apiKey.length > 0),
    calls_used: 0,
    budget_blocked: false,
    provider_error: null,
    live_fixtures: 0,
    mapped_live: 0,
    updated: 0,
    reconciled_checked: 0,
    reconciled_settled: 0,
    mappings_created: 0,
    mapping_calls: 0,
    applied: [],
  };
  if (!apiKey) {
    result.provider_error = "API_FOOTBALL_KEY missing";
    return result;
  }

  const call = makeCaller(apiKey, result);

  // 1. mapping discovery (bounded, batched, shared) — before the sweep so a
  //    newly mapped match is already covered by this tick's live feed.
  await discoverMappings(call, result, options?.mappingCalls ?? 1, 2 * 86_400_000, 8 * 86_400_000);
  if (result.provider_error) return result;

  // 2. ONE aggregated live request for every user and every match.
  const live = await call("/fixtures?live=all", "live");
  if (!live) return result;
  const liveFixtures = (live["response"] as AfFixture[] | undefined) ?? [];
  result.live_fixtures = liveFixtures.length;

  const liveIds = liveFixtures
    .map((f) => f.fixture?.id)
    .filter((v): v is number => typeof v === "number");

  const byFixtureId = new Map<number, MatchRow>();
  const liveMatchIds = new Set<string>();
  if (liveIds.length > 0) {
    const { data: maps } = await supabaseAdmin
      .from("match_provider_map")
      .select("match_id, provider_fixture_id")
      .eq("provider", AF_PROVIDER)
      .in("provider_fixture_id", liveIds);
    const matchIds = (maps ?? []).map((m) => m.match_id);
    if (matchIds.length > 0) {
      const { data: rows } = await supabaseAdmin
        .from("matches")
        .select(MATCH_COLUMNS)
        .in("id", matchIds);
      const rowById = new Map((rows ?? []).map((r) => [r.id, r as MatchRow]));
      for (const m of maps ?? []) {
        const row = rowById.get(m.match_id);
        if (!row) continue;
        byFixtureId.set(Number(m.provider_fixture_id), row);
        liveMatchIds.add(row.id);
      }
    }
  }
  result.mapped_live = byFixtureId.size;
  result.updated += await applyFixtures(liveFixtures, byFixtureId, result);

  // 3. Reconciliation. A match that was live for us but is missing from the
  //    feed is NOT assumed finished — its fixture is read explicitly and only
  //    the provider status is written.
  const { data: dropped } = await supabaseAdmin
    .from("matches")
    .select(`${MATCH_COLUMNS}, match_provider_map!inner(provider, provider_fixture_id)`)
    .eq("live_source", AF_PROVIDER)
    .eq("match_provider_map.provider", AF_PROVIDER)
    .not("status", "in", `(${FINAL_STATUSES.join(",")})`)
    .limit(60);

  const toCheck: Array<{ row: MatchRow; fixtureId: number }> = [];
  for (const raw of (dropped ?? []) as AnyRec[]) {
    const link = Array.isArray(raw["match_provider_map"])
      ? raw["match_provider_map"][0]
      : raw["match_provider_map"];
    const fixtureId = Number(link?.["provider_fixture_id"]);
    if (!Number.isFinite(fixtureId)) continue;
    if (liveMatchIds.has(String(raw["id"]))) continue;
    const { match_provider_map: _drop, ...row } = raw;
    toCheck.push({ row: row as MatchRow, fixtureId });
  }

  const reconcileLimit = options?.reconcileLimit ?? 20;
  const batch = toCheck.slice(0, reconcileLimit);
  result.reconciled_checked = batch.length;
  if (batch.length > 0) {
    const json = await call(`/fixtures?ids=${batch.map((b) => b.fixtureId).join("-")}`, "live");
    if (json) {
      const map = new Map(batch.map((b) => [b.fixtureId, b.row]));
      const settled = await applyFixtures(
        (json["response"] as AfFixture[] | undefined) ?? [],
        map,
        result,
      );
      result.reconciled_settled = settled;
      result.updated += settled;
    }
  }

  return result;
}
