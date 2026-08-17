/**
 * Pure numeric helpers. No dependencies, deterministic, side-effect free.
 */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** log of the gamma function — Lanczos approximation, accurate to ~1e-13. */
function logGamma(z: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/**
 * Negative Binomial probability of exactly k goals, parameterised by mean and dispersion.
 * mean = lambda, variance = lambda + lambda^2 / r.
 * As r grows this converges to the Poisson pmf.
 */
export function negBinomialPmf(k: number, lambda: number, r: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  if (!isFinite(r) || r > 1e6) return poissonPmf(k, lambda);
  const p = r / (r + lambda);
  const logP =
    logGamma(k + r) - logGamma(r) - logGamma(k + 1) +
    r * Math.log(p) + k * Math.log(1 - p);
  return Math.exp(logP);
}

export function poissonPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return Math.exp(-lambda + k * Math.log(lambda) - logGamma(k + 1));
}

/** Weighted mean. Returns 0 when the weights sum to zero. */
export function weightedMean(values: number[], weights: number[]): number {
  let num = 0;
  let den = 0;
  for (let i = 0; i < values.length; i++) {
    num += values[i] * weights[i];
    den += weights[i];
  }
  return den === 0 ? 0 : num / den;
}

/**
 * Kish effective sample size: (Σw)² / Σw².
 * Tells us how many "full" matches the weighted set is really worth.
 */
export function effectiveSampleSize(weights: number[]): number {
  let sum = 0;
  let sumSq = 0;
  for (const w of weights) {
    sum += w;
    sumSq += w * w;
  }
  return sumSq === 0 ? 0 : (sum * sum) / sumSq;
}

/** Whole days between two ISO dates. Never negative. */
export function daysBetween(earlierIso: string, laterIso: string): number {
  const a = new Date(earlierIso).getTime();
  const b = new Date(laterIso).getTime();
  if (!isFinite(a) || !isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** Rounds to a fixed number of decimals without float noise. */
export function round(value: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(value * f) / f;
}
