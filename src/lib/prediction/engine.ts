/**
 * PredictaBall — prediction engine v7
 *
 * A pure function. No fetch, no DB, no clock, no randomness.
 * Same input always produces exactly the same output, which is what makes it testable
 * and what makes the accuracy numbers in Settings meaningful.
 *
 * Pipeline:
 *   history -> per-match weights (type x opponent strength x recency)
 *           -> weighted goal rates -> shrinkage toward league average
 *           -> attack/defence strengths -> lambdas (+ home advantage, Elo, rest)
 *           -> 9x9 Negative Binomial matrix
 *           -> EVERY output derived from that one matrix
 */

import { CONFIG, ENGINE_VERSION } from './config';
import {
  clamp,
  daysBetween,
  effectiveSampleSize,
  negBinomialPmf,
  round,
  weightedMean,
} from './math';
import type {
  CompetitionInput,
  ConfidenceBand,
  GoalBucket,
  HistoricalMatch,
  PredictionFactor,
  PredictionInput,
  PredictionResult,
  TeamDiagnostics,
  TeamInput,
} from './types';

interface WeightedHistory {
  matches: HistoricalMatch[];
  weights: number[];
  /** Goals normalised to what they would have been against an average opponent. */
  adjustedFor: number[];
  adjustedAgainst: number[];
  eligibleCount: number;
  effectiveSample: number;
}

/**
 * Builds, for every historical match, BOTH:
 *   (a) opponent-normalised goals — the part that actually discounts a 4-0 over a
 *       bottom club versus a 4-0 over a title contender, and
 *   (b) an informativeness weight.
 *
 * Keeping these separate matters. A weight alone cannot discount a weak opponent:
 * if every opponent is weak, a common factor cancels out of the weighted average
 * and the discount silently does nothing. The normalisation is what bites.
 *
 * Weight layers:
 *   type       — how serious the match was (friendly counts a quarter)
 *   mismatch   — a lopsided fixture in EITHER direction tells us less
 *   unknown    — opponent level genuinely unknown: reduced trust, no normalisation
 *   recency    — newest matches dominate
 */
function buildWeights(team: TeamInput, competition: CompetitionInput): WeightedHistory {
  const matches = team.history.slice(0, CONFIG.MAX_HISTORY);
  const weights: number[] = [];
  const adjustedFor: number[] = [];
  const adjustedAgainst: number[] = [];
  let eligibleCount = 0;

  matches.forEach((match, index) => {
    const typeWeight = CONFIG.TYPE_WEIGHTS[match.matchType] ?? CONFIG.TYPE_WEIGHTS.other;

    let opponentWeight: number;
    let normFactor = 1;

    if (match.opponentElo === null) {
      // We do not know the level, so we do not pretend to correct for it.
      opponentWeight = CONFIG.UNKNOWN_OPPONENT_WEIGHT;
    } else {
      const gap = competition.referenceElo - match.opponentElo; // >0 means weak opponent
      normFactor = clamp(
        Math.exp((CONFIG.OPPONENT_ADJUST_STRENGTH * gap) / 400),
        CONFIG.OPPONENT_ADJUST_MIN,
        CONFIG.OPPONENT_ADJUST_MAX,
      );
      opponentWeight = clamp(
        1 - Math.abs(gap) / CONFIG.OPPONENT_ELO_SCALE,
        CONFIG.OPPONENT_WEIGHT_FLOOR,
        1,
      );
    }

    // Weak opponent -> concedes more, so goals scored are worth less.
    adjustedFor.push(match.goalsFor / normFactor);
    // Weak opponent -> scores less, so a clean sheet against them proves less.
    adjustedAgainst.push(match.goalsAgainst * normFactor);

    const recencyWeight = Math.pow(0.5, index / CONFIG.RECENCY_HALFLIFE_MATCHES);
    weights.push(typeWeight * opponentWeight * recencyWeight);

    const countsTowardFloor =
      match.matchType !== 'friendly' || CONFIG.FRIENDLIES_COUNT_TOWARD_MINIMUM;
    if (countsTowardFloor) eligibleCount += 1;
  });

  return {
    matches,
    weights,
    adjustedFor,
    adjustedAgainst,
    eligibleCount,
    effectiveSample: effectiveSampleSize(weights),
  };
}

