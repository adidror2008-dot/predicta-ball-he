/**
 * PredictaBall — prediction engine. Pure maths.
 *
 * No DB, no fetch, no env, no clock, no randomness. Inputs in, prediction out.
 * Every tunable number comes from the EngineConfig argument (the model_config
 * table). A missing key throws immediately — the engine never substitutes a
 * silent default, because a silent default is an invented number.
 */

import { factorsToHebrew } from './reasons';
import type {
  CompetitionInput,
  ConfidenceBand,
  EngineConfig,
  EngineInput,
  EngineResult,
  Factor,
  FactorSide,
  GoalBucket,
  HistoryMatch,
  Prediction,
  TeamInput,
} from './types';

/** Structural constants only — not model parameters. */
const PROB_DP = 4;
const GOALS_DP = 2;
const FALLBACK_ELO = 1500;
const FORM_WINDOW = 3;
const POINTS_WIN = 3;
const POINTS_DRAW = 1;
const POINTS_LOSS = 0;
const ELO_SIGNAL_MIN_GAP = 15;
const ELO_FACTOR_SCALE = 400;
const FORM_FACTOR_SCALE = 9;
const LAMBDA_FACTOR_SCALE = 3;
const REST_FACTOR_SCALE = 7;
const REST_FACTOR_MIN_DIFF = 2;
const DATA_QUALITY_TARGET = 6;
const DATA_QUALITY_ESTIMATED_PENALTY = 0.3;
const ESTIMATED_CAVEAT_SHARE = 0.5;
const LOW_SAMPLE_MATCHES = 3;
const MAX_RANKED_FACTORS = 3;

