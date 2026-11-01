import { expect, test } from 'vitest';
import { jointPmf } from '../src/core/dixonColes';
import { mulberry32 } from '../src/core/rng';
import { forecastCutoff, jointCdf, sampleScore, simulate, type SimulationInput } from '../src/core/simulate';
import { buildTable } from '../src/core/table';

import { toy } from './simulationFixture';

test('G6: zero remaining fixtures reproduce the real table, including fixed seeded ties', () => {
  const input = toy(); input.dataset.remaining = [];
  input.dataset.completed = [{ date: '2024-01-04', home: 'A', away: 'B', hg: 0, ag: 0 }, { date: '2023-01-01', home: 'A', away: 'C', hg: 9, ag: 0 }];
  const expected = buildTable(input.dataset.teams, input.dataset.completed, input.dataset.seasonStart, mulberry32(input.seed));
  const result = simulate(input);
  expect(simulate({ ...input, simulations: 1 }).teams).toEqual(result.teams);
  for (const team of result.teams) {
    const rank = expected.findIndex(r => r.team === team.team);
    expect(team.positions[rank]).toBe(1);
    expect(team.expectedRank).toBe(rank + 1);
    expect(team.pointsRange).toEqual([expected[rank].points, expected[rank].points]);
  }
});

test('G6: position rows and columns sum to one and summaries agree', () => {
  const result = simulate(toy());
  for (const t of result.teams) {
    expect(t.positions.reduce((s, p) => s + p, 0)).toBeCloseTo(1, 14);
    expect(t.top.probability).toBe(t.positions[0] + t.positions[1]);
    expect(t.bottom.probability).toBe(t.positions[2]);
    expect(t.title.standardError).toBe(Math.sqrt(t.positions[0] * (1 - t.positions[0]) / result.simulations));
    expect(t.pointsRange[0]).toBeLessThanOrEqual(t.pointsRange[1]);
  }
  for (let rank = 0; rank < 3; rank++) expect(result.teams.reduce((sum, t) => sum + t.positions[rank], 0)).toBeCloseTo(1, 14);
});

test('G6: three-team simulation matches exact score enumeration with fair tie splitting', () => {
  const input = toy(), pmf = jointPmf(1.4, 1.1, -0.1, 2);
  const exact = input.dataset.teams.map(() => [0, 0, 0]);
  const expectedPoints = [0, 0, 0];
  // Independent standings arithmetic; do not call the production table builder.
  for (let s = 0; s < 9; s++) for (let t = 0; t < 9; t++) {
    const rows = input.dataset.teams.map(team => ({ team, points: 0, gf: 0, gd: 0 }));
    const matches = [...input.dataset.completed, ...input.dataset.remaining.map((f, i) => ({ ...f, hg: Math.floor((i ? t : s) / 3), ag: (i ? t : s) % 3 }))];
    for (const m of matches) {
      const h = rows.find(r => r.team === m.home)!, a = rows.find(r => r.team === m.away)!;
      h.points += m.hg > m.ag ? 3 : m.hg === m.ag ? 1 : 0;
      a.points += m.ag > m.hg ? 3 : m.hg === m.ag ? 1 : 0;
      h.gf += m.hg; a.gf += m.ag; h.gd += m.hg - m.ag; a.gd += m.ag - m.hg;
    }
    rows.sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf);
    const mass = pmf[s] * pmf[t];
    for (const row of rows) {
      const index = input.dataset.teams.indexOf(row.team);
      const tied = rows.map((r, rank) => ({ r, rank })).filter(({ r }) => r.points === row.points && r.gd === row.gd && r.gf === row.gf);
      for (const { rank } of tied) exact[index][rank] += mass / tied.length;
      expectedPoints[index] += mass * row.points;
    }
  }
  const result = simulate({ ...input, simulations: 100000 });
  let maxError = 0;
  result.teams.forEach((team, i) => {
    team.positions.forEach((p, rank) => {
      const truth = exact[i][rank];
      maxError = Math.max(maxError, Math.abs(p - truth));
      expect(Math.abs(p - truth)).toBeLessThan(6 * Math.sqrt(truth * (1 - truth) / 100000) + 0.0001);
    });
    expect(Math.abs(team.expectedPoints - expectedPoints[i])).toBeLessThan(0.03);
  });
  console.log('G6 exact enumeration maximum probability error:', maxError);
});

