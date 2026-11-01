import { expect, test } from 'vitest';
import { jointPmf, tau } from '../src/core/dixonColes';
import { random } from './helpers';

test('pmfs have positive corrections, nonnegative mass and unit sum over 250 seeded cases', () => {
  const rng = random(72);
  for (let i = 0; i < 250; i++) {
    const lambda = 0.2 + 2.5 * rng(), mu = 0.2 + 2.5 * rng(), rho = (rng() - 0.5) * 0.2;
    const pmf = jointPmf(lambda, mu, rho, 10);
    expect(pmf).toHaveLength(121);
    expect(pmf.every(p => p >= 0 && Number.isFinite(p))).toBe(true);
    expect(pmf.reduce((s, p) => s + p, 0)).toBeCloseTo(1, 14);
    for (const [x, y] of [[0, 0], [0, 1], [1, 0], [1, 1]]) expect(tau(x, y, lambda, mu, rho)).toBeGreaterThan(0);
  }
});

test('rho zero reduces to the product of independently truncated Poisson distributions', () => {
  const poisson = (rate: number) => {
    const p = [Math.exp(-rate)];
    for (let k = 1; k <= 10; k++) p.push(p[k - 1] * rate / k);
    const sum = p.reduce((s, x) => s + x, 0);
    return p.map(x => x / sum);
  };
  const home = poisson(1.7), away = poisson(0.9), pmf = jointPmf(1.7, 0.9, 0);
  for (let x = 0; x <= 10; x++) for (let y = 0; y <= 10; y++) expect(pmf[x * 11 + y]).toBeCloseTo(home[x] * away[y], 14);
});

test('four correction masses cancel and the truncated corrected distribution is renormalized', () => {
  const lambda = 1.5, mu = 1.1, rho = -0.12;
  let correctionMass = 0;
  for (const [x, y] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
    correctionMass += (tau(x, y, lambda, mu, rho) - 1) * Math.exp(-lambda - mu) * lambda ** x * mu ** y;
  }
  expect(correctionMass).toBeCloseTo(0, 15);
  const pmf = jointPmf(lambda, mu, rho, 1);
  const raw = [1 - lambda * mu * rho, mu * (1 + lambda * rho), lambda * (1 + mu * rho), lambda * mu * (1 - rho)];
  const total = raw.reduce((s, p) => s + p, 0);
  pmf.forEach((p, i) => expect(p).toBeCloseTo(raw[i] / total, 14));
});

test('invalid correction factors and invalid inputs are rejected', () => {
  for (const args of [[3, 3, 0.2], [6, 1, -0.2], [1, 6, -0.2], [1, 1, 1], [0, 1, 0], [NaN, 1, 0]]) {
    expect(() => jointPmf(args[0], args[1], args[2])).toThrow(RangeError);
  }
  expect(() => jointPmf(1, 1, 0, 0)).toThrow(RangeError);
});
