import { mulberry32 } from './rng';

/** Class order is home, draw, away. */
export type Probabilities = readonly [number, number, number];
export type Outcome = 0 | 1 | 2;
export const outcome = (hg: number, ag: number): Outcome => hg > ag ? 0 : hg === ag ? 1 : 2;
export function rps(p: Probabilities, y: Outcome): number {
  return ((p[0] - Number(y === 0)) ** 2 + (p[0] + p[1] - Number(y <= 1)) ** 2) / 2;
}
export const logLoss = (p: Probabilities, y: Outcome): number => -Math.log(Math.max(1e-12, p[y]));
export const brier = (p: Probabilities, y: Outcome): number => p.reduce((s, v, k) => s + (v - Number(y === k)) ** 2, 0);
export function wilson(successes: number, n: number): [number, number] | null {
  if (!Number.isInteger(n) || !Number.isInteger(successes) || n < 0 || successes < 0 || successes > n) throw new RangeError('Invalid bin counts.');
  if (!n) return null;
  const z = 1.959963984540054, p = successes / n, d = 1 + z * z / n;
  const middle = (p + z * z / (2 * n)) / d;
  const radius = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return [Math.max(0, middle - radius), Math.min(1, middle + radius)];
}
export interface LossComparison { model: number; baseline: number; gain: number; ci: [number, number] }
/** Percentile paired bootstrap: resample match differences, never the two loss lists separately. */
export function pairedBootstrap(model: readonly number[], baseline: readonly number[], seed: number): LossComparison {
  if (!model.length || model.length !== baseline.length || ![...model, ...baseline].every(Number.isFinite)) throw new RangeError('Expected matching nonempty finite losses.');
  const n = model.length, differences = baseline.map((v, i) => v - model[i]), rng = mulberry32(seed);
  const samples = Array.from({ length: 2000 }, () => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += differences[Math.floor(rng() * n)];
    return sum / n;
  }).sort((a, b) => a - b);
  const quantile = (p: number) => {
    const index = p * (samples.length - 1), lo = Math.floor(index);
    return samples[lo] + (samples[Math.ceil(index)] - samples[lo]) * (index - lo);
  };
  const mean = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0) / n;
  return { model: mean(model), baseline: mean(baseline), gain: mean(differences), ci: [quantile(0.025), quantile(0.975)] };
}
export type Verdict = 'Model better than baseline' | 'Baseline better' | 'Inconclusive on this sample.';
export function verdict(ci: readonly [number, number]): Verdict {
  return ci[0] > 0 ? 'Model better than baseline' : ci[1] < 0 ? 'Baseline better' : 'Inconclusive on this sample.';
}
export interface CalibrationBin {
  lower: number; upper: number; n: number; meanPredicted: number | null;
  observedFrequency: number | null; interval: [number, number] | null;
  greyed: boolean; label: string;
}
export function calibration(rows: readonly { probabilities: Probabilities; observed: Outcome }[]) {
  const counts = Array(10).fill(0) as number[], sums = [...counts], successes = [...counts];
  for (const row of rows) row.probabilities.forEach((p, k) => {
    if (!Number.isFinite(p) || p < 0 || p > 1) throw new RangeError('Invalid calibration probability.');
    const bin = Math.min(9, Math.floor(p * 10));
    counts[bin]++; sums[bin] += p; successes[bin] += Number(row.observed === k);
  });
  const bins: CalibrationBin[] = counts.map((n, i) => ({
    lower: i / 10, upper: (i + 1) / 10, n, meanPredicted: n ? sums[i] / n : null,
    observedFrequency: n ? successes[i] / n : null, interval: wilson(successes[i], n),
    greyed: n < 20, label: n < 20 ? 'too few to read' : `${n} predictions`,
  }));
  const ece = rows.length ? sums.reduce((s, sum, i) => s + Math.abs(sum - successes[i]), 0) / (3 * rows.length) : null;
  return { bins, ece, caption: 'descriptive evidence from a finite sample, not proof of accuracy' };
}
