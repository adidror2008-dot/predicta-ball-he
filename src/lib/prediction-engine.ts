// src/lib/prediction-engine.ts
//
// Pure prediction engine. NO database access. NO external API calls.
// Attack/defense-strength Poisson model with shrinkage, opponent weighting,
// recency decay, Elo adjustment and rest-day penalty.
// This is explicitly NOT Dixon-Coles (no low-score correlation correction) —
// that was tried and rejected twice per project doc.

export type TournamentType = 'official' | 'friendly' | 'youth' | 'unknown';

export interface HistoryMatch {
  goalsFor: number;
  goalsAgainst: number;
  tournamentType: TournamentType;
  opponentElo: number | null; // null = unknown opponent level
}

export interface CompetitionInput {
  avgTotalGoals: number | null; // measured (avg_goals_home+avg_goals_away) or null
  homeAdvantage: number; // e.g. 1.05 league, 1.28 Champions League
}

export interface ModelConfig {
  historyMaxMatches: number;
  historyMinMatches: number;
  weightOfficial: number;
  weightFriendly: number;
  weightYouth: number;
  weightUnknownType: number;
  weightUnknownOpponent: number;
  oppEloScale: number;
  oppWeightFloor: number;
  recencyDecay: number;
  shrinkageK: number;
  eloGoalScale: number;
  eloMultMin: number;
  eloMultMax: number;
  restDaysThreshold: number;
  restPenaltyPerDay: number;
  restPenaltyFloor: number;
  lambdaMin: number;
  lambdaMax: number;
  maxGoalsGrid: number;
  globalAvgGoalsHome: number;
  globalAvgGoalsAway: number;
  confWDecisive: number;
  confWData: number;
  confWAgreement: number;
  confBandLowMax: number;
  confBandMidMax: number;
}

