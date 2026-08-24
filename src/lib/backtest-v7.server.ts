// PredictaBall — offline backtest of the v7 prediction engine.
//
// Pure internal database work: ZERO outgoing API calls.
// It never touches the live `predictions` / `prediction_outcomes` tables —
// results go to `backtest_results` + `backtest_predictions` only.
//
// No data leakage: every match is predicted using only information that
// existed before its own kickoff. Internal Elo is rebuilt with a single
// forward chronological pass, so a match is always rated with the Elo state
// that preceded it.

import { createClient } from "@supabase/supabase-js";
import {
  computePrediction,
  type HistoryMatch,
  type ModelConfig,
  type TournamentType,
} from "@/lib/prediction-engine";
import type { Database } from "@/integrations/supabase/types";

const ELO_BASE = 1500;
const ELO_K = 20;
const ELO_HFA = 65;
const ELO_MIN_MATCHES = 3;
const DEFAULT_HOME_ADVANTAGE = 1.1;
const MIN_COMPETITION_SAMPLE = 30;
const MS_PER_DAY = 86_400_000;
const PAGE = 1000;
const INSERT_CHUNK = 500;

export interface BacktestSummary {
  run_id: string;
  label: string | null;
  model_version: string;
  n: number;
  n_excluded: number;
  n_candidates: number;
  rps_avg: number | null;
  brier_avg: number | null;
  winner_accuracy: number | null;
  exact_score_accuracy: number | null;
  over_under_accuracy: number | null;
  goal_bucket_accuracy: number | null;
  naive_baseline_rps: number | null;
  naive_winner_accuracy: number | null;
  date_from: string | null;
  date_to: string | null;
  duration_ms: number;
}

export interface BacktestInput {
  label?: string;
  /** model_config keys (snake_case) overridden in memory only. */
  overrides?: Record<string, number>;
}

interface HistEntry {
  playedAt: number;
  gf: number;
  ga: number;
  tournamentType: TournamentType;
  opponentElo: number | null;
  eloAfter: number;
}

function snakeToCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
}

function normalizeTournamentType(value: string | null): TournamentType {
  return value === "official" || value === "friendly" || value === "youth" ? value : "unknown";
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function buildClient() {
  const supabaseUrl = process.env["SUPABASE_URL"];
  const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      `Missing required secret(s): ${[
        ...(supabaseUrl ? [] : ["SUPABASE_URL"]),
        ...(serviceKey ? [] : ["SUPABASE_SERVICE_ROLE_KEY"]),
      ].join(", ")}`,
    );
  }
  return createClient<Database>(supabaseUrl, serviceKey, {
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (headers.get("Authorization") === `Bearer ${serviceKey}`) headers.delete("Authorization");
        headers.set("apikey", serviceKey);
        return fetch(input, { ...init, headers });
      },
    },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

