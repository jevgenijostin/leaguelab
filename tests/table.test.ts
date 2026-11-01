import { expect, test } from 'vitest';
import { addScore, buildTable, emptyTable, rankTable } from '../src/core/table';
import { mulberry32 } from '../src/core/rng';

test('table uses current-season results and 3/1/0 points', () => {
  const rows = buildTable(['A', 'B', 'C'], [
    { date: '2023-01-01', home: 'A', away: 'B', hg: 99, ag: 0 },
    { date: '2024-01-01', home: 'A', away: 'B', hg: 2, ag: 0 },
    { date: '2024-01-02', home: 'B', away: 'C', hg: 1, ag: 1 },
  ], '2024-01-01', mulberry32(1));
  expect(rows).toEqual([
    { team: 'A', played: 1, points: 3, gf: 2, ga: 0, gd: 2 },
    { team: 'C', played: 1, points: 1, gf: 1, ga: 1, gd: 0 },
    { team: 'B', played: 2, points: 1, gf: 1, ga: 3, gd: -2 },
  ]);
});

test.each(['points', 'gd', 'gf'] as const)('tie-break prioritizes %s over later criteria', criterion => {
  const [a, b] = emptyTable(['A', 'B']);
  if (criterion === 'points') { a.points = 1; b.gd = 10; b.gf = 20; }
  if (criterion === 'gd') { a.gd = 1; b.gf = 20; }
  if (criterion === 'gf') a.gf = 1;
  const keys = [0.9, 0.1];
  expect(rankTable([a, b], () => keys.shift()!).map(r => r.team)).toEqual(['A', 'B']);
});

test('final tie-break draws one random key per team, reproducibly', () => {
  const rows = emptyTable(['A', 'B', 'C']);
  const keys = [0.8, 0.1, 0.5];
  expect(rankTable(rows, () => keys.shift()!).map(r => r.team)).toEqual(['B', 'C', 'A']);
  expect(keys).toHaveLength(0);
  expect(rankTable(rows, mulberry32(42))).toEqual(rankTable(rows, mulberry32(42)));
  expect(rows.map(r => r.team)).toEqual(['A', 'B', 'C']);
});

test('table rejects invalid teams and scores', () => {
  expect(() => emptyTable(['A', 'A'])).toThrow();
  const [a, b] = emptyTable(['A', 'B']);
  expect(() => addScore(a, b, -1, 0)).toThrow();
  expect(() => addScore(a, b, 0.5, 0)).toThrow();
  expect(() => addScore(a, a, 0, 0)).toThrow();
});
