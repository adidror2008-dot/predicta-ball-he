import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  buildAfUpdate,
  FINAL_STATUSES,
  isQuotaError,
  nextCheckDelayMs,
  normalizeName,
  providerErrorText,
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
 * - no automatic retries. A failed call is reported, a quota/rate failure
 *   persists a bounded pause, and the tick stops using the provider.
 */

const HOST = "https://v3.football.api-sports.io";
export const AF_PROVIDER = "api-football";
const PAUSE_KEY = "af_paused_until";
const PAUSE_REASON_KEY = "af_pause_reason";

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
  /** Core live health: the aggregated live read succeeded this tick. */
  live_ok: boolean;
  /** The live reserve itself was exhausted (core failure). */
  live_budget_blocked: boolean;
  /** Optional background work (mapping discovery) had no budget. Never a core failure. */
  bulk_budget_blocked: boolean;
  provider_error: string | null;
  paused_until: string | null;
  live_fixtures: number;
  mapped_live: number;
  updated: number;
  reconciled_checked: number;
  reconciled_settled: number;
  mappings_created: number;
  mapping_calls: number;
  discovery_groups: number;
  discovery_unresolved: number;
  unsupported_competitions: string[];
  /** Every match we have authoritative provider state for this tick. */
  handled_external_ids: string[];
  handled_match_ids: string[];
  applied: AfApplied[];
};

function emptyResult(keyPresent: boolean): AfLiveResult {
  return {
    key_present: keyPresent,
    calls_used: 0,
    live_ok: false,
    live_budget_blocked: false,
    bulk_budget_blocked: false,
    provider_error: null,
    paused_until: null,
    live_fixtures: 0,
    mapped_live: 0,
    updated: 0,
    reconciled_checked: 0,
    reconciled_settled: 0,
    mappings_created: 0,
    mapping_calls: 0,
    discovery_groups: 0,
    discovery_unresolved: 0,
    unsupported_competitions: [],
    handled_external_ids: [],
    handled_match_ids: [],
    applied: [],
  };
}

async function take(category: "live" | "bulk", count = 1): Promise<boolean> {
  const { data } = await supabaseAdmin.rpc("api_budget_take", {
    p_provider: AF_PROVIDER,
    p_category: category,
    p_count: count,
  });
  return data === true;
}

async function readPause(): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("cron_config")
    .select("value")
    .eq("key", PAUSE_KEY)
    .maybeSingle();
  const until = data?.value ? Date.parse(data.value) : NaN;
  if (!Number.isFinite(until) || until <= Date.now()) return null;
  return new Date(until).toISOString();
}

/** Bounded pause; it always expires so recovery is automatic and sparse. */
async function setPause(untilIso: string, reason: string): Promise<void> {
  await supabaseAdmin
    .from("cron_config")
    .upsert({ key: PAUSE_KEY, value: untilIso }, { onConflict: "key" });
  await supabaseAdmin
    .from("cron_config")
    .upsert({ key: PAUSE_REASON_KEY, value: reason.slice(0, 300) }, { onConflict: "key" });
}

/**
 * Reconcile the provider's own usage counter with ours: it is recorded as a
 * conservative floor for today, never added to the local count.
 */
async function noteUsageHeaders(res: Response): Promise<void> {
  const limit = Number(res.headers.get("x-ratelimit-requests-limit"));
  const remaining = Number(res.headers.get("x-ratelimit-requests-remaining"));
  if (!Number.isFinite(limit) || !Number.isFinite(remaining)) return;
  const used = limit - remaining;
  if (used < 0) return;
  await supabaseAdmin.rpc("api_budget_note_reported", {
    p_provider: AF_PROVIDER,
    p_period: new Date().toISOString().slice(0, 10),
    p_used: used,
  });
}