export async function runBacktestV7(input: BacktestInput = {}): Promise<BacktestSummary> {
  const startedAt = Date.now();
  const supabase = buildClient();

  // (א) model_config → ModelConfig (+ in-memory overrides, never written back)
  const { data: configRows, error: configError } = await supabase
    .from("model_config")
    .select("key, value, value_text");
  if (configError) throw new Error(`model_config read failed: ${configError.message}`);

  const rawParams: Record<string, number> = {};
  let modelVersion: string | null = null;
  for (const row of configRows ?? []) {
    if (row.key === "model_version") {
      modelVersion = row.value_text;
      continue;
    }
    if (row.value === null) continue;
    rawParams[row.key] = Number(row.value);
  }
  if (!modelVersion) throw new Error("model_config is missing key 'model_version'");
  const overrides = input.overrides ?? {};
  const effective: Record<string, number> = { ...rawParams, ...overrides };
  const cfgRecord: Record<string, number> = {};
  for (const [key, value] of Object.entries(effective)) cfgRecord[snakeToCamel(key)] = value;
  const cfg = cfgRecord as unknown as ModelConfig;

  // (ב) teams: id ↔ external_id
  const teamExtById = new Map<string, string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("teams")
      .select("id, external_id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`teams read failed: ${error.message}`);
    for (const t of data ?? []) if (t.external_id) teamExtById.set(t.id, t.external_id);
    if (!data || data.length < PAGE) break;
  }

  // (ג) full history, deduped into unique matches
  interface RawHist {
    team_id: string;
    external_match_id: string;
    played_at: string;
    is_home: boolean;
    goals_for: number;
    goals_against: number;
    opponent_external_id: string | null;
    tournament_type: string;
  }
  const rawHistory: RawHist[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("team_match_history")
      .select(
        "team_id, external_match_id, played_at, is_home, goals_for, goals_against, opponent_external_id, tournament_type",
      )
      .order("played_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`team_match_history read failed: ${error.message}`);
    rawHistory.push(...((data ?? []) as RawHist[]));
    if (!data || data.length < PAGE) break;
  }

  interface UniqueMatch {
    homeExt: string;
    awayExt: string;
    homeGoals: number;
    awayGoals: number;
    playedAt: number;
    type: TournamentType;
  }
  const uniqueByExt = new Map<string, UniqueMatch>();
  for (const row of rawHistory) {
    if (uniqueByExt.has(row.external_match_id)) continue;
    const selfExt = teamExtById.get(row.team_id);
    const oppExt = row.opponent_external_id;
    if (!selfExt || !oppExt) continue;
    uniqueByExt.set(row.external_match_id, {
      homeExt: row.is_home ? selfExt : oppExt,
      awayExt: row.is_home ? oppExt : selfExt,
      homeGoals: row.is_home ? row.goals_for : row.goals_against,
      awayGoals: row.is_home ? row.goals_against : row.goals_for,
      playedAt: new Date(row.played_at).getTime(),
      type: normalizeTournamentType(row.tournament_type),
    });
  }
  const timeline = Array.from(uniqueByExt.values()).sort((a, b) => a.playedAt - b.playedAt);

  // (ד) single forward pass: point-in-time Elo + per-team point-in-time history
  const elo = new Map<string, number>();
  const played = new Map<string, number>();
  const historyByExt = new Map<string, HistEntry[]>();

  const ratingOf = (ext: string) => elo.get(ext) ?? ELO_BASE;
  const knownRating = (ext: string) =>
    (played.get(ext) ?? 0) >= ELO_MIN_MATCHES ? ratingOf(ext) : null;

  for (const m of timeline) {
    const rh = ratingOf(m.homeExt);
    const ra = ratingOf(m.awayExt);
    const oppEloForHome = knownRating(m.awayExt);
    const oppEloForAway = knownRating(m.homeExt);

    const eh = 1 / (1 + 10 ** ((ra - rh - ELO_HFA) / 400));
    const sh = m.homeGoals > m.awayGoals ? 1 : m.homeGoals === m.awayGoals ? 0.5 : 0;
    const gd = Math.abs(m.homeGoals - m.awayGoals);
    const km = gd <= 1 ? 1 : gd === 2 ? 1.5 : (11 + gd) / 8;
    const delta = ELO_K * km * (sh - eh);
    const newHome = rh + delta;
    const newAway = ra - delta;
    elo.set(m.homeExt, newHome);
    elo.set(m.awayExt, newAway);
    played.set(m.homeExt, (played.get(m.homeExt) ?? 0) + 1);
    played.set(m.awayExt, (played.get(m.awayExt) ?? 0) + 1);

    const pushEntry = (ext: string, entry: HistEntry) => {
      const list = historyByExt.get(ext);
      if (list) list.push(entry);
      else historyByExt.set(ext, [entry]);
    };
    pushEntry(m.homeExt, {
      playedAt: m.playedAt,
      gf: m.homeGoals,
      ga: m.awayGoals,
      tournamentType: m.type,
      opponentElo: oppEloForHome,
      eloAfter: newHome,
    });
    pushEntry(m.awayExt, {
      playedAt: m.playedAt,
      gf: m.awayGoals,
      ga: m.homeGoals,
      tournamentType: m.type,
      opponentElo: oppEloForAway,
      eloAfter: newAway,
    });
  }

  // (ה) evaluation set: finished matches with a real score
  interface EvalMatch {
    id: string;
    competition_id: string | null;
    home_team_id: string | null;
    away_team_id: string | null;
    kickoff_at: string | null;
    home_score: number | null;
    away_score: number | null;
  }
  const finished: EvalMatch[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("matches")
      .select("id, competition_id, home_team_id, away_team_id, kickoff_at, home_score, away_score")
      .eq("status", "finished")
      .not("home_score", "is", null)
      .not("away_score", "is", null)
      .order("kickoff_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`matches read failed: ${error.message}`);
    finished.push(...((data ?? []) as EvalMatch[]));
    if (!data || data.length < PAGE) break;
  }
  const candidates = finished.filter(
    (m) => m.home_team_id && m.away_team_id && m.kickoff_at && m.home_score !== null && m.away_score !== null,
  );

  // competition home advantage (per competition, as the live engine does)
  const { data: competitions, error: competitionsError } = await supabase
    .from("competitions")
    .select("id, home_advantage");
  if (competitionsError) throw new Error(`competitions read failed: ${competitionsError.message}`);
  const homeAdvantageById = new Map(
    (competitions ?? []).map((c) => [
      c.id,
      c.home_advantage === null ? DEFAULT_HOME_ADVANTAGE : Number(c.home_advantage),
    ]),
  );
  // competition goal baseline: cumulative up to the evaluated match only
  const compGoals = new Map<string, { games: number; goals: number }>();

  const rows: Array<Database["public"]["Tables"]["backtest_predictions"]["Insert"]> = [];
  let excluded = 0;
  let sumRps = 0;
  let sumBrier = 0;
  let hitWinner = 0;
  let hitExact = 0;
  let hitOu = 0;
  let hitBucket = 0;
  let actualHomeWins = 0;
  let actualDraws = 0;
  let actualAwayWins = 0;

  for (const match of candidates) {
    const homeExt = teamExtById.get(match.home_team_id as string);
    const awayExt = teamExtById.get(match.away_team_id as string);
    const kickoff = new Date(match.kickoff_at as string).getTime();
    const actualHome = match.home_score as number;
    const actualAway = match.away_score as number;

    const priorOf = (ext: string | undefined): HistEntry[] => {
      if (!ext) return [];
      const all = historyByExt.get(ext) ?? [];
      const out: HistEntry[] = [];
      for (let i = all.length - 1; i >= 0; i--) {
        const e = all[i] as HistEntry;
        if (e.playedAt >= kickoff) continue;
        if (e.tournamentType === "youth") continue;
        out.push(e);
      }
      return out; // newest first
    };

    const homePrior = priorOf(homeExt);
    const awayPrior = priorOf(awayExt);

    const toHistory = (entries: HistEntry[]): HistoryMatch[] =>
      entries.map((e) => ({
        goalsFor: e.gf,
        goalsAgainst: e.ga,
        tournamentType: e.tournamentType,
        opponentElo: e.opponentElo,
      }));

    const eloBefore = (entries: HistEntry[]): number | null =>
      entries.length >= ELO_MIN_MATCHES ? (entries[0] as HistEntry).eloAfter : null;

    const restDays = (entries: HistEntry[]): number | null =>
      entries.length === 0 ? null : Math.floor((kickoff - (entries[0] as HistEntry).playedAt) / MS_PER_DAY);

    const compKey = match.competition_id ?? "none";
    const compStat = compGoals.get(compKey);
    const avgTotalGoals =
      compStat && compStat.games >= MIN_COMPETITION_SAMPLE ? compStat.goals / compStat.games : null;
    const homeAdvantage = match.competition_id
      ? (homeAdvantageById.get(match.competition_id) ?? DEFAULT_HOME_ADVANTAGE)
      : DEFAULT_HOME_ADVANTAGE;

    // register this match into the cumulative baseline only AFTER using it
    compGoals.set(compKey, {
      games: (compStat?.games ?? 0) + 1,
      goals: (compStat?.goals ?? 0) + actualHome + actualAway,
    });

    const eloHome = eloBefore(homePrior);
    const eloAway = eloBefore(awayPrior);

    const result = computePrediction(
      toHistory(homePrior),
      toHistory(awayPrior),
      eloHome,
      eloAway,
      { avgTotalGoals, homeAdvantage },
      restDays(homePrior),
      restDays(awayPrior),
      cfg,
    );

    if (result === null) {
      excluded++;
      continue;
    }

    const oh = actualHome > actualAway ? 1 : 0;
    const od = actualHome === actualAway ? 1 : 0;
    const oa = actualHome < actualAway ? 1 : 0;
    const rps =
      0.5 *
      ((result.probHome - oh) ** 2 + (result.probHome + result.probDraw - (oh + od)) ** 2);
    const brier =
      (result.probHome - oh) ** 2 + (result.probDraw - od) ** 2 + (result.probAway - oa) ** 2;

    const predSign =
      result.predictedHomeScore > result.predictedAwayScore
        ? 1
        : result.predictedHomeScore === result.predictedAwayScore
          ? 0
          : -1;
    const actualSign = oh === 1 ? 1 : od === 1 ? 0 : -1;
    const actualTotal = actualHome + actualAway;
    const actualBucket = actualTotal <= 1 ? "0-1" : actualTotal <= 3 ? "2-3" : "4+";

    const winner = predSign === actualSign;
    const exact = result.predictedHomeScore === actualHome && result.predictedAwayScore === actualAway;
    const ou = result.probOver25 >= 0.5 === actualTotal >= 3;
    const bucket = result.predictedGoalBucket === actualBucket;

    sumRps += rps;
    sumBrier += brier;
    if (winner) hitWinner++;
    if (exact) hitExact++;
    if (ou) hitOu++;
    if (bucket) hitBucket++;
    if (oh) actualHomeWins++;
    else if (od) actualDraws++;
    else actualAwayWins++;

    rows.push({
      run_id: "",
      match_id: match.id,
      competition_id: match.competition_id,
      kickoff_at: match.kickoff_at,
      pred_home: result.predictedHomeScore,
      pred_away: result.predictedAwayScore,
      actual_home: actualHome,
      actual_away: actualAway,
      prob_home: result.probHome,
      prob_draw: result.probDraw,
      prob_away: result.probAway,
      prob_over_2_5: result.probOver25,
      lambda_home: result.lambdaHome,
      lambda_away: result.lambdaAway,
      elo_home: eloHome,
      elo_away: eloAway,
      confidence: result.confidence,
      confidence_band: result.confidenceBand,
      hit_winner: winner,
      hit_exact: exact,
      hit_ou25: ou,
      hit_goal_bucket: bucket,
      rps: round(rps, 5),
      brier: round(brier, 5),
    });
  }

  const n = rows.length;
  const pctOf = (hits: number) => (n === 0 ? null : round((hits / n) * 100, 2));

  // naive baseline: constant 1X2 distribution taken from the sample itself
  let naiveRps: number | null = null;
  if (n > 0) {
    const ph = actualHomeWins / n;
    const pd = actualDraws / n;
    let acc = 0;
    for (const row of rows) {
      const oh = row.actual_home > row.actual_away ? 1 : 0;
      const od = row.actual_home === row.actual_away ? 1 : 0;
      acc += 0.5 * ((ph - oh) ** 2 + (ph + pd - (oh + od)) ** 2);
    }
    naiveRps = round(acc / n, 5);
  }

  const summaryInsert = {
    label: input.label ?? null,
    model_version: modelVersion,
    params_effective: effective,
    config_overrides: overrides,
    n,
    n_excluded: excluded,
    n_candidates: candidates.length,
    rps_avg: n === 0 ? null : round(sumRps / n, 5),
    brier_avg: n === 0 ? null : round(sumBrier / n, 5),
    winner_accuracy: pctOf(hitWinner),
    exact_score_accuracy: pctOf(hitExact),
    over_under_accuracy: pctOf(hitOu),
    goal_bucket_accuracy: pctOf(hitBucket),
    naive_baseline_rps: naiveRps,
    naive_winner_accuracy: pctOf(actualHomeWins),
    date_from: candidates[0]?.kickoff_at ?? null,
    date_to: candidates[candidates.length - 1]?.kickoff_at ?? null,
    duration_ms: 0,
  };

  const { data: runRow, error: runError } = await supabase
    .from("backtest_results")
    .insert(summaryInsert)
    .select("id")
    .single();
  if (runError) throw new Error(`backtest_results insert failed: ${runError.message}`);
  const runId = runRow.id;

  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK).map((r) => ({ ...r, run_id: runId }));
    const { error } = await supabase.from("backtest_predictions").insert(chunk);
    if (error) throw new Error(`backtest_predictions insert failed: ${error.message}`);
  }

  const durationMs = Date.now() - startedAt;
  await supabase.from("backtest_results").update({ duration_ms: durationMs }).eq("id", runId);
  await supabase.from("job_runs").insert({
    job_name: "backtest_v7",
    started_at: new Date(startedAt).toISOString(),
    finished_at: new Date().toISOString(),
    status: "success",
    result_metric: n,
    result_detail: { ...summaryInsert, params_effective: undefined, run_id: runId },
  });

  return {
    run_id: runId,
    label: summaryInsert.label,
    model_version: modelVersion,
    n,
    n_excluded: excluded,
    n_candidates: candidates.length,
    rps_avg: summaryInsert.rps_avg,
    brier_avg: summaryInsert.brier_avg,
    winner_accuracy: summaryInsert.winner_accuracy,
    exact_score_accuracy: summaryInsert.exact_score_accuracy,
    over_under_accuracy: summaryInsert.over_under_accuracy,
    goal_bucket_accuracy: summaryInsert.goal_bucket_accuracy,
    naive_baseline_rps: summaryInsert.naive_baseline_rps,
    naive_winner_accuracy: summaryInsert.naive_winner_accuracy,
    date_from: summaryInsert.date_from,
    date_to: summaryInsert.date_to,
    duration_ms: durationMs,
  };
}
