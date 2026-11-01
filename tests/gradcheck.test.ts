import { expect, test } from 'vitest';
import { DEFAULT_FIT_CONFIG } from '../src/config/defaults';
import { evaluate, prepareFit } from '../src/core/fitter';
import { gradientCheck } from '../src/core/gradcheck';
import { random, smallMatches, smallTeams } from './helpers';

test('G1: every coordinate at five seeded points with nonzero rho, ridge, and unequal decay weights', () => {
  const problem = prepareFit(smallTeams, smallMatches, '2024-09-01', DEFAULT_FIT_CONFIG);
  expect(new Set(problem.matches.map(m => m.w)).size).toBe(6);
  const rng = random(43), errors: number[] = [];
  for (let i = 0; i < 5; i++) {
    const theta = Array.from({ length: 9 }, () => (rng() - 0.5) * 0.6);
    theta[2] = (i % 2 ? -1 : 1) * (0.2 + rng() * 0.4);
    const original = [...theta];
    const result = gradientCheck(t => evaluate(problem, t), theta);
    expect(result.numerical).toHaveLength(theta.length);
    expect(result.passed).toBe(true);
    expect(result.maxRelativeError).toBeLessThan(1e-5);
    expect(theta).toEqual(original);
    errors.push(result.maxRelativeError);
  }
  console.log('G1 max relative errors:', errors);
});

test('gradient check fails for an incorrect derivative or nonfinite neighborhood', () => {
  expect(gradientCheck(t => ({ objective: t[0] ** 2, gradient: [0] }), [1]).passed).toBe(false);
  expect(gradientCheck(() => ({ objective: Infinity, gradient: [NaN] }), [1]).passed).toBe(false);
});
