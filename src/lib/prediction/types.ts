/**
 * PredictaBall — prediction engine v7
 * Shared types. Pure data, no I/O, no DB, no fetch.
 */

/** How serious a historical match was. Comes from the provider's tournament, never guessed. */
export type MatchType = 'league' | 'cup' | 'european' | 'friendly' | 'other';

/** One finished match in a team's real history. */
export interface HistoricalMatch {
  /** ISO date of kickoff. */
  date: string;
  /** Was the team the home side in that match. */
  isHome: boolean;
  goalsFor: number;
  goalsAgainst: number;
  matchType: MatchType;
  /** Competition the match belonged to, or null when unknown. */
  competitionId: string | null;
  /**
   * Opponent Elo at the time (ClubElo or internal).
   * null means we genuinely do not know — it is never invented.
   */
  opponentElo: number | null;
}

export interface TeamInput {
  teamId: string;
  name: string;
  /** Current Elo. null when we have none — the Elo term is then skipped. */
  elo: number | null;
  /** Finished matches, newest first. Pass everything we have; the engine caps it. */
  history: HistoricalMatch[];
  /** Days since this team's previous match. null when unknown. */
  restDays: number | null;
}

export interface CompetitionInput {
  competitionId: string;
  name: string;
  /** Measured per competition. Ligat ha'Al 1.05, UCL 1.28. Never a flat constant. */
  homeAdvantage: number;
  /** Average TOTAL goals per match in this competition, measured from our own results. */
  leagueAvgGoals: number;
  /** Average Elo of this competition — the yardstick for "was that opponent weak". */
  referenceElo: number;
}

export interface PredictionInput {
  home: TeamInput;
  away: TeamInput;
  competition: CompetitionInput;
  /** Previous meetings between the two, newest first. Optional. */
  h2h?: HistoricalMatch[];
  /** Kickoff, ISO. Used for recency freshness only. */
  kickoff: string;
}

export type FactorType =
  | 'elo_gap'
  | 'form'
  | 'attack'
  | 'defence'
  | 'home_advantage'
  | 'rest'
  | 'h2h'
  | 'thin_data';

/**
 * A single reason, as DATA. The AI only phrases these in Hebrew.
 * Every factor carries the numbers behind it — no factor may exist without them.
 */
export interface PredictionFactor {
  type: FactorType;
  /** Which side the factor favours. 'none' for neutral/honesty factors. */
  side: 'home' | 'away' | 'none';
  /** 0..1 — how strongly this factor moved the prediction. Used for ranking. */
  impact: number;
  /** The raw numbers. Rendered into Hebrew by the phrasing layer. */
  values: Record<string, number | string>;
}

export type ConfidenceBand = 'low' | 'medium' | 'high';
export type GoalBucket = '0-1' | '2-3' | '4+';

export interface TeamDiagnostics {
  teamId: string;
  /** Matches that passed the eligibility filter. */
  usedMatches: number;
  /** Effective sample size after weighting: (Σw)² / Σw². Honest measure of how much we really know. */
  effectiveSample: number;
  /** Weighted goals scored per match, before shrinkage. */
  rawGoalsFor: number;
  rawGoalsAgainst: number;
  /** After shrinkage toward the league average. */
  attackStrength: number;
  defenceStrength: number;
  /** Weighted points from the most recent 3 eligible matches. */
  formPoints: number;
  /** Days since the newest eligible match, relative to kickoff. */
  daysSinceLastMatch: number;
}

export interface PredictionOutput {
  eligible: true;
  modelVersion: string;

  /** Poisson/NegBin means. */
  lambdaHome: number;
  lambdaAway: number;

  /** Most likely exact score, taken from the matrix — never computed separately. */
  predictedHomeScore: number;
  predictedAwayScore: number;
  /** Probability of that exact score. */
  probExactScore: number;

  /** 1X2. Always sums to 1. */
  probHome: number;
  probDraw: number;
  probAway: number;

  expectedTotalGoals: number;
  probOver25: number;
  probUnder25: number;
  probBtts: number;

  /** Total-goals buckets. Always sums to 1. */
  bucket01: number;
  bucket23: number;
  bucket4plus: number;
  predictedBucket: GoalBucket;

  /** 0..100 and its band. */
  confidence: number;
  confidenceBand: ConfidenceBand;
  confidenceParts: {
    decisiveness: number;
    dataQuality: number;
    agreement: number;
  };

  /** Up to 3, sorted by impact. Input to the Hebrew phrasing layer. */
  factors: PredictionFactor[];

  /** Full 9x9 matrix, [home][away], indices 0..8. Sums to 1. */
  matrix: number[][];

  diagnostics: {
    home: TeamDiagnostics;
    away: TeamDiagnostics;
    eloUsed: boolean;
    restUsed: boolean;
    homeAdvantage: number;
    leagueAvgGoals: number;
  };
}

export interface PredictionRefusal {
  eligible: false;
  modelVersion: string;
  /** Machine-readable cause. The UI maps it to a Hebrew empty state. */
  reason: 'insufficient_history';
  detail: {
    homeEligibleMatches: number;
    awayEligibleMatches: number;
    required: number;
  };
}

export type PredictionResult = PredictionOutput | PredictionRefusal;
