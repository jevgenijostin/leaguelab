import { jointPmf } from '../src/core/dixonColes';
import { center } from '../src/core/fitter';
import type { CompletedMatch } from '../src/core/types';

// Test-only generator; the application generator belongs to phase 4.
export function random(seed: number): () => number {
  return () => {
    let t = seed += 0x6d2b79f5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export const smallTeams = ['A', 'B', 'C'];
export const smallMatches: CompletedMatch[] = [
  { date: '2024-01-01', home: 'A', away: 'B', hg: 0, ag: 0 },
  { date: '2024-02-10', home: 'B', away: 'C', hg: 0, ag: 1 },
  { date: '2024-03-20', home: 'C', away: 'A', hg: 1, ag: 0 },
  { date: '2024-05-01', home: 'B', away: 'A', hg: 1, ag: 1 },
  { date: '2024-06-15', home: 'C', away: 'B', hg: 3, ag: 2 },
  { date: '2024-08-20', home: 'A', away: 'C', hg: 2, ag: 4 },
];

export function recoveryData() {
  const rng = random(20261101);
  const teams = Array.from({ length: 20 }, (_, i) => `Team ${String(i).padStart(2, '0')}`);
  const attack = center(teams.map((_, i) => 0.42 * Math.sin(i * 2.1)));
  const defense = center(teams.map((_, i) => 0.38 * Math.cos(i * 1.7)));
  const baseLog = Math.log(1.25), homeAdv = 0.2, rho = -0.1;
  const matches: CompletedMatch[] = [];
  const cdfs = teams.map((_, h) => teams.map((_, a) => {
    let sum = 0;
    return jointPmf(Math.exp(baseLog + homeAdv + attack[h] - defense[a]),
      Math.exp(baseLog + attack[a] - defense[h]), rho, 10).map(p => sum += p);
  }));
  for (let season = 0; season < 6; season++) {
    for (let h = 0; h < 20; h++) for (let a = 0; a < 20; a++) {
      if (h === a) continue;
      const u = rng(), cdf = cdfs[h][a];
      const index = cdf.findIndex(p => p >= u);
      const date = new Date(Date.UTC(2020 + season, 0, 1 + Math.floor((h * 20 + a) / 2))).toISOString().slice(0, 10);
      matches.push({ date, home: teams[h], away: teams[a], hg: Math.floor(index / 11), ag: index % 11 });
    }
  }
  return { teams, matches, attack, defense, homeAdv, rho };
}

export function recoveryStats(actual: number[], expected: number[]) {
  const a = center(actual), b = center(expected);
  return {
    correlation: a.reduce((s, x, i) => s + x * b[i], 0) /
      Math.sqrt(a.reduce((s, x) => s + x * x, 0) * b.reduce((s, x) => s + x * x, 0)),
    rmse: Math.sqrt(actual.reduce((s, x, i) => s + (x - expected[i]) ** 2, 0) / a.length),
  };
}
