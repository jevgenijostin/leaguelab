import { jointPmf } from './dixonColes';
import { center } from './fitter';
import { mulberry32 } from './rng';
import type { CompletedMatch } from './types';

export const SYNTHETIC_SEED = 20261101;
/** Fixed truth before evaluation: stable ratings, 20 teams, 38 weekly rounds per season. */
export function syntheticLeague(world: 'null' | 'signal', seed = SYNTHETIC_SEED) {
  const teams = Array.from({ length: 20 }, (_, i) => `Team ${String(i + 1).padStart(2, '0')}`);
  const attack = center(teams.map((_, i) => world === 'null' ? 0 : 0.42 * Math.sin(i * 2.1)));
  const defense = center(teams.map((_, i) => world === 'null' ? 0 : 0.38 * Math.cos(i * 1.7)));
  const baseLog = Math.log(1.25), homeAdv = 0.2, rho = -0.1;
  const rng = mulberry32(seed), completed: CompletedMatch[] = [];
  const cdfs = teams.map((_, h) => teams.map((_, a) => {
    let sum = 0;
    return jointPmf(Math.exp(baseLog + homeAdv + attack[h] - defense[a]),
      Math.exp(baseLog + attack[a] - defense[h]), rho, 10).map(p => sum += p);
  }));
  // Circle schedule, with alternating home assignment and reversed return fixtures.
  for (let season = 0; season < 3; season++) {
    const rotation = teams.map((_, i) => i);
    for (let round = 0; round < 19; round++) {
      for (let pair = 0; pair < 10; pair++) {
        const left = rotation[pair], right = rotation[19 - pair];
        for (let leg = 0; leg < 2; leg++) {
          const flip = (round + pair + leg) % 2;
          const h = flip ? right : left, a = flip ? left : right;
          const u = rng(), cdf = cdfs[h][a];
          let score = cdf.findIndex(p => u < p);
          if (score < 0) score = cdf.length - 1;
          const date = new Date(Date.UTC(2022 + season, 7, 1 + 7 * (round + 19 * leg))).toISOString().slice(0, 10);
          completed.push({ date, home: teams[h], away: teams[a], hg: Math.floor(score / 11), ag: score % 11 });
        }
      }
      rotation.splice(1, 0, rotation.pop()!);
    }
  }
  completed.sort((a, b) => a.date.localeCompare(b.date));
  return { teams, completed, remaining: [], seasonStart: '2024-08-01', seed,
    truth: { attack, defense, baseLog, homeAdv, rho } };
}