function makeCaller(apiKey: string, result: AfLiveResult) {
  return async function call(
    path: string,
    category: "live" | "bulk",
  ): Promise<AnyRec | null> {
    if (result.paused_until) return null;
    if (!(await take(category))) {
      if (category === "live") result.live_budget_blocked = true;
      else result.bulk_budget_blocked = true;
      return null;
    }
    result.calls_used += 1;
    const endpoint = path.split("?")[0];
    let res: Response;
    try {
      res = await fetch(`${HOST}${path}`, {
        headers: { "x-apisports-key": apiKey, accept: "application/json" },
      });
    } catch (e) {
      // Network failure — no retry, report and stop using the provider.
      result.provider_error = `network on ${endpoint}: ${
        e instanceof Error ? e.message.slice(0, 120) : "fetch failed"
      }`;
      return null;
    }
    const text = await res.text();
    await noteUsageHeaders(res);

    let json: AnyRec | null = null;
    try {
      json = JSON.parse(text) as AnyRec;
    } catch {
      json = null;
    }
    const providerError = providerErrorText(json);
    const httpBad = res.status < 200 || res.status >= 300;

    if (httpBad || providerError || json === null) {
      const detail = providerError ?? (httpBad ? `http ${res.status}` : "unparsable body");
      result.provider_error = `${detail} on ${endpoint}`;
      if (isQuotaError(providerError, res.status)) {
        // Honour the provider reset when it gives one, otherwise next UTC day.
        const resetSeconds = Number(res.headers.get("x-ratelimit-requests-reset"));
        const until = Number.isFinite(resetSeconds) && resetSeconds > 0
          ? new Date(Date.now() + Math.min(resetSeconds, 86_400) * 1000)
          : new Date(new Date().setUTCHours(24, 5, 0, 0));
        result.paused_until = until.toISOString();
        await setPause(result.paused_until, result.provider_error);
      }
      return null;
    }
    return json;
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

/** Persist / refresh the provider-side metadata of a mapping. */
async function touchMapping(
  fixtureId: number,
  fx: AfFixture | null,
  nowMs: number,
): Promise<void> {
  const short = fx?.fixture?.status?.short ?? null;
  const kickoff = fx?.fixture?.date ?? null;
  const delay = nextCheckDelayMs(short, kickoff, nowMs);
  await supabaseAdmin
    .from("match_provider_map")
    .update({
      provider_status: short,
      provider_kickoff_at: kickoff,
      last_checked_at: new Date(nowMs).toISOString(),
      next_check_at: new Date(nowMs + delay).toISOString(),
    } as never)
    .eq("provider", AF_PROVIDER)
    .eq("provider_fixture_id", fixtureId);
}

// ------------------------------------------------------------------ discovery

const DISCOVERY_COOLDOWN_UNRESOLVED_MS = 6 * 60 * 60_000;
const DISCOVERY_COOLDOWN_CLEAN_MS = 30 * 60_000;
const DISCOVERY_COOLDOWN_ERROR_MS = 30 * 60_000;

/**
 * Fair, persisted, bounded mapping discovery.
 *
 * One league+season fixture list per call, shared by every match in that
 * group. The attempt is recorded in provider_discovery with a cooldown, and
 * groups are picked by the oldest due attempt — so a league whose names never
 * resolve can never re-fetch itself every tick and starve the other leagues.
 */
async function discoverMappings(
  call: ReturnType<typeof makeCaller>,
  result: AfLiveResult,
  maxCalls: number,
): Promise<void> {
  if (maxCalls <= 0 || result.paused_until) return;
  const now = Date.now();

  // Any non-final match that could still be played or settled. Rows with an
  // unknown/placeholder kickoff are included — a stale kickoff must never stop
  // a match from getting a verified mapping.
  const { data: rows } = await supabaseAdmin
    .from("matches")
    .select(MATCH_COLUMNS)
    .or(`kickoff_at.is.null,kickoff_at.gte.${new Date(now - 21 * 86_400_000).toISOString()}`)
    .or(`status.is.null,status.not.in.(${FINAL_STATUSES.join(",")})`)
    .limit(1000);

  const candidates = (rows ?? []).filter(
    (m) => m.competition_id && m.home_team_id && m.away_team_id,
  ) as MatchRow[];
  if (candidates.length === 0) return;

  const mapped = new Set<string>();
  for (let i = 0; i < candidates.length; i += 200) {
    const { data: existing } = await supabaseAdmin
      .from("match_provider_map")
      .select("match_id")
      .eq("provider", AF_PROVIDER)
      .in("match_id", candidates.slice(i, i + 200).map((m) => m.id));
    for (const e of existing ?? []) mapped.add(e.match_id);
  }
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
      .select("id, name_he, tournament_id, season_calc_method")
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
  const unsupported = new Set<string>();
  for (const m of todo) {
    const comp = compById.get(m.competition_id!);
    const league = comp?.tournament_id ? LEAGUE_BY_TOURNAMENT[String(comp.tournament_id)] : undefined;
    if (!league) {
      if (comp?.name_he) unsupported.add(comp.name_he);
      continue;
    }
    const season = seasonFor(m.kickoff_at ?? new Date(now).toISOString(), comp?.season_calc_method ?? null);
    const key = `${league}:${season}`;
    const g = groups.get(key) ?? { league, season, rows: [] };
    g.rows.push(m);
    groups.set(key, g);
  }
  result.unsupported_competitions = [...unsupported];
  result.discovery_groups = groups.size;
  result.discovery_unresolved = todo.length;
  if (groups.size === 0) return;

  // Fair selection: only groups whose cooldown has expired, oldest first.
  const { data: states } = await supabaseAdmin
    .from("provider_discovery")
    .select("league_id, season, next_attempt_at")
    .eq("provider", AF_PROVIDER);
  const stateByKey = new Map(
    (states ?? []).map((s) => [`${s.league_id}:${s.season}`, s.next_attempt_at as string | null]),
  );

  const due = [...groups.entries()]
    .map(([key, g]) => ({ key, g, next: stateByKey.get(key) ?? null }))
    .filter((e) => e.next === null || Date.parse(e.next) <= now)
    .sort((a, b) => (a.next === null ? 0 : Date.parse(a.next)) - (b.next === null ? 0 : Date.parse(b.next)))
    .slice(0, maxCalls);

  for (const entry of due) {
    const { league, season, rows: groupRows } = entry.g;
    const json = await call(`/fixtures?league=${league}&season=${season}`, "bulk");
    result.mapping_calls += 1;
    if (!json) {
      await supabaseAdmin.from("provider_discovery").upsert(
        {
          provider: AF_PROVIDER,
          league_id: league,
          season,
          last_attempt_at: new Date(now).toISOString(),
          next_attempt_at: new Date(now + DISCOVERY_COOLDOWN_ERROR_MS).toISOString(),
          last_error: (result.provider_error ?? "no response").slice(0, 200),
        } as never,
        { onConflict: "provider,league_id,season" },
      );
      break;
    }
    const fixtures = ((json["response"] as AfFixture[] | undefined) ?? [])
      .map(toCandidate)
      .filter((c): c is MappingCandidate => c !== null);

    let resolved = 0;
    for (const m of groupRows) {
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
        league_id: league,
        season,
        round: hit.fixture.round,
        provider_kickoff_at: hit.fixture.kickoffIso,
        next_check_at: new Date(now).toISOString(),
        evidence: {
          provider_teams: `${hit.fixture.homeName} - ${hit.fixture.awayName}`,
          provider_kickoff: hit.fixture.kickoffIso,
          db_kickoff: m.kickoff_at,
          home_name_score: Number(hit.homeScore.toFixed(3)),
          away_name_score: Number(hit.awayScore.toFixed(3)),
          rule: "unique strong both-name match inside league+season",
        } as never,
      } as never);
      if (!error) {
        result.mappings_created += 1;
        resolved += 1;
      }
    }
    const unresolvedLeft = groupRows.length - resolved;
    await supabaseAdmin.from("provider_discovery").upsert(
      {
        provider: AF_PROVIDER,
        league_id: league,
        season,
        last_attempt_at: new Date(now).toISOString(),
        next_attempt_at: new Date(
          now + (unresolvedLeft > 0 ? DISCOVERY_COOLDOWN_UNRESOLVED_MS : DISCOVERY_COOLDOWN_CLEAN_MS),
        ).toISOString(),
        attempts: 1,
        last_fixture_count: fixtures.length,
        resolved_count: resolved,
        unresolved_count: unresolvedLeft,
        last_error: null,
      } as never,
      { onConflict: "provider,league_id,season" },
    );
  }
}