export interface PredictionResult {
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
  probGoals0_1: number;
  probGoals2_3: number;
  probGoals4Plus: number;
  predictedGoalBucket: '0-1' | '2-3' | '4+';
  confidence: number;
  confidenceBand: 'low' | 'mid' | 'high';
  nEffHome: number;
  nEffAway: number;
  historyMatchesHome: number;
  historyMatchesAway: number;
  estimatedShare: number;
  factors: Array<{ type: string; side?: 'home' | 'away'; value: number }>;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function typeWeight(t: TournamentType, cfg: ModelConfig): number {
  switch (t) {
    case 'official': return cfg.weightOfficial;
    case 'friendly': return cfg.weightFriendly;
    case 'youth': return cfg.weightYouth;
    default: return cfg.weightUnknownType;
  }
}

function opponentWeight(ownElo: number | null, oppElo: number | null, cfg: ModelConfig): { w: number; unknown: boolean } {
  if (oppElo === null || ownElo === null) {
    return { w: cfg.weightUnknownOpponent, unknown: true };
  }
  const gap = ownElo - oppElo;
  const w = clamp(1 - gap / cfg.oppEloScale, cfg.oppWeightFloor, 1.0);
  return { w, unknown: false };
}

interface WeightedHistory {
  n: number;
  nEff: number;
  gfAvg: number;
  gaAvg: number;
  unknownShare: number;
}

// IMPORTANT: filter out tournamentType === 'youth' BEFORE calling this,
// and pass matches already sorted most-recent-first.
function weightedHistory(matches: HistoryMatch[], ownElo: number | null, cfg: ModelConfig): WeightedHistory {
  const capped = matches.slice(0, cfg.historyMaxMatches);
  const n = capped.length;
  const rows = capped.map((m, i) => {
    const tw = typeWeight(m.tournamentType, cfg);
    const { w: ow, unknown: unkOpp } = opponentWeight(ownElo, m.opponentElo, cfg);
    const rw = Math.pow(cfg.recencyDecay, i);
    const w = tw * ow * rw;
    const unknown = unkOpp || m.tournamentType === 'unknown';
    return { w, gf: m.goalsFor, ga: m.goalsAgainst, unknown };
  });
  const nEff = rows.reduce((s, r) => s + r.w, 0);
  if (nEff <= 0) return { n, nEff: 0, gfAvg: 0, gaAvg: 0, unknownShare: 1 };
  const gfAvg = rows.reduce((s, r) => s + r.w * r.gf, 0) / nEff;
  const gaAvg = rows.reduce((s, r) => s + r.w * r.ga, 0) / nEff;
  const unknownShare = rows.reduce((s, r) => s + (r.unknown ? r.w : 0), 0) / nEff;
  return { n, nEff, gfAvg, gaAvg, unknownShare };
}

function shrink(rawAvg: number, nEff: number, leagueAvg: number, k: number): number {
  return (nEff * rawAvg + k * leagueAvg) / (nEff + k);
}

function poissonPmf(k: number, lambda: number): number {
  let fact = 1;
  for (let i = 2; i <= k; i++) fact *= i;
  return Math.exp(-lambda) * Math.pow(lambda, k) / fact;
}

function buildMarginal(lambda: number, grid: number): number[] {
  const probs: number[] = [];
  for (let i = 0; i < grid; i++) probs.push(poissonPmf(i, lambda));
  const tail = 1 - probs.reduce((a, b) => a + b, 0);
  probs.push(Math.max(tail, 0));
  return probs;
}

/**
 * Returns null when either side has fewer than historyMinMatches usable
 * matches (youth already filtered out by caller). Absolute rule: no
 * prediction is computed or stored in that case — empty state, not a guess.
 */
export function computePrediction(
  homeHistory: HistoryMatch[],
  awayHistory: HistoryMatch[],
  homeElo: number | null,
  awayElo: number | null,
  competition: CompetitionInput,
  restDaysHome: number | null,
  restDaysAway: number | null,
  cfg: ModelConfig
): PredictionResult | null {
  const home = weightedHistory(homeHistory, homeElo, cfg);
  const away = weightedHistory(awayHistory, awayElo, cfg);

  if (home.n < cfg.historyMinMatches || away.n < cfg.historyMinMatches) {
    return null;
  }

  const avgTotal = competition.avgTotalGoals ?? (cfg.globalAvgGoalsHome + cfg.globalAvgGoalsAway);
  const homeAdv = competition.homeAdvantage;
  const homeShare = homeAdv / (homeAdv + 1);
  const awayShare = 1 - homeShare;
  const leagueAvgGoalsHome = avgTotal * homeShare;
  const leagueAvgGoalsAway = avgTotal * awayShare;
  const leagueAvgPerTeam = avgTotal / 2;

  const gfHomeS = shrink(home.gfAvg, home.nEff, leagueAvgPerTeam, cfg.shrinkageK);
  const gaHomeS = shrink(home.gaAvg, home.nEff, leagueAvgPerTeam, cfg.shrinkageK);
  const gfAwayS = shrink(away.gfAvg, away.nEff, leagueAvgPerTeam, cfg.shrinkageK);
  const gaAwayS = shrink(away.gaAvg, away.nEff, leagueAvgPerTeam, cfg.shrinkageK);

  const attackHome = gfHomeS / leagueAvgPerTeam;
  const defenseHome = gaHomeS / leagueAvgPerTeam;
  const attackAway = gfAwayS / leagueAvgPerTeam;
  const defenseAway = gaAwayS / leagueAvgPerTeam;

  const lamHomeRaw = leagueAvgGoalsHome * attackHome * defenseAway;
  const lamAwayRaw = leagueAvgGoalsAway * attackAway * defenseHome;

  let eloDiff = 0, eloMultHome = 1.0, eloMultAway = 1.0;
  if (homeElo !== null && awayElo !== null) {
    eloDiff = homeElo - awayElo;
    eloMultHome = clamp(1 + eloDiff / cfg.eloGoalScale, cfg.eloMultMin, cfg.eloMultMax);
    eloMultAway = clamp(1 - eloDiff / cfg.eloGoalScale, cfg.eloMultMin, cfg.eloMultMax);
  }

  function restPenalty(days: number | null): number {
    if (days === null || days >= cfg.restDaysThreshold) return 1.0;
    const deficit = cfg.restDaysThreshold - days;
    return clamp(1 - cfg.restPenaltyPerDay * deficit, cfg.restPenaltyFloor, 1.0);
  }
  const rpHome = restPenalty(restDaysHome);
  const rpAway = restPenalty(restDaysAway);

  const lambdaHome = clamp(lamHomeRaw * eloMultHome * rpHome, cfg.lambdaMin, cfg.lambdaMax);
  const lambdaAway = clamp(lamAwayRaw * eloMultAway * rpAway, cfg.lambdaMin, cfg.lambdaMax);

  const grid = cfg.maxGoalsGrid;
  const ph = buildMarginal(lambdaHome, grid);
  const pa = buildMarginal(lambdaAway, grid);

  const matrix: number[][] = [];
  for (let i = 0; i <= grid; i++) {
    matrix.push([]);
    for (let j = 0; j <= grid; j++) matrix[i]!.push(ph[i]! * pa[j]!);
  }

  let probHome = 0, probDraw = 0, probAway = 0;
  let bestI = 0, bestJ = 0, bestP = -1;
  let prob01 = 0, prob23 = 0, probOver25 = 0, probBtts = 0;
  for (let i = 0; i <= grid; i++) {
    for (let j = 0; j <= grid; j++) {
      const p = matrix[i]![j]!;
      if (i > j) probHome += p;
      else if (i === j) probDraw += p;
      else probAway += p;
      if (p > bestP) { bestP = p; bestI = i; bestJ = j; }
      const total = i + j;
      if (total <= 1) prob01 += p;
      else if (total <= 3) prob23 += p;
      if (total >= 3) probOver25 += p;
      if (i >= 1 && j >= 1) probBtts += p;
    }
  }
  const prob4Plus = 1 - prob01 - prob23;
  const probUnder25 = 1 - probOver25;

  const buckets: Record<'0-1' | '2-3' | '4+', number> = { '0-1': prob01, '2-3': prob23, '4+': prob4Plus };
  const predictedGoalBucket = (Object.keys(buckets) as Array<'0-1' | '2-3' | '4+'>)
    .reduce((a, b) => (buckets[a] >= buckets[b] ? a : b));

  const decisiveness = clamp((Math.max(probHome, probDraw, probAway) - 1 / 3) / (1 - 1 / 3), 0, 1);
  const dataQuality = clamp((home.nEff + away.nEff) / 2 / cfg.historyMaxMatches, 0, 1) *
    (1 - ((home.unknownShare + away.unknownShare) / 2) * 0.5);
  const goalSignal = lamHomeRaw >= lamAwayRaw ? 1 : -1;
  const eloSignal = eloDiff > 15 ? 1 : eloDiff < -15 ? -1 : 0;
  const agreement = eloSignal === 0 || eloSignal === goalSignal ? 1.0 : 0.0;
  const confRaw = cfg.confWDecisive * decisiveness + cfg.confWData * dataQuality + cfg.confWAgreement * agreement;
  const confidence = Math.round(confRaw * 100);
  const confidenceBand: 'low' | 'mid' | 'high' =
    confidence <= cfg.confBandLowMax ? 'low' : confidence <= cfg.confBandMidMax ? 'mid' : 'high';

  const factors: PredictionResult['factors'] = [];
  if (Math.abs(eloDiff) >= 15) {
    factors.push({ type: 'elo_gap', side: eloDiff > 0 ? 'home' : 'away', value: Math.round(Math.abs(eloDiff)) });
  }
  if (restDaysHome !== null && restDaysAway !== null && Math.abs(restDaysHome - restDaysAway) >= 2) {
    factors.push({ type: 'rest_days', side: restDaysHome > restDaysAway ? 'home' : 'away', value: Math.abs(restDaysHome - restDaysAway) });
  }
  const formGap = (home.gfAvg - home.gaAvg) - (away.gfAvg - away.gaAvg);
  if (Math.abs(formGap) >= 0.4) {
    factors.push({ type: 'form', side: formGap > 0 ? 'home' : 'away', value: Math.round(Math.abs(formGap) * 10) / 10 });
  }

  return {
    lambdaHome: Math.round(lambdaHome * 1000) / 1000,
    lambdaAway: Math.round(lambdaAway * 1000) / 1000,
    predictedHomeScore: bestI,
    predictedAwayScore: bestJ,
    probHome: Math.round(probHome * 10000) / 10000,
    probDraw: Math.round(probDraw * 10000) / 10000,
    probAway: Math.round(probAway * 10000) / 10000,
    expectedTotalGoals: Math.round((lambdaHome + lambdaAway) * 1000) / 1000,
    probOver25: Math.round(probOver25 * 10000) / 10000,
    probUnder25: Math.round(probUnder25 * 10000) / 10000,
    probBtts: Math.round(probBtts * 10000) / 10000,
    probGoals0_1: Math.round(prob01 * 10000) / 10000,
    probGoals2_3: Math.round(prob23 * 10000) / 10000,
    probGoals4Plus: Math.round(prob4Plus * 10000) / 10000,
    predictedGoalBucket,
    confidence: clamp(confidence, 0, 100),
    confidenceBand,
    nEffHome: Math.round(home.nEff * 100) / 100,
    nEffAway: Math.round(away.nEff * 100) / 100,
    historyMatchesHome: home.n,
    historyMatchesAway: away.n,
    estimatedShare: Math.round(((home.unknownShare + away.unknownShare) / 2) * 1000) / 1000,
    factors: factors.slice(0, 3),
  };
}
