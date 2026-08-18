/**
 * PredictaBall — prediction engine, shared types.
 * Pure data only: no I/O, no DB, no fetch, no env.
 */

export type TournamentType = 'official' | 'friendly' | 'youth' | 'unknown';
export type GoalBucket = '0-1' | '2-3' | '4+';
export type ConfidenceBand = 'low' | 'mid' | 'high';

export interface HistoryMatch {
  goalsFor: number;
  goalsAgainst: number;
  /** null = opponent level unknown. Never guess it. */
  opponentElo: number | null;
  tournamentType: TournamentType;
}

export interface TeamInput {
  nameHe: string;
  eloInternal: number | null;
  eloClub: number | null;
  restDays: number | null;
  /** Newest first. */
  history: HistoryMatch[];
}

export interface CompetitionInput {
  nameHe: string;
  homeAdvantage: number;
  avgGoalsHome: number | null;
  avgGoalsAway: number | null;
  refElo: number | null;
}

/** Straight from the model_config table. */
export type EngineConfig = Record<string, number>;

export type FactorKey =
  | 'elo_gap'
  | 'form'
  | 'attack_defence'
  | 'home_advantage'
  | 'rest'
  | 'estimated_history'
  | 'low_sample';

export type FactorSide = 'home' | 'away' | 'none';

export interface Factor {
  key: FactorKey;
  side: FactorSide;
  values: Record<string, number | string>;
  impact: number;
}

export interface Prediction {
  lambdaHome: number;
  lambdaAway: number;

  predictedHomeScore: number;
  predictedAwayScore: number;

  probHome: number;
  probDraw: number;
  probAway: number;

  expectedTotalGoals: number;
  probOver25: number;
  probUnder25: number;
  probBtts: number;

  probGoals01: number;
  probGoals23: number;
  probGoals4Plus: number;
  predictedGoalBucket: GoalBucket;

  confidence: number;
  confidenceBand: ConfidenceBand;

  factors: Factor[];
  reasonLinesHe: string[];

  nEffHome: number;
  nEffAway: number;
  historyMatchesHome: number;
  historyMatchesAway: number;
  estimatedShare: number;

  /** Normalized Poisson grid, [home][away]. Exposed for tests. */
  matrix: number[][];
}

export interface EngineInput {
  home: TeamInput;
  away: TeamInput;
  competition: CompetitionInput;
}

export type EngineResult =
  | {
      ok: false;
      reason: 'insufficient_history';
      homeMatches: number;
      awayMatches: number;
      required: number;
    }
  | { ok: true; prediction: Prediction };