// ----------------------------------------------------------------- application

async function applyFixtures(
  fixtures: AfFixture[],
  byFixtureId: Map<number, MatchRow>,
  result: AfLiveResult,
): Promise<number> {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  let written = 0;
  for (const fx of fixtures) {
    const id = fx.fixture?.id;
    if (typeof id !== "number") continue;
    const row = byFixtureId.get(id);
    if (!row) continue;

    // Seen with authoritative provider state, whether or not anything changed.
    result.handled_match_ids.push(row.id);
    if (row.external_id) result.handled_external_ids.push(String(row.external_id));
    await touchMapping(id, fx, nowMs);

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
  const result = emptyResult(Boolean(apiKey && apiKey.length > 0));
  if (!apiKey) {
    result.provider_error = "API_FOOTBALL_KEY missing";
    return result;
  }

  result.paused_until = await readPause();
  if (result.paused_until) {
    result.provider_error = `paused until ${result.paused_until}`;
    return result;
  }

  const call = makeCaller(apiKey, result);
  const nowMs = Date.now();

  // 1. ONE aggregated live request for every user and every match. This runs
  //    FIRST so optional background work can never consume the live turn.
  const live = await call("/fixtures?live=all", "live");
  const liveMatchIds = new Set<string>();
  if (live) {
    result.live_ok = true;
    const liveFixtures = (live["response"] as AfFixture[] | undefined) ?? [];
    result.live_fixtures = liveFixtures.length;

    const liveIds = liveFixtures
      .map((f) => f.fixture?.id)
      .filter((v): v is number => typeof v === "number");

    const byFixtureId = new Map<number, MatchRow>();
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
  }

  // 2. Reconciliation. Absence from the live feed is NEVER "finished".
  //    Candidates are mapped, non-final rows that are due by the PROVIDER
  //    clock (or stale-live by ours), oldest check first — this also covers
  //    matches missed between ticks, during an outage, or mapped only after
  //    they had already finished, and it never re-probes future fixtures.
  if (!result.paused_until && !result.provider_error) {
    const dueIso = new Date(nowMs).toISOString();
    const { data: mapRows } = await supabaseAdmin
      .from("match_provider_map")
      .select("match_id, provider_fixture_id, provider_kickoff_at, next_check_at")
      .eq("provider", AF_PROVIDER)
      .or(`next_check_at.is.null,next_check_at.lte.${dueIso}`)
      .order("next_check_at", { ascending: true, nullsFirst: true })
      .limit(300);

    const linkRows = (mapRows ?? []).filter((m) => !liveMatchIds.has(m.match_id));
    const byMatchId = new Map(linkRows.map((m) => [m.match_id, m]));
    const toCheck: Array<{ row: MatchRow; fixtureId: number }> = [];
    if (linkRows.length > 0) {
      const { data: rows } = await supabaseAdmin
        .from("matches")
        .select(MATCH_COLUMNS)
        .in("id", linkRows.map((m) => m.match_id))
        .not("status", "in", `(${FINAL_STATUSES.join(",")})`);
      for (const raw of (rows ?? []) as MatchRow[]) {
        const link = byMatchId.get(raw.id);
        if (!link) continue;
        const fixtureId = Number(link.provider_fixture_id);
        if (!Number.isFinite(fixtureId)) continue;
        const providerKick = link.provider_kickoff_at ? Date.parse(link.provider_kickoff_at) : NaN;
        const staleLive = raw.status === "inprogress";
        const overdueByProvider = Number.isFinite(providerKick)
          ? providerKick < nowMs - 100 * 60_000
          : raw.kickoff_at != null && Date.parse(raw.kickoff_at) < nowMs - 100 * 60_000;
        const unknownTime = !Number.isFinite(providerKick) && raw.kickoff_at == null;
        if (staleLive || overdueByProvider || unknownTime) {
          toCheck.push({ row: raw, fixtureId });
        }
      }
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
  }

  // 3. Mapping discovery LAST, on the 'bulk' budget. Failing here is optional
  //    work: it never marks the live pipeline unhealthy.
  const liveFailed = !result.live_ok;
  if (!liveFailed && !result.paused_until && !result.provider_error) {
    await discoverMappings(call, result, options?.mappingCalls ?? 1);
  }

  return result;
}