test('G6: sampled means match lambda and mu with negligible truncation', () => {
  const random = mulberry32(4321), lambda = 1.7, mu = 1.2, count = 200000;
  const cdf = jointCdf(lambda, mu, -0.1, 16);
  let home = 0, away = 0;
  for (let i = 0; i < count; i++) { const [h, a] = sampleScore(cdf, 16, random); home += h; away += a; }
  expect(Math.abs(home / count - lambda)).toBeLessThan(6 * Math.sqrt(lambda / count));
  expect(Math.abs(away / count - mu)).toBeLessThan(6 * Math.sqrt(mu / count));
});

test('G6: identical seeds reproduce exactly without mutating inputs; different seeds differ', () => {
  const input = toy(), copy = structuredClone(input), result = simulate(input);
  expect(simulate(input)).toEqual(result);
  expect(input).toEqual(copy);
  expect(simulate({ ...input, seed: 54321 })).not.toEqual(result);
});

test('locked results are fixed, can exceed the sampling grid, and affect standings exactly once', () => {
  const input = toy(); input.locks = { ac: { hg: 12, ag: 0 }, bc: { hg: 0, ag: 0 } };
  const result = simulate(input);
  expect(result.teams.map(t => t.expectedPoints)).toEqual([7, 5, 4]);
  expect(result.teams.map(t => t.expectedRank)).toEqual([1, 2, 3]);
  expect(result.teams.map(t => t.pointsRange)).toEqual([[7, 7], [5, 5], [4, 4]]);
});

test('progress starts at zero and completes monotonically', () => {
  const calls: number[] = [];
  simulate({ ...toy(), simulations: 501 }, (done, total) => { expect(total).toBe(501); calls.push(done); });
  expect(calls).toEqual([0, 250, 500, 501]);
});

test('reject invalid requests and stale fits before running', () => {
  const input = toy();
  for (const simulations of [0, 1.5, 100001]) expect(() => simulate({ ...input, simulations })).toThrow();
  expect(() => simulate({ ...input, seed: -1 })).toThrow();
  expect(() => simulate({ ...input, topK: 4 })).toThrow();
  expect(() => simulate({ ...input, fit: { ...input.fit, cutoff: '2024-01-04' } })).toThrow(/cutoff/);
  expect(() => simulate({ ...input, locks: { unknown: { hg: 0, ag: 0 } } })).toThrow();
  expect(() => simulate({ ...input, locks: { ac: { hg: -1, ag: 0 } } })).toThrow();
  expect(forecastCutoff({ ...input.dataset, completed: [{ date: '2024-12-31', home: 'A', away: 'B', hg: 0, ag: 0 }] })).toBe('2025-01-01');
});

test('forecast timing: 10000 simulations, 20 teams, 190 remaining fixtures', () => {
  const input = toy(), teams = Array.from({ length: 20 }, (_, i) => `Team ${i}`);
  input.maxGoals = 10;
  input.dataset.teams = teams;
  input.dataset.completed = [];
  input.dataset.remaining = [];
  for (let h = 0; h < 20; h++) for (let a = h + 1; a < 20; a++) {
    input.dataset.completed.push({ date: '2024-01-04', home: teams[h], away: teams[a], hg: 1, ag: 0 });
    input.dataset.remaining.push({ id: `${a}-${h}`, home: teams[a], away: teams[h] });
  }
  input.fit = { ...input.fit, teams, attack: Array(20).fill(0), defense: Array(20).fill(0) };
  const start = performance.now();
  expect(simulate(input).teams).toHaveLength(20);
  console.log('10000-run forecast elapsedMs:', performance.now() - start);
});


test('CDF sampling honors interval boundaries and uses one uniform even with truncation', () => {
  const cdf = jointCdf(1.4, 1.1, -0.1, 2), pmf = jointPmf(1.4, 1.1, -0.1, 2);
  expect(cdf[cdf.length - 1]).toBe(1);
  let calls = 0;
  for (let i = 0; i < pmf.length; i++) {
    const lower = i === 0 ? 0 : cdf[i - 1];
    expect(sampleScore(cdf, 2, () => { calls++; return lower + pmf[i] / 2; })).toEqual([Math.floor(i / 3), i % 3]);
    expect(sampleScore(cdf, 2, () => lower)).toEqual([Math.floor(i / 3), i % 3]);
  }
  expect(calls).toBe(9);
  expect(sampleScore(cdf, 2, () => 0)).toEqual([0, 0]);
  expect(sampleScore(cdf, 2, () => 1 - Number.EPSILON)).toEqual([2, 2]);
});