function cfg(config: EngineConfig, key: string): number {
  const value = config[key];
  if (value === undefined || value === null || Number.isNaN(value)) {
    throw new Error(`Missing model_config key: ${key}`);
  }
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundTo(value: number, dp: number): number {
  const f = Math.pow(10, dp);
  return Math.round(value * f) / f;
}

/**
 * Rounds a probability group to 4 dp and pushes the residual into the largest
 * member, so the group sums to exactly 1.0000 and the DB CHECK constraints pass.
 *
 * Tie rule: when two members tie for largest (a perfectly symmetric match, where
 * probHome === probAway), the residual goes to the smallest member instead.
 * Otherwise the rounding itself would invent a home/away edge that the maths
 * never produced.
 */
function normalizeGroup(values: number[]): number[] {
  const rounded = values.map((v) => roundTo(v, PROB_DP));
  const sum = rounded.reduce((a, b) => a + b, 0);
  const residual = roundTo(1 - sum, PROB_DP);
  if (residual !== 0) {
    let maxIndex = 0;
    let minIndex = 0;
    let maxTied = false;
    for (let i = 1; i < rounded.length; i++) {
      const v = rounded[i] as number;
      if (v > (rounded[maxIndex] as number)) {
        maxIndex = i;
        maxTied = false;
      } else if (v === (rounded[maxIndex] as number)) {
        maxTied = true;
      }
      if (v < (rounded[minIndex] as number)) minIndex = i;
    }
    const target = maxTied ? minIndex : maxIndex;
    rounded[target] = roundTo((rounded[target] as number) + residual, PROB_DP);
  }
  return rounded;
}


function poisson(k: number, lambda: number): number {
  let fact = 1;
  for (let i = 2; i <= k; i++) fact *= i;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / fact;
}

interface WeightedMatch {
  match: HistoryMatch;
  weight: number;
  estimated: boolean;
}

interface TeamStats {
  used: WeightedMatch[];
  nEff: number;
  gfAdj: number;
  gaAdj: number;
  formPoints: number;
  estimatedCount: number;
}

function referenceElo(competition: CompetitionInput, home: TeamInput, away: TeamInput): number {
  if (competition.refElo !== null) return competition.refElo;
  const elos = [
    home.eloInternal,
    home.eloClub,
    away.eloInternal,
    away.eloClub,
  ].filter((e): e is number => e !== null);
  if (elos.length === 0) return FALLBACK_ELO;
  return elos.reduce((a, b) => a + b, 0) / elos.length;
}

/** Steps 1 and 3: take the history, weight it, reduce it to weighted rates. */
function weighHistory(team: TeamInput, config: EngineConfig, refElo: number): WeightedMatch[] {
  const maxMatches = cfg(config, 'history_max_matches');
  const wOfficial = cfg(config, 'weight_official');
  const wFriendly = cfg(config, 'weight_friendly');
  const wUnknownType = cfg(config, 'weight_unknown_type');
  const wUnknownOpp = cfg(config, 'weight_unknown_opponent');
  const oppScale = cfg(config, 'opp_elo_scale');
  const oppFloor = cfg(config, 'opp_weight_floor');
  const decay = cfg(config, 'recency_decay');

  const out: WeightedMatch[] = [];
  const slice = team.history.slice(0, maxMatches);

  for (let i = 0; i < slice.length; i++) {
    const m = slice[i] as HistoryMatch;
    if (m.tournamentType === 'youth') continue;

    const wType =
      m.tournamentType === 'official'
        ? wOfficial
        : m.tournamentType === 'friendly'
          ? wFriendly
          : wUnknownType;

    const estimated = m.opponentElo === null;
    const wOpp = estimated
      ? wUnknownOpp
      : clamp(1 - (refElo - (m.opponentElo as number)) / oppScale, oppFloor, 1);

    const wTime = Math.pow(decay, i);

    out.push({ match: m, weight: wType * wOpp * wTime, estimated });
  }

  return out;
}

function teamStats(used: WeightedMatch[], leagueAvg: number, config: EngineConfig): TeamStats {
  const shrinkK = cfg(config, 'shrinkage_k');

  let nEff = 0;
  let sumFor = 0;
  let sumAgainst = 0;
  let estimatedCount = 0;

  for (const wm of used) {
    nEff += wm.weight;
    sumFor += wm.weight * wm.match.goalsFor;
    sumAgainst += wm.weight * wm.match.goalsAgainst;
    if (wm.estimated) estimatedCount++;
  }

  const gf = nEff > 0 ? sumFor / nEff : leagueAvg;
  const ga = nEff > 0 ? sumAgainst / nEff : leagueAvg;
  const alpha = nEff / (nEff + shrinkK);

  let formPoints = 0;
  for (const wm of used.slice(0, FORM_WINDOW)) {
    formPoints +=
      wm.match.goalsFor > wm.match.goalsAgainst
        ? POINTS_WIN
        : wm.match.goalsFor === wm.match.goalsAgainst
          ? POINTS_DRAW
          : POINTS_LOSS;
  }

  return {
    used,
    nEff,
    gfAdj: alpha * gf + (1 - alpha) * leagueAvg,
    gaAdj: alpha * ga + (1 - alpha) * leagueAvg,
    formPoints,
    estimatedCount,
  };
}

function restFactor(restDays: number | null, config: EngineConfig): number {
  if (restDays === null) return 1;
  const threshold = cfg(config, 'rest_days_threshold');
  const perDay = cfg(config, 'rest_penalty_per_day');
  const floor = cfg(config, 'rest_penalty_floor');
  return clamp(1 - perDay * Math.max(0, threshold - restDays), floor, 1);
}

export function predict(input: EngineInput, config: EngineConfig): EngineResult {
  const { home, away, competition } = input;

  const minMatches = cfg(config, 'history_min_matches');
  const globalHome = cfg(config, 'global_avg_goals_home');
  const globalAway = cfg(config, 'global_avg_goals_away');

  const refElo = referenceElo(competition, home, away);

  // Step 1
  const homeUsed = weighHistory(home, config, refElo);
  const awayUsed = weighHistory(away, config, refElo);

  // Step 2 — absolute gate
  if (homeUsed.length < minMatches || awayUsed.length < minMatches) {
    return {
      ok: false,
      reason: 'insufficient_history',
      homeMatches: homeUsed.length,
      awayMatches: awayUsed.length,
      required: minMatches,
    };
  }

  // Step 4
  let leagueAvg =
    ((competition.avgGoalsHome ?? globalHome) + (competition.avgGoalsAway ?? globalAway)) / 2;
  if (!(leagueAvg > 0)) leagueAvg = (globalHome + globalAway) / 2;

  const homeStats = teamStats(homeUsed, leagueAvg, config);
  const awayStats = teamStats(awayUsed, leagueAvg, config);

  // Step 5
  const eloScale = cfg(config, 'elo_goal_scale');
  const multMin = cfg(config, 'elo_mult_min');
  const multMax = cfg(config, 'elo_mult_max');
  const eloHome = home.eloInternal ?? home.eloClub ?? refElo;
  const eloAway = away.eloInternal ?? away.eloClub ?? refElo;
  const d = eloHome - eloAway;
  const multHome = clamp(Math.exp(d / eloScale), multMin, multMax);
  const multAway = clamp(Math.exp(-d / eloScale), multMin, multMax);

  // Step 6
  const restHome = restFactor(home.restDays, config);
  const restAway = restFactor(away.restDays, config);

  // Step 7
  const lambdaMin = cfg(config, 'lambda_min');
  const lambdaMax = cfg(config, 'lambda_max');
  const lambdaHome = clamp(
    ((homeStats.gfAdj * awayStats.gaAdj) / leagueAvg) *
      competition.homeAdvantage *
      multHome *
      restHome,
    lambdaMin,
    lambdaMax,
  );
  const lambdaAway = clamp(
    ((awayStats.gfAdj * homeStats.gaAdj) / leagueAvg) * multAway * restAway,
    lambdaMin,
    lambdaMax,
  );

  // Step 8 — Poisson grid, normalized so the truncated tail folds back in
  const n = cfg(config, 'max_goals_grid');
  const size = n + 1;
  const matrix: number[][] = [];
  let total = 0;
  for (let i = 0; i < size; i++) {
    const row: number[] = [];
    for (let j = 0; j < size; j++) {
      const p = poisson(i, lambdaHome) * poisson(j, lambdaAway);
      row.push(p);
      total += p;
    }
    matrix.push(row);
  }
  for (let i = 0; i < size; i++) {
    const row = matrix[i] as number[];
    for (let j = 0; j < size; j++) row[j] = (row[j] as number) / total;
  }

  // Step 9 — everything is read off the grid
  let bestI = 0;
  let bestJ = 0;
  let bestP = -1;
  let pHome = 0;
  let pDraw = 0;
  let pAway = 0;
  let pOver = 0;
  let pBtts = 0;
  let p01 = 0;
  let p23 = 0;
  let p4 = 0;

  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const p = (matrix[i] as number[])[j] as number;
      const totalGoals = i + j;

      if (i > j) pHome += p;
      else if (i === j) pDraw += p;
      else pAway += p;

      if (totalGoals >= 3) pOver += p;
      if (i >= 1 && j >= 1) pBtts += p;
      if (totalGoals <= 1) p01 += p;
      else if (totalGoals <= 3) p23 += p;
      else p4 += p;

      const better =
        p > bestP ||
        (p === bestP &&
          (totalGoals < bestI + bestJ || (totalGoals === bestI + bestJ && i > bestI)));
      if (better) {
        bestP = p;
        bestI = i;
        bestJ = j;
      }
    }
  }

  const [probHome, probDraw, probAway] = normalizeGroup([pHome, pDraw, pAway]) as [
    number,
    number,
    number,
  ];
  const [probOver25, probUnder25] = normalizeGroup([pOver, 1 - pOver]) as [number, number];
  const [probGoals01, probGoals23, probGoals4Plus] = normalizeGroup([p01, p23, p4]) as [
    number,
    number,
    number,
  ];
  const probBtts = roundTo(pBtts, PROB_DP);

  const buckets: Array<[GoalBucket, number]> = [
    ['0-1', probGoals01],
    ['2-3', probGoals23],
    ['4+', probGoals4Plus],
  ];
  let predictedGoalBucket: GoalBucket = '2-3';
  let bucketBest = -1;
  for (const [key, value] of buckets) {
    if (value > bucketBest) {
      bucketBest = value;
      predictedGoalBucket = key;
    }
  }

  // Step 10 — confidence
  const usedTotal = homeUsed.length + awayUsed.length;
  const estimatedShare =
    usedTotal > 0 ? (homeStats.estimatedCount + awayStats.estimatedCount) / usedTotal : 0;

  const topProb = Math.max(probHome, probDraw, probAway);
  const decisive = clamp((topProb - 1 / 3) / (2 / 3), 0, 1);
  const dataQ =
    Math.min(1, Math.min(homeStats.nEff, awayStats.nEff) / DATA_QUALITY_TARGET) *
    (1 - DATA_QUALITY_ESTIMATED_PENALTY * estimatedShare);

  const predictedSide: FactorSide =
    probHome > probAway && probHome > probDraw
      ? 'home'
      : probAway > probHome && probAway > probDraw
        ? 'away'
        : 'none';

  const signals: FactorSide[] = [];
  signals.push(Math.abs(d) < ELO_SIGNAL_MIN_GAP ? 'none' : d > 0 ? 'home' : 'away');
  const formDiff = homeStats.formPoints - awayStats.formPoints;
  signals.push(Math.abs(formDiff) < 1 ? 'none' : formDiff > 0 ? 'home' : 'away');
  if (home.eloClub !== null && away.eloClub !== null) {
    const clubGap = home.eloClub - away.eloClub;
    signals.push(Math.abs(clubGap) < ELO_SIGNAL_MIN_GAP ? 'none' : clubGap > 0 ? 'home' : 'away');
  }

  const agreement =
    signals.length === 0
      ? 1 / 2
      : predictedSide === 'none'
        ? signals.filter((s) => s === 'none').length / signals.length
        : signals.filter((s) => s === predictedSide).length / signals.length;

  const confidence = clamp(
    Math.round(
      100 *
        (cfg(config, 'conf_w_decisive') * decisive +
          cfg(config, 'conf_w_data') * dataQ +
          cfg(config, 'conf_w_agreement') * agreement),
    ),
    0,
    100,
  );
  const bandLow = cfg(config, 'conf_band_low_max');
  const bandMid = cfg(config, 'conf_band_mid_max');
  const confidenceBand: ConfidenceBand =
    confidence <= bandLow ? 'low' : confidence <= bandMid ? 'mid' : 'high';

  // Step 11 — factors
  const roundedLambdaHome = roundTo(lambdaHome, GOALS_DP);
  const roundedLambdaAway = roundTo(lambdaAway, GOALS_DP);
  const ranked: Factor[] = [];

  if (Math.abs(d) >= ELO_SIGNAL_MIN_GAP) {
    ranked.push({
      key: 'elo_gap',
      side: d > 0 ? 'home' : 'away',
      values: {
        strongerTeam: d > 0 ? home.nameHe : away.nameHe,
        gap: Math.round(Math.abs(d)),
      },
      impact: Math.abs(d) / ELO_FACTOR_SCALE,
    });
  }

  ranked.push({
    key: 'form',
    side: formDiff > 0 ? 'home' : formDiff < 0 ? 'away' : 'none',
    values: {
      teamA: formDiff >= 0 ? home.nameHe : away.nameHe,
      pointsA: formDiff >= 0 ? homeStats.formPoints : awayStats.formPoints,
      teamB: formDiff >= 0 ? away.nameHe : home.nameHe,
      pointsB: formDiff >= 0 ? awayStats.formPoints : homeStats.formPoints,
    },
    impact: Math.abs(formDiff) / FORM_FACTOR_SCALE,
  });

  ranked.push({
    key: 'attack_defence',
    side:
      roundedLambdaHome > roundedLambdaAway
        ? 'home'
        : roundedLambdaHome < roundedLambdaAway
          ? 'away'
          : 'none',
    values: { lambdaHome: roundedLambdaHome, lambdaAway: roundedLambdaAway },
    impact: Math.abs(lambdaHome - lambdaAway) / LAMBDA_FACTOR_SCALE,
  });

  ranked.push({
    key: 'home_advantage',
    side: 'home',
    values: {
      competition: competition.nameHe,
      factor: roundTo(competition.homeAdvantage, GOALS_DP),
    },
    impact: (competition.homeAdvantage - 1) * 2,
  });

  if (home.restDays !== null && away.restDays !== null) {
    const restDiff = Math.abs(home.restDays - away.restDays);
    if (restDiff >= REST_FACTOR_MIN_DIFF) {
      const homeIsTired = home.restDays < away.restDays;
      ranked.push({
        key: 'rest',
        side: homeIsTired ? 'away' : 'home',
        values: {
          team: homeIsTired ? home.nameHe : away.nameHe,
          restLow: Math.min(home.restDays, away.restDays),
          restHigh: Math.max(home.restDays, away.restDays),
        },
        impact: restDiff / REST_FACTOR_SCALE,
      });
    }
  }

  ranked.sort((a, b) => b.impact - a.impact);
  const factors: Factor[] = ranked.slice(0, MAX_RANKED_FACTORS);

  if (estimatedShare > ESTIMATED_CAVEAT_SHARE) {
    factors.push({
      key: 'estimated_history',
      side: 'none',
      values: { share: roundTo(estimatedShare, GOALS_DP) },
      impact: 0,
    });
  }
  const minMatchesUsed = Math.min(homeUsed.length, awayUsed.length);
  if (minMatchesUsed <= LOW_SAMPLE_MATCHES) {
    factors.push({
      key: 'low_sample',
      side: 'none',
      values: { matches: minMatchesUsed },
      impact: 0,
    });
  }

  const prediction: Prediction = {
    lambdaHome: roundedLambdaHome,
    lambdaAway: roundedLambdaAway,
    predictedHomeScore: bestI,
    predictedAwayScore: bestJ,
    probHome,
    probDraw,
    probAway,
    expectedTotalGoals: roundTo(lambdaHome + lambdaAway, GOALS_DP),
    probOver25,
    probUnder25,
    probBtts,
    probGoals01,
    probGoals23,
    probGoals4Plus,
    predictedGoalBucket,
    confidence,
    confidenceBand,
    factors,
    reasonLinesHe: factorsToHebrew(factors),
    nEffHome: roundTo(homeStats.nEff, PROB_DP),
    nEffAway: roundTo(awayStats.nEff, PROB_DP),
    historyMatchesHome: homeUsed.length,
    historyMatchesAway: awayUsed.length,
    estimatedShare: roundTo(estimatedShare, PROB_DP),
    matrix,
  };

  return { ok: true, prediction };
}
