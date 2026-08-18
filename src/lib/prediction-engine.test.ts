import { describe, expect, it } from 'vitest';

import { computePrediction } from './prediction-engine';
import type { CompetitionInput, HistoryMatch, ModelConfig } from './prediction-engine';

const CFG: ModelConfig = {
  historyMaxMatches: 10,
  historyMinMatches: 3,
  weightOfficial: 1.0,
  weightFriendly: 0.25,
  weightYouth: 0.0,
  weightUnknownType: 0.6,
  weightUnknownOpponent: 0.6,
  oppEloScale: 800,
  oppWeightFloor: 0.45,
  recencyDecay: 0.85,
  shrinkageK: 4.0,
  eloGoalScale: 1000,
  eloMultMin: 0.6,
  eloMultMax: 1.6,
  restDaysThreshold: 4,
  restPenaltyPerDay: 0.02,
  restPenaltyFloor: 0.92,
  lambdaMin: 0.15,
  lambdaMax: 5.0,
  maxGoalsGrid: 8,
  globalAvgGoalsHome: 1.6,
  globalAvgGoalsAway: 1.3,
  confWDecisive: 0.5,
  confWData: 0.3,
  confWAgreement: 0.2,
  confBandLowMax: 39,
  confBandMidMax: 69,
};

const COMP: CompetitionInput = { avgTotalGoals: 2.9, homeAdvantage: 1.1 };

function m(gf: number, ga: number, oppElo: number | null = 1500, type: HistoryMatch['tournamentType'] = 'official'): HistoryMatch {
  return { goalsFor: gf, goalsAgainst: ga, tournamentType: type, opponentElo: oppElo };
}

/** avg 1.5 for / 1.2 against over 6 matches: 2,1,1,2,2,1 for and 1,1,2,1,1,1 against. */
function normalHistory(count = 6): HistoryMatch[] {
  const gf = [2, 1, 1, 2, 2, 1];
  const ga = [1, 1, 2, 1, 1, 1];
  return Array.from({ length: count }, (_, i) => m(gf[i % 6] as number, ga[i % 6] as number));
}

function repeat(n: number, gf: number, ga: number): HistoryMatch[] {
  return Array.from({ length: n }, () => m(gf, ga));
}

describe('prediction-engine', () => {
  it('1. identical teams: groups sum to 1 and home advantage shows', () => {
    const h = normalHistory();
    const r = computePrediction(h, h, 1600, 1600, COMP, 6, 6, CFG);
    expect(r).not.toBeNull();
    if (!r) return;
    expect(Math.abs(r.probHome + r.probDraw + r.probAway - 1)).toBeLessThan(0.0001);
    expect(Math.abs(r.probGoals0_1 + r.probGoals2_3 + r.probGoals4Plus - 1)).toBeLessThan(0.0001);
    expect(Math.abs(r.probOver25 + r.probUnder25 - 1)).toBeLessThan(0.0001);
    expect(r.probHome).toBeGreaterThan(r.probAway);
  });

  it('2. strong vs weak: probHome > 0.65 and confidence > 60', () => {
    const strong = repeat(8, 2.4, 0.7);
    const weak = repeat(8, 0.8, 2.1);
    const r = computePrediction(strong, weak, 1800, 1300, COMP, 6, 6, CFG);
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.probHome).toBeGreaterThan(0.65);
    expect(r.confidence).toBeGreaterThan(60);
  });

  it('3. less history does not raise confidence', () => {
    const away = normalHistory(6);
    const few = computePrediction(normalHistory(3), away, 1600, 1600, COMP, 6, 6, CFG);
    const many = computePrediction(normalHistory(10), away, 1600, 1600, COMP, 6, 6, CFG);
    expect(few).not.toBeNull();
    expect(many).not.toBeNull();
    if (!few || !many) return;
    expect(few.confidence).toBeLessThanOrEqual(many.confidence);
  });

  it('4. two matches returns null', () => {
    const r = computePrediction(normalHistory(2), normalHistory(6), 1600, 1600, COMP, 6, 6, CFG);
    expect(r).toBeNull();
  });

  it('5. unknown opponent Elo raises estimatedShare', () => {
    const mixed = [...normalHistory(3), ...normalHistory(3).map((x) => ({ ...x, opponentElo: null }))];
    const r = computePrediction(mixed, normalHistory(6), 1600, 1600, COMP, 6, 6, CFG);
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.estimatedShare).toBeGreaterThan(0);
  });

  it('6. a friendly blowout does not explode lambdaHome', () => {
    const base = normalHistory(6);
    const blowout = [m(8, 0, 1200, 'friendly'), ...normalHistory(6)];
    const withBlowout = computePrediction(blowout, base, 1600, 1600, COMP, 6, 6, CFG);
    const without = computePrediction(base, base, 1600, 1600, COMP, 6, 6, CFG);
    expect(withBlowout).not.toBeNull();
    expect(without).not.toBeNull();
    if (!withBlowout || !without) return;
    expect(withBlowout.lambdaHome - without.lambdaHome).toBeLessThanOrEqual(0.5);
  });

  it('7. short rest lowers lambdaHome', () => {
    const h = normalHistory(6);
    const tired = computePrediction(h, h, 1600, 1600, COMP, 2, 6, CFG);
    const fresh = computePrediction(h, h, 1600, 1600, COMP, 6, 6, CFG);
    expect(tired).not.toBeNull();
    expect(fresh).not.toBeNull();
    if (!tired || !fresh) return;
    expect(tired.lambdaHome).toBeLessThan(fresh.lambdaHome);
  });
});