/** Weighted, then shrunk toward the league average. Returns attack/defence strengths. */
function computeStrengths(
  history: WeightedHistory,
  leagueGoalsPerTeam: number,
): { attack: number; defence: number; rawFor: number; rawAgainst: number } {
  const rawFor = weightedMean(history.adjustedFor, history.weights);
  const rawAgainst = weightedMean(history.adjustedAgainst, history.weights);

  const n = history.effectiveSample;
  const k = CONFIG.SHRINKAGE_PSEUDO_MATCHES;

  const shrunkFor = (n * rawFor + k * leagueGoalsPerTeam) / (n + k);
  const shrunkAgainst = (n * rawAgainst + k * leagueGoalsPerTeam) / (n + k);

  return {
    attack: shrunkFor / leagueGoalsPerTeam,
    defence: shrunkAgainst / leagueGoalsPerTeam,
    rawFor,
    rawAgainst,
  };
}

/** Weighted points (3/1/0) from the most recent 3 eligible matches. */
function computeFormPoints(history: WeightedHistory): number {
  let points = 0;
  let counted = 0;
  for (const match of history.matches) {
    if (match.matchType === 'friendly') continue;
    if (match.goalsFor > match.goalsAgainst) points += 3;
    else if (match.goalsFor === match.goalsAgainst) points += 1;
    counted += 1;
    if (counted === 3) break;
  }
  return points;
}

function restMultiplier(restDays: number | null): number {
  if (restDays === null) return 1;
  const normalised = clamp((restDays - CONFIG.REST_NEUTRAL_DAYS) / 4, -1, 1);
  return 1 + CONFIG.REST_COEFFICIENT * normalised;
}

/** Builds the 9x9 joint matrix and normalises it to sum to exactly 1. */
function buildMatrix(lambdaHome: number, lambdaAway: number): number[][] {
  const size = CONFIG.MAX_GOALS + 1;
  const r = CONFIG.NB_DISPERSION;

  const homePmf: number[] = [];
  const awayPmf: number[] = [];
  for (let k = 0; k < size; k++) {
    homePmf.push(negBinomialPmf(k, lambdaHome, r));
    awayPmf.push(negBinomialPmf(k, lambdaAway, r));
  }

  const matrix: number[][] = [];
  let total = 0;
  for (let i = 0; i < size; i++) {
    const row: number[] = [];
    for (let j = 0; j < size; j++) {
      const p = homePmf[i] * awayPmf[j];
      row.push(p);
      total += p;
    }
    matrix.push(row);
  }

  // Renormalise: truncating at 8 goals loses a sliver of probability mass.
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) matrix[i][j] /= total;
  }
  return matrix;
}

function bandFor(confidence: number): ConfidenceBand {
  if (confidence >= CONFIG.CONFIDENCE_BAND_HIGH) return 'high';
  if (confidence >= CONFIG.CONFIDENCE_BAND_MEDIUM) return 'medium';
  return 'low';
}

/**
 * Builds the reasons AS DATA. The AI phrasing layer may only reword these,
 * never add a reason of its own. Every factor carries the numbers behind it.
 */
