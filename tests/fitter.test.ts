import { expect, test } from 'vitest';
import { DEFAULT_FIT_CONFIG } from '../src/config/defaults';
import { evaluate, fit, initialParameters, prepareFit } from '../src/core/fitter';
import { jointPmf, scoringRates } from '../src/core/dixonColes';
import { recoveryData, recoveryStats, smallMatches, smallTeams } from './helpers';

test('G5: recover 20-team strengths and global parameters from six double round-robin seasons', () => {
  const data = recoveryData();
  expect(data.matches).toHaveLength(2280);
  // No decay retains all six seasons for this finite-sample recovery experiment.
  // Defaults remain fixed; thresholds are attack/defense RMSE < 0.12.
  const start = performance.now();
  const result = fit(data.teams, data.matches, '2026-01-01', { ...DEFAULT_FIT_CONFIG, halfLifeDays: Infinity });
  const elapsed = performance.now() - start;
  const attack = recoveryStats(result.attack, data.attack), defense = recoveryStats(result.defense, data.defense);
  console.log('Recovery:', { attack, defense, rho: result.rho, homeAdv: result.homeAdv, elapsedMs: elapsed, diag: result.diag });
  expect(attack.correlation).toBeGreaterThan(0.9);
  expect(defense.correlation).toBeGreaterThan(0.9);
  expect(attack.rmse).toBeLessThan(0.12);
  expect(defense.rmse).toBeLessThan(0.12);
  expect(Math.abs(result.rho - data.rho)).toBeLessThan(0.05);
  expect(Math.abs(result.homeAdv - data.homeAdv)).toBeLessThan(0.08);
  expect(result.diag.converged).toBe(true);
  expect(Math.abs(result.attack.reduce((s, x) => s + x, 0))).toBeLessThan(1e-12);
  expect(Math.abs(result.defense.reduce((s, x) => s + x, 0))).toBeLessThan(1e-12);
});

test('fit timing for 20 teams and 760 matches with fixed defaults', () => {
  const data = recoveryData(), matches = data.matches.slice(-760);
  const start = performance.now();
  const result = fit(data.teams, matches, '2026-01-01');
  console.log('760-match fit:', { elapsedMs: performance.now() - start, diag: result.diag });
  expect(result.diag.converged).toBe(true);
});

test('reordering teams and matches produces the identical fit', () => {
  expect(fit([...smallTeams].reverse(), [...smallMatches].reverse(), '2024-09-01'))
    .toEqual(fit(smallTeams, smallMatches, '2024-09-01'));
});

test('strict cutoff: altered or appended future results leave fit and predictions bit-identical', () => {
  const cutoff = '2024-06-15';
  const original = fit(smallTeams, smallMatches, cutoff);
  const perturbed = smallMatches.map(m => m.date >= cutoff ? { ...m, hg: 71, ag: 42 } : m);
  perturbed.push({ date: '2025-01-01', home: 'A', away: 'B', hg: 99, ag: 99 });
  const changed = fit(smallTeams, perturbed, cutoff);
  expect(changed).toEqual(original);
  expect(original.nTrain).toBe(4);
  for (const home of smallTeams) for (const away of smallTeams) if (home !== away) {
    const a = scoringRates(original, home, away), b = scoringRates(changed, home, away);
    expect(jointPmf(a.lambda, a.mu, original.rho)).toEqual(jointPmf(b.lambda, b.mu, changed.rho));
  }
});

test('tiny iteration budget reports non-convergence and the final evaluated diagnostics', () => {
  const config = { ...DEFAULT_FIT_CONFIG, maxIter: 1 };
  const result = fit(smallTeams, smallMatches, '2024-09-01', config);
  expect(result.diag.converged).toBe(false);
  expect(result.diag.reason).toBe('maximum iterations');
  expect(result.diag.iterations).toBe(1);
  const problem = prepareFit(smallTeams, smallMatches, '2024-09-01', config);
  const final = evaluate(problem, initialParameters(problem, result));
  expect(result.diag.objective).toBeCloseTo(final.objective, 14);
  expect(result.diag.gradInfNorm).toBeCloseTo(Math.max(...final.gradient.map(Math.abs)), 14);
});

