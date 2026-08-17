import type { MatchType } from './types';

/**
 * Every tunable number in the engine lives here and nowhere else.
 * Changing any of these REQUIRES re-running the backtest before shipping:
 * RPS must stay below the naive baseline or the change is a regression.
 */
export const ENGINE_VERSION = 'v7.0.0';

export const CONFIG = {
  /** Hard floor. Below this we refuse to predict. Never lowered. */
  MIN_ELIGIBLE_MATCHES: 3,

  /** Friendlies do NOT count toward the floor, but they do contribute at low weight. */
  FRIENDLIES_COUNT_TOWARD_MINIMUM: false,

  /** Read up to this many finished matches. Recency decay keeps the newest dominant. */
  MAX_HISTORY: 10,

  /** Weight halves every N matches going back. 4 → newest 1.00, 5th 0.50, 9th 0.25. */
  RECENCY_HALFLIFE_MATCHES: 4,

  /** Layer 1 — how serious the match was. Source: provider tournament, never guessed. */
  TYPE_WEIGHTS: {
    league: 1.0,
    cup: 1.0,
    european: 1.0,
    friendly: 0.25,
    other: 0.6,
  } as Record<MatchType, number>,

  /**
   * Layer 2a — opponent NORMALISATION. This is the part that actually discounts
   * goals scored against weak sides. Four goals past a bottom club are worth fewer
   * than four goals past a title contender, and this is where that is applied.
   * factor = exp(OPPONENT_ADJUST_STRENGTH * (referenceElo - opponentElo) / 400)
   */
  OPPONENT_ADJUST_STRENGTH: 0.3,
  OPPONENT_ADJUST_MIN: 0.65,
  OPPONENT_ADJUST_MAX: 1.55,

  /**
   * Layer 2b — opponent INFORMATIVENESS weight. A wild mismatch in EITHER direction
   * tells us less about a team's true level, so it carries less weight. Symmetric,
   * because a 0-6 hammering by a giant is as uninformative as a 6-0 over a minnow.
   */
  OPPONENT_ELO_SCALE: 800,
  OPPONENT_WEIGHT_FLOOR: 0.45,

  /** Layer 3 — opponent level genuinely unknown: no goal adjustment, reduced trust. */
  UNKNOWN_OPPONENT_WEIGHT: 0.6,

  /**
   * Shrinkage toward the league average, in pseudo-matches.
   * With effective sample 3 the team's own numbers carry ~43%; at 9 they carry ~69%.
   * This is the fix for the over-dispersion that killed the goal-bucket prediction twice.
   */
  SHRINKAGE_PSEUDO_MATCHES: 4,

  /** How hard an Elo gap pushes the goal means. exp(ELO_WEIGHT * eloDiff / 400). */
  ELO_WEIGHT: 0.3,
  ELO_MULTIPLIER_MIN: 0.7,
  ELO_MULTIPLIER_MAX: 1.43,

  /** Rest days. Neutral at 4 days; ±4 days moves the mean by at most this fraction. */
  REST_NEUTRAL_DAYS: 4,
  REST_COEFFICIENT: 0.04,

  /** Goal means are clamped here so one freak result cannot produce a nonsense matrix. */
  LAMBDA_MIN: 0.15,
  LAMBDA_MAX: 4.5,

  /**
   * Negative Binomial dispersion (size r). Variance = λ + λ²/r.
   * Lower = wider than Poisson. Infinity would be pure Poisson.
   * Set to 7 to widen the tails, because our λ comes from very few matches.
   */
  NB_DISPERSION: 7,

  /** Matrix is (MAX_GOALS+1)² — 0..8 each side, 81 outcomes. */
  MAX_GOALS: 8,

  /** Confidence weights. Must sum to 1. */
  CONFIDENCE_WEIGHTS: {
    decisiveness: 0.45,
    dataQuality: 0.35,
    agreement: 0.2,
  },
  /** Top 1X2 probability mapped onto 0..1 decisiveness. */
  DECISIVENESS_FLOOR: 0.35,
  DECISIVENESS_CEILING: 0.7,
  /** Effective sample at which data quality is considered full. */
  DATA_QUALITY_TARGET_SAMPLE: 6,
  /** Freshness: full credit within this many days, zero credit past FRESHNESS_MAX_DAYS. */
  FRESHNESS_FULL_DAYS: 30,
  FRESHNESS_MAX_DAYS: 180,

  CONFIDENCE_BAND_MEDIUM: 40,
  CONFIDENCE_BAND_HIGH: 65,

  /** Factor thresholds — below these a factor is not worth showing the user. */
  FACTOR_MIN_ELO_GAP: 40,
  FACTOR_MIN_REST_DIFF: 3,
  FACTOR_NOTABLE_HOME_ADVANTAGE: 1.15,
  FACTOR_THIN_DATA_SAMPLE: 4,
  MAX_FACTORS: 3,
} as const;