function buildFactors(args: {
  home: TeamInput;
  away: TeamInput;
  competition: CompetitionInput;
  homeStats: TeamDiagnostics;
  awayStats: TeamDiagnostics;
  eloDiff: number | null;
  h2h?: HistoricalMatch[];
}): PredictionFactor[] {
  const { home, away, competition, homeStats, awayStats, eloDiff, h2h } = args;
  const factors: PredictionFactor[] = [];

  if (eloDiff !== null && Math.abs(eloDiff) >= CONFIG.FACTOR_MIN_ELO_GAP) {
    factors.push({
      type: 'elo_gap',
      side: eloDiff > 0 ? 'home' : 'away',
      impact: clamp(Math.abs(eloDiff) / 300, 0, 1),
      values: {
        gap: Math.round(Math.abs(eloDiff)),
        strongerTeam: eloDiff > 0 ? home.name : away.name,
      },
    });
  }

  const formDiff = homeStats.formPoints - awayStats.formPoints;
  if (Math.abs(formDiff) >= 3) {
    factors.push({
      type: 'form',
      side: formDiff > 0 ? 'home' : 'away',
      impact: clamp(Math.abs(formDiff) / 9, 0, 1),
      values: {
        homePoints: homeStats.formPoints,
        awayPoints: awayStats.formPoints,
        betterTeam: formDiff > 0 ? home.name : away.name,
      },
    });
  }

  const attackDiff = homeStats.attackStrength - awayStats.attackStrength;
  if (Math.abs(attackDiff) >= 0.2) {
    const side = attackDiff > 0 ? 'home' : 'away';
    factors.push({
      type: 'attack',
      side,
      impact: clamp(Math.abs(attackDiff) / 0.8, 0, 1),
      values: {
        team: side === 'home' ? home.name : away.name,
        goalsPerMatch: round(
          side === 'home' ? homeStats.rawGoalsFor : awayStats.rawGoalsFor,
          2,
        ),
      },
    });
  }

  const defenceDiff = awayStats.defenceStrength - homeStats.defenceStrength;
  if (Math.abs(defenceDiff) >= 0.2) {
    const side = defenceDiff > 0 ? 'home' : 'away';
    factors.push({
      type: 'defence',
      side,
      impact: clamp(Math.abs(defenceDiff) / 0.8, 0, 1),
      values: {
        team: side === 'home' ? home.name : away.name,
        concededPerMatch: round(
          side === 'home' ? homeStats.rawGoalsAgainst : awayStats.rawGoalsAgainst,
          2,
        ),
      },
    });
  }

  if (competition.homeAdvantage >= CONFIG.FACTOR_NOTABLE_HOME_ADVANTAGE) {
    factors.push({
      type: 'home_advantage',
      side: 'home',
      impact: clamp((competition.homeAdvantage - 1) / 0.4, 0, 1),
      values: {
        factor: round(competition.homeAdvantage, 2),
        competition: competition.name,
      },
    });
  }

  if (home.restDays !== null && away.restDays !== null) {
    const restDiff = home.restDays - away.restDays;
    if (Math.abs(restDiff) >= CONFIG.FACTOR_MIN_REST_DIFF) {
      factors.push({
        type: 'rest',
        side: restDiff > 0 ? 'home' : 'away',
        impact: clamp(Math.abs(restDiff) / 7, 0, 1),
        values: { homeRestDays: home.restDays, awayRestDays: away.restDays },
      });
    }
  }

  if (h2h && h2h.length >= 3) {
    const wins = h2h.filter((m) => m.goalsFor > m.goalsAgainst).length;
    const losses = h2h.filter((m) => m.goalsFor < m.goalsAgainst).length;
    if (wins !== losses) {
      factors.push({
        type: 'h2h',
        side: wins > losses ? 'home' : 'away',
        impact: clamp(Math.abs(wins - losses) / h2h.length, 0, 0.5),
        values: { meetings: h2h.length, homeWins: wins, awayWins: losses },
      });
    }
  }

  // Honesty factor: if we barely know anything, say so instead of hiding it.
  const thinnest = Math.min(homeStats.effectiveSample, awayStats.effectiveSample);
  if (thinnest < CONFIG.FACTOR_THIN_DATA_SAMPLE) {
    factors.push({
      type: 'thin_data',
      side: 'none',
      impact: 0.55,
      values: {
        homeMatches: homeStats.usedMatches,
        awayMatches: awayStats.usedMatches,
      },
    });
  }

  return factors.sort((a, b) => b.impact - a.impact).slice(0, CONFIG.MAX_FACTORS);
}

/**
 * Main entry point.
 * Returns either a full prediction or an explicit refusal — never a guess.
 */
