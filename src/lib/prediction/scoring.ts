/**
 * Grades a finished match against the prediction that was LOCKED before kickoff.
 * These are the numbers that feed the "דיוק המודל" panel in Settings.
 *
 * Never grade a prediction that was written after kickoff — that inflates the score
 * and makes the whole panel a lie. Always pass the locked snapshot.
 */

import { round } from './math';
import type { GoalBucket, PredictionOutput } from './types';

export interface ActualResult {
  homeScore: number;
  awayScore: number;
}

export interface GradedPrediction {
  modelVersion: string;
  confidence: number;
  confidenceBand: PredictionOutput['confidenceBand'];

  /** Did we call the right side (or the draw)? */
  hitWinner: boolean;
  /** Did we call the exact scoreline? */
  hitExact: boolean;
  /** Did we call the right total-goals bucket: 0-1 / 2-3 / 4+ ? */
  hitBucket: boolean;
  predictedBucket: GoalBucket;
  actualBucket: GoalBucket;
  /** Did we call over/under 2.5 correctly? Kept as a secondary sanity metric. */
  hitOverUnder25: boolean;
  /** |predicted total - actual total|. */
  goalsError: number;

  /** Ranked Probability Score for 1X2. Lower is better. This is the headline metric. */
  rps: number;
  /** Multi-class Brier score for 1X2. Lower is better. */
  brier: number;
}

export function bucketOf(totalGoals: number): GoalBucket {
  if (totalGoals <= 1) return '0-1';
  if (totalGoals <= 3) return '2-3';
  return '4+';
}

/**
 * Ranked Probability Score over the ordered outcome set (home, draw, away).
 * RPS = 1/(k-1) * Σ_{i=1..k-1} ( Σ_{j<=i} p_j - Σ_{j<=i} o_j )²
 */
export function rankedProbabilityScore(
  probs: [number, number, number],
  outcomeIndex: 0 | 1 | 2,
): number {
  const observed: [number, number, number] = [0, 0, 0];
  observed[outcomeIndex] = 1;

  let cumP = 0;
  let cumO = 0;
  let sum = 0;
  for (let i = 0; i < 2; i++) {
    cumP += probs[i] as number;
    cumO += observed[i] as number;
    sum += (cumP - cumO) ** 2;
  }
  return sum / 2;
}

export function brierScore(
  probs: [number, number, number],
  outcomeIndex: 0 | 1 | 2,
): number {
  const observed = [0, 0, 0];
  observed[outcomeIndex] = 1;
  return probs.reduce((acc, p, i) => acc + (p - (observed[i] as number)) ** 2, 0);
}

export function gradePrediction(
  prediction: PredictionOutput,
  actual: ActualResult,
): GradedPrediction {
  const outcomeIndex: 0 | 1 | 2 =
    actual.homeScore > actual.awayScore ? 0 : actual.homeScore === actual.awayScore ? 1 : 2;

  const predictedIndex: 0 | 1 | 2 =
    prediction.probHome >= prediction.probDraw && prediction.probHome >= prediction.probAway
      ? 0
      : prediction.probDraw >= prediction.probAway
        ? 1
        : 2;

  const probs: [number, number, number] = [
    prediction.probHome,
    prediction.probDraw,
    prediction.probAway,
  ];

  const predictedTotal = prediction.predictedHomeScore + prediction.predictedAwayScore;
  const actualTotal = actual.homeScore + actual.awayScore;
  const actualBucket = bucketOf(actualTotal);

  return {
    modelVersion: prediction.modelVersion,
    confidence: prediction.confidence,
    confidenceBand: prediction.confidenceBand,

    hitWinner: predictedIndex === outcomeIndex,
    hitExact:
      prediction.predictedHomeScore === actual.homeScore &&
      prediction.predictedAwayScore === actual.awayScore,
    hitBucket: prediction.predictedBucket === actualBucket,
    predictedBucket: prediction.predictedBucket,
    actualBucket,
    hitOverUnder25: prediction.probOver25 >= 0.5 ? actualTotal > 2.5 : actualTotal < 2.5,
    goalsError: Math.abs(predictedTotal - actualTotal),

    rps: round(rankedProbabilityScore(probs, outcomeIndex), 5),
    brier: round(brierScore(probs, outcomeIndex), 5),
  };
}

/** The naive baseline the model must beat: always predict a home win, 2-3 goals. */
export function gradeNaiveBaseline(
  actual: ActualResult,
  homeWinRate = 0.44,
  drawRate = 0.26,
): Pick<GradedPrediction, 'hitWinner' | 'hitBucket' | 'rps'> {
  const outcomeIndex: 0 | 1 | 2 =
    actual.homeScore > actual.awayScore ? 0 : actual.homeScore === actual.awayScore ? 1 : 2;
  const probs: [number, number, number] = [
    homeWinRate,
    drawRate,
    1 - homeWinRate - drawRate,
  ];
  return {
    hitWinner: outcomeIndex === 0,
    hitBucket: bucketOf(actual.homeScore + actual.awayScore) === '2-3',
    rps: round(rankedProbabilityScore(probs, outcomeIndex), 5),
  };
}
