// PredictaBall — parameter sweep (coordinate descent) over the v7 backtest.
//
// ZERO outgoing API calls. Pure internal DB work.
// The live `model_config` table is NEVER touched — every candidate value is
// passed in memory as `overrides` to runBacktestV7.

import { runBacktestV7, type BacktestSummary } from "@/lib/backtest-v7.server";

interface SweepAxis {
  /** human label for the axis */
  name: string;
  /** each candidate is a partial override set (pairs stay together) */
  candidates: Array<Record<string, number>>;
}

const AXES: SweepAxis[] = [
  {
    name: "recency_decay",
    candidates: [0.7, 0.8, 0.85, 0.9, 0.95].map((v) => ({ recency_decay: v })),
  },
  {
    name: "elo_goal_scale",
    candidates: [600, 800, 1000, 1400].map((v) => ({ elo_goal_scale: v })),
  },
  {
    name: "elo_mult_range",
    candidates: [
      { elo_mult_min: 0.7, elo_mult_max: 1.45 },
      { elo_mult_min: 0.6, elo_mult_max: 1.6 },
      { elo_mult_min: 0.5, elo_mult_max: 1.8 },
    ],
  },
  {
    name: "opp_weight_floor",
    candidates: [0.3, 0.45, 0.6].map((v) => ({ opp_weight_floor: v })),
  },
  {
    name: "opp_elo_scale",
    candidates: [600, 800, 1100].map((v) => ({ opp_elo_scale: v })),
  },
];

export interface SweepRow {
  label: string;
  overrides: Record<string, number>;
  run_id: string;
  n: number;
  rps_avg: number | null;
  brier_avg: number | null;
  winner_accuracy: number | null;
  exact_score_accuracy: number | null;
  over_under_accuracy: number | null;
}

export interface SweepResult {
  runs: number;
  rounds: number;
  baseline: SweepRow;
  best: SweepRow;
  top5: SweepRow[];
  all: SweepRow[];
  duration_ms: number;
}

function describe(overrides: Record<string, number>): string {
  const keys = Object.keys(overrides).sort();
  if (keys.length === 0) return "sweep default (no overrides)";
  return `sweep ${keys.map((k) => `${k}=${overrides[k]}`).join(" ")}`;
}

function keyOf(overrides: Record<string, number>): string {
  return Object.keys(overrides)
    .sort()
    .map((k) => `${k}=${overrides[k]}`)
    .join("|");
}

function toRow(label: string, overrides: Record<string, number>, s: BacktestSummary): SweepRow {
  return {
    label,
    overrides,
    run_id: s.run_id,
    n: s.n,
    rps_avg: s.rps_avg,
    brier_avg: s.brier_avg,
    winner_accuracy: s.winner_accuracy,
    exact_score_accuracy: s.exact_score_accuracy,
    over_under_accuracy: s.over_under_accuracy,
  };
}

export async function runBacktestSweep(input: { rounds?: number } = {}): Promise<SweepResult> {
  const startedAt = Date.now();
  const rounds = input.rounds ?? 2;

  const cache = new Map<string, SweepRow>();
  const all: SweepRow[] = [];

  const evaluate = async (overrides: Record<string, number>): Promise<SweepRow> => {
    const key = keyOf(overrides);
    const cached = cache.get(key);
    if (cached) return cached;
    const label = describe(overrides);
    const summary = await runBacktestV7({ label, overrides });
    const row = toRow(label, { ...overrides }, summary);
    cache.set(key, row);
    all.push(row);
    return row;
  };

  const scoreOf = (row: SweepRow) => (row.rps_avg === null ? Number.POSITIVE_INFINITY : row.rps_avg);

  const baseline = await evaluate({});
  let current: Record<string, number> = {};
  let currentRow = baseline;

  for (let round = 0; round < rounds; round++) {
    for (const axis of AXES) {
      let bestRow = currentRow;
      let bestOverrides = current;
      for (const candidate of axis.candidates) {
        const trial = { ...current, ...candidate };
        const row = await evaluate(trial);
        if (scoreOf(row) < scoreOf(bestRow)) {
          bestRow = row;
          bestOverrides = trial;
        }
      }
      current = bestOverrides;
      currentRow = bestRow;
    }
  }

  const sorted = [...all].sort((a, b) => scoreOf(a) - scoreOf(b));

  return {
    runs: all.length,
    rounds,
    baseline,
    best: sorted[0] as SweepRow,
    top5: sorted.slice(0, 5),
    all: sorted,
    duration_ms: Date.now() - startedAt,
  };
}