export function predictMatch(input: PredictionInput): PredictionResult {
  const { home, away, competition, kickoff, h2h } = input;

  const homeHistory = buildWeights(home, competition);
  const awayHistory = buildWeights(away, competition);

  // The floor. Golden rule: no real data -> no prediction, in every path including cups.
  if (
    homeHistory.eligibleCount < CONFIG.MIN_ELIGIBLE_MATCHES ||
    awayHistory.eligibleCount < CONFIG.MIN_ELIGIBLE_MATCHES
  ) {
    return {
      eligible: false,
      modelVersion: ENGINE_VERSION,
      reason: 'insufficient_history',
      detail: {
        homeEligibleMatches: homeHistory.eligibleCount,
        awayEligibleMatches: awayHistory.eligibleCount,
        required: CONFIG.MIN_ELIGIBLE_MATCHES,
      },
    };
  }

  const leagueGoalsPerTeam = competition.leagueAvgGoals / 2;
  const homeStrength = computeStrengths(homeHistory, leagueGoalsPerTeam);
  const awayStrength = computeStrengths(awayHistory, leagueGoalsPerTeam);

  // Home advantage splits both ways so it shifts WHO scores without inventing goals.
  const haSplit = Math.sqrt(competition.homeAdvantage);

  const eloUsed = home.elo !== null && away.elo !== null;
  const eloDiff = eloUsed ? (home.elo as number) - (away.elo as number) : null;
  const eloMultiplier = eloUsed
    ? clamp(
        Math.exp((CONFIG.ELO_WEIGHT * (eloDiff as number)) / 400),
        CONFIG.ELO_MULTIPLIER_MIN,
        CONFIG.ELO_MULTIPLIER_MAX,
      )
    : 1;

  const restUsed = home.restDays !== null && away.restDays !== null;
  const homeRest = restUsed ? restMultiplier(home.restDays) : 1;
  const awayRest = restUsed ? restMultiplier(away.restDays) : 1;

  const lambdaHome = clamp(
    leagueGoalsPerTeam *
      homeStrength.attack *
      awayStrength.defence *
      haSplit *
      eloMultiplier *
      homeRest,
    CONFIG.LAMBDA_MIN,
    CONFIG.LAMBDA_MAX,
  );

  const lambdaAway = clamp(
    (leagueGoalsPerTeam * awayStrength.attack * homeStrength.defence * awayRest) /
      (haSplit * eloMultiplier),
    CONFIG.LAMBDA_MIN,
    CONFIG.LAMBDA_MAX,
  );

  const matrix = buildMatrix(lambdaHome, lambdaAway);
  const size = CONFIG.MAX_GOALS + 1;

  // --- everything below is DERIVED from the matrix. Nothing is computed separately. ---
  let probHome = 0;
  let probDraw = 0;
  let probAway = 0;
  let probOver25 = 0;
  let probBtts = 0;
  let bucket01 = 0;
  let bucket23 = 0;
  let bucket4plus = 0;
  let bestP = -1;
  let bestHome = 0;
  let bestAway = 0;

  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const p = matrix[i][j];
      if (i > j) probHome += p;
      else if (i === j) probDraw += p;
      else probAway += p;

      const total = i + j;
      if (total > 2.5) probOver25 += p;
      if (i >= 1 && j >= 1) probBtts += p;

      if (total <= 1) bucket01 += p;
      else if (total <= 3) bucket23 += p;
      else bucket4plus += p;

      if (p > bestP) {
        bestP = p;
        bestHome = i;
        bestAway = j;
      }
    }
  }

  const buckets: Array<[GoalBucket, number]> = [
    ['0-1', bucket01],
    ['2-3', bucket23],
    ['4+', bucket4plus],
  ];
  const predictedBucket = buckets.reduce((a, b) => (b[1] > a[1] ? b : a))[0];

  const homeDiag: TeamDiagnostics = {
    teamId: home.teamId,
    usedMatches: homeHistory.matches.length,
    effectiveSample: round(homeHistory.effectiveSample, 3),
    rawGoalsFor: round(homeStrength.rawFor, 3),
    rawGoalsAgainst: round(homeStrength.rawAgainst, 3),
    attackStrength: round(homeStrength.attack, 3),
    defenceStrength: round(homeStrength.defence, 3),
    formPoints: computeFormPoints(homeHistory),
    daysSinceLastMatch: homeHistory.matches.length
      ? daysBetween(homeHistory.matches[0].date, kickoff)
      : 0,
  };

  const awayDiag: TeamDiagnostics = {
    teamId: away.teamId,
    usedMatches: awayHistory.matches.length,
    effectiveSample: round(awayHistory.effectiveSample, 3),
    rawGoalsFor: round(awayStrength.rawFor, 3),
    rawGoalsAgainst: round(awayStrength.rawAgainst, 3),
    attackStrength: round(awayStrength.attack, 3),
    defenceStrength: round(awayStrength.defence, 3),
    formPoints: computeFormPoints(awayHistory),
    daysSinceLastMatch: awayHistory.matches.length
      ? daysBetween(awayHistory.matches[0].date, kickoff)
      : 0,
  };

  // --- confidence: three measured components, never a hand-picked number ---
  const maxProb = Math.max(probHome, probDraw, probAway);
  const decisiveness = clamp(
    (maxProb - CONFIG.DECISIVENESS_FLOOR) /
      (CONFIG.DECISIVENESS_CEILING - CONFIG.DECISIVENESS_FLOOR),
    0,
    1,
  );

  const sampleScore = clamp(
    Math.min(homeDiag.effectiveSample, awayDiag.effectiveSample) /
      CONFIG.DATA_QUALITY_TARGET_SAMPLE,
    0,
    1,
  );
  const stalest = Math.max(homeDiag.daysSinceLastMatch, awayDiag.daysSinceLastMatch);
  const freshness = clamp(
    (CONFIG.FRESHNESS_MAX_DAYS - stalest) /
      (CONFIG.FRESHNESS_MAX_DAYS - CONFIG.FRESHNESS_FULL_DAYS),
    0,
    1,
  );
  const dataQuality = 0.6 * sampleScore + 0.25 * (eloUsed ? 1 : 0) + 0.15 * freshness;

  const formEdge = Math.sign(
    homeStrength.attack * awayStrength.defence -
      awayStrength.attack * homeStrength.defence,
  );
  const eloEdge = eloDiff === null ? 0 : Math.sign(eloDiff);
  const agreement =
    eloEdge === 0 || formEdge === 0 ? 0.5 : eloEdge === formEdge ? 1 : 0;

  const confidence = Math.round(
    100 *
      (CONFIG.CONFIDENCE_WEIGHTS.decisiveness * decisiveness +
        CONFIG.CONFIDENCE_WEIGHTS.dataQuality * dataQuality +
        CONFIG.CONFIDENCE_WEIGHTS.agreement * agreement),
  );

  const factors = buildFactors({
    home,
    away,
    competition,
    homeStats: homeDiag,
    awayStats: awayDiag,
    eloDiff,
    h2h,
  });

  return {
    eligible: true,
    modelVersion: ENGINE_VERSION,

    lambdaHome: round(lambdaHome, 4),
    lambdaAway: round(lambdaAway, 4),

    predictedHomeScore: bestHome,
    predictedAwayScore: bestAway,
    probExactScore: round(bestP, 4),

    probHome: round(probHome, 4),
    probDraw: round(probDraw, 4),
    probAway: round(probAway, 4),

    expectedTotalGoals: round(lambdaHome + lambdaAway, 3),
    probOver25: round(probOver25, 4),
    probUnder25: round(1 - probOver25, 4),
    probBtts: round(probBtts, 4),

    bucket01: round(bucket01, 4),
    bucket23: round(bucket23, 4),
    bucket4plus: round(bucket4plus, 4),
    predictedBucket,

    confidence,
    confidenceBand: bandFor(confidence),
    confidenceParts: {
      decisiveness: round(decisiveness, 3),
      dataQuality: round(dataQuality, 3),
      agreement,
    },

    factors,
    matrix,

    diagnostics: {
      home: homeDiag,
      away: awayDiag,
      eloUsed,
      restUsed,
      homeAdvantage: competition.homeAdvantage,
      leagueAvgGoals: competition.leagueAvgGoals,
    },
  };
}
