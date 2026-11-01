import type { FitResult } from './types';

export function tau(x: number, y: number, lambda: number, mu: number, rho: number): number {
  if (x === 0 && y === 0) return 1 - lambda * mu * rho;
  if (x === 0 && y === 1) return 1 + lambda * rho;
  if (x === 1 && y === 0) return 1 + mu * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

/** Row-major score probabilities: index = homeGoals * (maxGoals + 1) + awayGoals. */
export function jointPmf(lambda: number, mu: number, rho: number, maxGoals = 10): number[] {
  if (![lambda, mu, rho].every(Number.isFinite) || lambda <= 0 || mu <= 0) {
    throw new RangeError('Scoring rates must be finite and positive; rho must be finite.');
  }
  if (!Number.isInteger(maxGoals) || maxGoals < 1) throw new RangeError('maxGoals must be a positive integer.');
  for (const [x, y] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
    if (tau(x, y, lambda, mu, rho) <= 0) throw new RangeError('Nonpositive correction factor.');
  }
  // Log space avoids underflow before the truncated distribution is normalized.
  const logs = (rate: number) => {
    const result = [0]; // The common exp(-rate) cancels on normalization.
    for (let k = 1; k <= maxGoals; k++) result.push(result[k - 1] + Math.log(rate) - Math.log(k));
    return result;
  };
  const home = logs(lambda), away = logs(mu), scores: number[] = [];
  for (let x = 0; x <= maxGoals; x++) {
    for (let y = 0; y <= maxGoals; y++) scores.push(home[x] + away[y] + Math.log(tau(x, y, lambda, mu, rho)));
  }
  const largest = Math.max(...scores);
  const probabilities = scores.map(score => Math.exp(score - largest));
  const total = probabilities.reduce((sum, p) => sum + p, 0);
  return probabilities.map(p => p / total);
}

export function scoringRates(fit: FitResult, home: string, away: string): { lambda: number; mu: number } {
  const h = fit.teams.indexOf(home), a = fit.teams.indexOf(away);
  if (h < 0 || a < 0 || h === a) throw new RangeError('Fixture requires two distinct known teams.');
  return {
    lambda: Math.exp(fit.baseLog + fit.homeAdv + fit.attack[h] - fit.defense[a]),
    mu: Math.exp(fit.baseLog + fit.attack[a] - fit.defense[h]),
  };
}
