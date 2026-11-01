import { DEFAULT_FIT_CONFIG } from '../config/defaults';
import { jointPmf, scoringRates } from './dixonColes';
import { mulberry32 } from './rng';
import { addScore, buildTable, rankTable } from './table';
import type { Dataset, FitResult } from './types';

export interface SimulationInput {
  dataset: Dataset;
  fit: FitResult;
  seed: number;
  simulations?: number;
  maxGoals?: number;
  topK?: number;
  bottomK?: number;
  locks?: Record<string, { hg: number; ag: number }>;
}
export interface Probability { probability: number; standardError: number }
export interface TeamForecast {
  team: string;
  positions: number[];
  title: Probability;
  top: Probability;
  bottom: Probability;
  expectedPoints: number;
  pointsRange: [number, number];
  expectedRank: number;
}
export interface SimulationResult {
  seed: number;
  simulations: number;
  cutoff: string;
  topK: number;
  bottomK: number;
  teams: TeamForecast[];
}

export function jointCdf(lambda: number, mu: number, rho: number, maxGoals = 10): number[] {
  let sum = 0;
  const cdf = jointPmf(lambda, mu, rho, maxGoals).map(p => (sum += p));
  cdf[cdf.length - 1] = 1;
  return cdf;
}

/** Invert a precomputed row-major CDF using exactly one uniform. */
export function sampleScore(cdf: readonly number[], maxGoals: number, random: () => number): [number, number] {
  const u = random();
  let low = 0, high = cdf.length - 1;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (u < cdf[mid]) high = mid; else low = mid + 1;
  }
  return [Math.floor(low / (maxGoals + 1)), low % (maxGoals + 1)];
}

export function forecastCutoff(dataset: Dataset): string {
  if (!dataset.completed.length) throw new RangeError('Completed matches required.');
  const last = dataset.completed.reduce((date, match) => match.date > date ? match.date : date, '');
  return new Date(Date.parse(last) + 86400000).toISOString().slice(0, 10);
}

/** Pure synchronous engine; browser callers use startSimulation's worker. */
export function simulate(input: SimulationInput, progress?: (completed: number, total: number) => void): SimulationResult {
  const { dataset, fit, seed } = input;
  const n = dataset.teams.length, simulations = input.simulations ?? 10000;
  const maxGoals = input.maxGoals ?? DEFAULT_FIT_CONFIG.maxGoals;
  const topK = input.topK ?? Math.min(4, n), bottomK = input.bottomK ?? Math.min(3, n);
  if (!Number.isInteger(simulations) || simulations < 1 || simulations > 100000) throw new RangeError('Simulation count must be 1–100000.');
  if (![topK, bottomK].every(k => Number.isInteger(k) && k >= 1 && k <= n)) throw new RangeError('Invalid position threshold.');
  if (!Number.isInteger(maxGoals) || maxGoals < 1) throw new RangeError('Invalid maxGoals.');
  const cutoff = forecastCutoff(dataset);
  if (fit.cutoff !== cutoff) throw new RangeError('Fit cutoff must be the day after the last completed match.');
  const random = mulberry32(seed);
  const real = buildTable(dataset.teams, dataset.completed, dataset.seasonStart, random);
  const base = dataset.teams.map(team => real.find(row => row.team === team)!);
  const indices = new Map(dataset.teams.map((team, i) => [team, i]));
  const ids = new Set(dataset.remaining.map(f => f.id));
  if (ids.size !== dataset.remaining.length) throw new RangeError('Duplicate fixture IDs.');
  for (const id of Object.keys(input.locks ?? {})) if (!ids.has(id)) throw new RangeError('Unknown locked fixture.');
  const fixtures = dataset.remaining.map(f => {
    const h = indices.get(f.home), a = indices.get(f.away);
    if (h === undefined || a === undefined || h === a) throw new RangeError('Invalid fixture teams.');
    const lock = Object.hasOwn(input.locks ?? {}, f.id) ? input.locks![f.id] : undefined;
    if (lock) {
      addScore(base[h], base[a], lock.hg, lock.ag);
      return { h, a, cdf: null };
    }
    const { lambda, mu } = scoringRates(fit, f.home, f.away);
    return { h, a, cdf: jointCdf(lambda, mu, fit.rho, maxGoals) };
  }).filter(f => f.cdf !== null);
  const counts = dataset.teams.map(() => Array<number>(n).fill(0));
  const points = dataset.teams.map(() => new Map<number, number>());
  progress?.(0, simulations);
  for (let run = 0; run < simulations; run++) {
    const rows = base.map(row => ({ ...row }));
    for (const f of fixtures) {
      const [hg, ag] = sampleScore(f.cdf!, maxGoals, random);
      addScore(rows[f.h], rows[f.a], hg, ag);
    }
    const table = dataset.remaining.length ? rankTable(rows, random) : real;
    table.forEach((row, rank) => {
      const i = indices.get(row.team)!;
      counts[i][rank]++;
      points[i].set(row.points, (points[i].get(row.points) ?? 0) + 1);
    });
    if ((run + 1) % 250 === 0 || run + 1 === simulations) progress?.(run + 1, simulations);
  }
  const probability = (p: number): Probability => ({ probability: p, standardError: Math.sqrt(p * (1 - p) / simulations) });
  return { seed, simulations, cutoff, topK, bottomK, teams: dataset.teams.map((team, i) => {
    const positions = counts[i].map(count => count / simulations);
    const histogram = [...points[i]].sort((a, b) => a[0] - b[0]);
    const quantile = (q: number) => {
      let cumulative = 0;
      for (const [score, count] of histogram) { cumulative += count; if (cumulative >= Math.ceil(q * simulations)) return score; }
      return histogram[histogram.length - 1][0];
    };
    return { team, positions, title: probability(positions[0]), top: probability(positions.slice(0, topK).reduce((a, b) => a + b, 0)),
      bottom: probability(positions.slice(n - bottomK).reduce((a, b) => a + b, 0)),
      expectedPoints: histogram.reduce((sum, [score, count]) => sum + score * count, 0) / simulations,
      pointsRange: [quantile(0.05), quantile(0.95)], expectedRank: positions.reduce((sum, p, rank) => sum + p * (rank + 1), 0) };
  }) };
}