test('weights, initial weighted mean, and objective agree with a direct formula', () => {
  const problem = prepareFit(smallTeams, smallMatches, '2024-09-01');
  const expectedWeights = smallMatches.map(m => Math.exp(-Math.LN2 * (Date.parse('2024-09-01') - Date.parse(m.date)) / 86400000 / 300));
  problem.matches.forEach((m, i) => expect(m.w).toBeCloseTo(expectedWeights[i], 15));
  const W = expectedWeights.reduce((s, w) => s + w, 0);
  const mean = smallMatches.reduce((s, m, i) => s + expectedWeights[i] * (m.hg + m.ag), 0) / (2 * W);
  const theta = initialParameters(problem);
  expect(theta[0]).toBeCloseTo(Math.log(mean), 15);
  expect(theta.slice(1)).toEqual(Array(8).fill(0));
  const expected = -smallMatches.reduce((s, m, i) => s + expectedWeights[i] * ((m.hg + m.ag) * Math.log(mean) - 2 * mean), 0) / W;
  expect(evaluate(problem, theta).objective).toBeCloseTo(expected, 14);
});

test('centering removes raw shifts and projected gradients sum to zero', () => {
  const problem = prepareFit(smallTeams, smallMatches, '2024-09-01');
  const theta = [0.2, 0.1, -0.3, 0.1, -0.2, 0.3, -0.3, 0.2, 0.4];
  const shifted = theta.map((x, i) => i >= 6 ? x - 2 : i >= 3 ? x + 4 : x);
  const a = evaluate(problem, theta), b = evaluate(problem, shifted);
  expect(a.objective).toBeCloseTo(b.objective, 14);
  a.gradient.forEach((g, i) => expect(g).toBeCloseTo(b.gradient[i], 14));
  expect(a.gradient.slice(3, 6).reduce((s, g) => s + g, 0)).toBeCloseTo(0, 14);
  expect(a.gradient.slice(6).reduce((s, g) => s + g, 0)).toBeCloseTo(0, 14);
});

test('objective rejects correction factors at or below the safety boundary', () => {
  const problem = prepareFit(smallTeams, smallMatches, '2024-09-01');
  expect(evaluate(problem, [Math.log(4), 0, 2, ...Array(6).fill(0)]).objective).toBe(Infinity);
  expect(evaluate(problem, [1000, 0, 0, ...Array(6).fill(0)]).objective).toBe(Infinity);
});

test('warm start maps ratings by team and retains the optimized solution', () => {
  const data = recoveryData();
  const config = { ...DEFAULT_FIT_CONFIG, halfLifeDays: Infinity };
  const cold = fit(data.teams, data.matches, '2026-01-01', config);
  expect(cold.diag.converged).toBe(true);
  const reversed = { ...cold, teams: [...cold.teams].reverse(), attack: [...cold.attack].reverse(), defense: [...cold.defense].reverse() };
  const problem = prepareFit(data.teams, data.matches, '2026-01-01', config);
  expect(initialParameters(problem, reversed)).toEqual(initialParameters(problem, cold));
  const warm = fit(data.teams, data.matches, '2026-01-01', config, reversed);
  expect(warm.diag.converged).toBe(true);
  expect(warm.diag.objective).toBeLessThanOrEqual(cold.diag.objective + 1e-14);
  expect(warm.diag.objective).toBeCloseTo(cold.diag.objective, 8);
  expect(warm.diag.iterations).toBeLessThan(cold.diag.iterations);
});

test('empty training, all-zero scores, invalid config, and invalid dates fail explicitly', () => {
  expect(() => fit(smallTeams, [], '2024-09-01')).toThrow(/No effective/);
  expect(() => fit(smallTeams, smallMatches.map(m => ({ ...m, hg: 0, ag: 0 })), '2024-09-01')).toThrow(/All training goals/);
  expect(() => fit(smallTeams, smallMatches, '2024-09-01', { ...DEFAULT_FIT_CONFIG, halfLifeDays: 0 })).toThrow(/configuration/);
  expect(() => fit(smallTeams, smallMatches, '2024-02-30')).toThrow(/calendar date/);
});
