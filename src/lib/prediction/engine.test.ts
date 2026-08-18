import { describe, expect, it } from 'vitest';

import { predict } from './engine';
import type {
  CompetitionInput,
  EngineConfig,
  HistoryMatch,
  TeamInput,
  TournamentType,
} from './types';

/** Mirrors the 28 numeric rows of model_config (model_version is text, not used here). */
const CONFIG: EngineConfig = {
  history_max_matches: 10,
  history_min_matches: 3,
  weight_official: 1.0,
  weight_friendly: 0.25,
  weight_youth: 0.0,
  weight_unknown_type: 0.6,
  weight_unknown_opponent: 0.6,
  opp_elo_scale: 800,
  opp_weight_floor: 0.45,
  recency_decay: 0.85,
  shrinkage_k: 4.0,
  elo_goal_scale: 1000,
  elo_mult_min: 0.6,
  elo_mult_max: 1.6,
  rest_days_threshold: 4,
  rest_penalty_per_day: 0.02,
  rest_penalty_floor: 0.92,
  lambda_min: 0.15,
  lambda_max: 5.0,
  max_goals_grid: 8,
  global_avg_goals_home: 1.6,
  global_avg_goals_away: 1.3,
  conf_w_decisive: 0.5,
  conf_w_data: 0.3,
  conf_w_agreement: 0.2,
  conf_band_low_max: 39,
  conf_band_mid_max: 69,
  accuracy_min_sample: 30,
};

const COMPETITION: CompetitionInput = {
  nameHe: 'ליגת העל',
  homeAdvantage: 1.1,
  avgGoalsHome: 1.6,
  avgGoalsAway: 1.3,
  refElo: 1500,
};

function match(
  goalsFor: number,
  goalsAgainst: number,
  opponentElo: number | null = 1500,
  tournamentType: TournamentType = 'official',
): HistoryMatch {
  return { goalsFor, goalsAgainst, opponentElo, tournamentType };
}

function team(history: HistoryMatch[], over: Partial<TeamInput> = {}): TeamInput {
  return {
    nameHe: 'קבוצה',
    eloInternal: 1500,
    eloClub: null,
    restDays: 4,
    history,
    ...over,
  };
}

function repeat(n: number, m: () => HistoryMatch): HistoryMatch[] {
  return Array.from({ length: n }, m);
}

function round4(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

/** Deterministic pseudo-random generator — no Math.random, so failures reproduce. */
function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe('prediction engine', () => {
  it('1. every probability group sums to exactly 1.0000 across 200 random inputs', () => {
    const rng = makeRng(20260818);
    let checked = 0;

    for (let n = 0; n < 200; n++) {
      const build = () =>
        team(
          repeat(3 + Math.floor(rng() * 8), () =>
            match(
              Math.floor(rng() * 5),
              Math.floor(rng() * 5),
              rng() < 0.25 ? null : 1200 + Math.floor(rng() * 600),
              rng() < 0.15 ? 'friendly' : 'official',
            ),
          ),
          {
            eloInternal: 1300 + Math.floor(rng() * 400),
            eloClub: rng() < 0.5 ? 1300 + Math.floor(rng() * 400) : null,
            restDays: rng() < 0.2 ? null : Math.floor(rng() * 10),
          },
        );

      const result = predict(
        {
          home: build(),
          away: build(),
          competition: { ...COMPETITION, homeAdvantage: 1 + rng() * 0.4 },
        },
        CONFIG,
      );
      if (!result.ok) continue;
      checked++;

      const p = result.prediction;
      expect(round4(p.probHome + p.probDraw + p.probAway)).toBe(1);
      expect(round4(p.probGoals01 + p.probGoals23 + p.probGoals4Plus)).toBe(1);
      expect(round4(p.probOver25 + p.probUnder25)).toBe(1);
    }

    expect(checked).toBeGreaterThan(150);
  });

  it('2. the normalized matrix sums to 1 within 1e-9', () => {
    const result = predict(
      { home: team(repeat(6, () => match(2, 1))), away: team(repeat(6, () => match(1, 2))), competition: COMPETITION },
      CONFIG,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sum = result.prediction.matrix.flat().reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
  });

  it('3. identical teams with no home advantage give equal home/away probabilities', () => {
    const history = repeat(6, () => match(2, 1));
    const result = predict(
      {
        home: team(history, { restDays: 4 }),
        away: team(history, { restDays: 4 }),
        competition: { ...COMPETITION, homeAdvantage: 1 },
      },
      CONFIG,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.prediction.probHome).toBeCloseTo(result.prediction.probAway, 4);
  });

  it('4. raising home advantage increases probHome and decreases probAway', () => {
    const history = repeat(6, () => match(2, 1));
    const base = predict(
      { home: team(history), away: team(history), competition: { ...COMPETITION, homeAdvantage: 1 } },
      CONFIG,
    );
    const boosted = predict(
      { home: team(history), away: team(history), competition: { ...COMPETITION, homeAdvantage: 1.3 } },
      CONFIG,
    );
    expect(base.ok && boosted.ok).toBe(true);
    if (!base.ok || !boosted.ok) return;
    expect(boosted.prediction.probHome).toBeGreaterThan(base.prediction.probHome);
    expect(boosted.prediction.probAway).toBeLessThan(base.prediction.probAway);
  });

  it('5. two surviving matches refuse; three predict', () => {
    const two = predict(
      { home: team(repeat(2, () => match(1, 1))), away: team(repeat(6, () => match(1, 1))), competition: COMPETITION },
      CONFIG,
    );
    expect(two.ok).toBe(false);
    if (!two.ok) {
      expect(two.reason).toBe('insufficient_history');
      expect(two.homeMatches).toBe(2);
      expect(two.required).toBe(3);
    }

    const three = predict(
      { home: team(repeat(3, () => match(1, 1))), away: team(repeat(6, () => match(1, 1))), competition: COMPETITION },
      CONFIG,
    );
    expect(three.ok).toBe(true);
  });

  it('6. youth matches are dropped before the gate', () => {
    const history = [
      ...repeat(3, () => match(1, 1, 1500, 'official')),
      ...repeat(5, () => match(4, 0, 1500, 'youth')),
    ];
    const result = predict(
      { home: team(history), away: team(repeat(6, () => match(1, 1))), competition: COMPETITION },
      CONFIG,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.prediction.historyMatchesHome).toBe(3);
  });

  it('7. shrinkage pulls a small sample harder toward the league average', () => {
    const opponent = team(repeat(6, () => match(1, 1)));
    const small = predict(
      { home: team(repeat(3, () => match(4, 1))), away: opponent, competition: COMPETITION },
      CONFIG,
    );
    const large = predict(
      { home: team(repeat(10, () => match(4, 1))), away: opponent, competition: COMPETITION },
      CONFIG,
    );
    expect(small.ok && large.ok).toBe(true);
    if (!small.ok || !large.ok) return;
    // Same 4-goal average, but the 3-match team is shrunk closer to the league mean.
    expect(small.prediction.lambdaHome).toBeLessThan(large.prediction.lambdaHome);
  });

  it('8. goals against weaker opponents are down-weighted', () => {
    const strongOpp = team(repeat(6, () => match(3, 1, 1500)));
    const weakOpp = team(repeat(6, () => match(3, 1, 1200)));
    const neutral = team(repeat(6, () => match(1, 1, 1500)));

    const vsStrong = predict({ home: strongOpp, away: neutral, competition: COMPETITION }, CONFIG);
    const vsWeak = predict({ home: weakOpp, away: neutral, competition: COMPETITION }, CONFIG);
    expect(vsStrong.ok && vsWeak.ok).toBe(true);
    if (!vsStrong.ok || !vsWeak.ok) return;
    expect(vsWeak.prediction.lambdaHome).toBeLessThan(vsStrong.prediction.lambdaHome);
  });

  it('9. unknown opponent Elo raises estimatedShare and lowers confidence', () => {
    const opponent = team(repeat(6, () => match(1, 1, 1500)));
    const known = predict(
      { home: team(repeat(6, () => match(2, 1, 1500))), away: opponent, competition: COMPETITION },
      CONFIG,
    );
    const unknown = predict(
      { home: team(repeat(6, () => match(2, 1, null))), away: opponent, competition: COMPETITION },
      CONFIG,
    );
    expect(known.ok && unknown.ok).toBe(true);
    if (!known.ok || !unknown.ok) return;
    expect(unknown.prediction.estimatedShare).toBeGreaterThan(known.prediction.estimatedShare);
    expect(unknown.prediction.confidence).toBeLessThan(known.prediction.confidence);
  });

  it('10. a missing config key throws an Error naming the key', () => {
    const broken: EngineConfig = { ...CONFIG };
    delete broken['shrinkage_k'];
    expect(() =>
      predict(
        { home: team(repeat(6, () => match(2, 1))), away: team(repeat(6, () => match(1, 1))), competition: COMPETITION },
        broken,
      ),
    ).toThrowError(/shrinkage_k/);
  });

  it('11. the same input produces an identical result twice', () => {
    const input = {
      home: team(repeat(7, () => match(2, 1, 1450)), { eloInternal: 1560, eloClub: 1580, restDays: 3 }),
      away: team(repeat(5, () => match(1, 2, null, 'friendly')), { eloInternal: 1490, restDays: 6 }),
      competition: COMPETITION,
    };
    const a = predict(input, CONFIG);
    const b = predict(input, CONFIG);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
