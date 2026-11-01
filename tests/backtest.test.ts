import { describe, expect, it } from 'vitest';
import { backtest, chronologicalBlocks, evaluateBlock, halfLifeSensitivity } from '../src/core/backtest';
import { syntheticLeague } from '../src/core/synth';
import { mulberry32 } from '../src/core/rng';
import { fit } from '../src/core/fitter';
import { DEFAULT_FIT_CONFIG } from '../src/config/defaults';
import type { CompletedMatch } from '../src/core/types';

describe('synthetic worlds and chronological protocol', () => {
  it('generates reproducible three-season double round robins with declared truth', () => {
    for (const world of ['null', 'signal'] as const) {
      const data = syntheticLeague(world);
      expect(data).toEqual(syntheticLeague(world));
      expect(data.completed).toHaveLength(1140);
      for (let season = 0; season < 3; season++) {
        const matches = data.completed.slice(season * 380, (season + 1) * 380);
        expect(new Set(matches.map(m => `${m.home}/${m.away}`)).size).toBe(380);
        const dates = [...new Set(matches.map(m => m.date))];
        expect(dates).toHaveLength(38);
        for (const date of dates) expect(new Set(matches.filter(m => m.date === date).flatMap(m => [m.home, m.away])).size).toBe(20);
      }
      expect(data.truth.homeAdv).toBeGreaterThan(0);
      if (world === 'null') expect([...data.truth.attack, ...data.truth.defense].every(x => x === 0)).toBe(true);
    }
  });
  it('requires 100 strictly earlier matches and keeps whole dates in anchored seven-day windows', () => {
    const match = (date: string): CompletedMatch => ({ date, home: 'A', away: 'B', hg: 1, ag: 0 });
    const history = Array.from({ length: 99 }, () => match('2024-01-01'));
    const matches = [...history, match('2024-01-02'), match('2024-01-02'),
      ...['2024-01-03', '2024-01-09', '2024-01-10', '2024-01-30'].map(match)];
    const blocks = chronologicalBlocks(matches.reverse());
    expect(blocks.map(b => b.cutoff)).toEqual(['2024-01-03', '2024-01-10', '2024-01-30']);
    expect(blocks.map(b => b.matches.length)).toEqual([2, 1, 1]);
    expect(chronologicalBlocks(history)).toEqual([]);
  });
  it('uses identical decay and +1 smoothing for the training-only baseline', () => {
    const data = syntheticLeague('null'), block = chronologicalBlocks(data.completed)[0];
    const result = evaluateBlock(data.teams, data.completed, block);
    const counts = [1, 1, 1];
    for (const m of data.completed.filter(m => m.date < block.cutoff)) {
      const age = (Date.parse(block.cutoff) - Date.parse(m.date)) / 86400000;
      counts[m.hg > m.ag ? 0 : m.hg === m.ag ? 1 : 2] += 2 ** (-age / 300);
    }
    counts.forEach((v, i) => expect(result.baseline[i]).toBeCloseTo(v / counts.reduce((s, x) => s + x, 0), 14));
    expect(result.fit.nTrain).toBe(100);
  });
  it('warm-starts each block from the previous solution and preserves every cutoff and prediction', () => {
    const data = syntheticLeague('signal'), matches = data.completed.slice(0, 130);
    const result = backtest(data.teams, matches);
    const blocks = chronologicalBlocks(matches);
    expect(result.blocks).toHaveLength(3);
    const second = fit(data.teams, matches, blocks[1].cutoff, DEFAULT_FIT_CONFIG, result.blocks[0].fit);
    expect(result.blocks[1].fit).toEqual(second);
    expect(result.nTest).toBe(30);
    expect(result.smallSample).toBe(true);
    expect(result.predictions.every(p => p.date >= p.cutoff)).toBe(true);
    expect(result).toEqual(backtest(data.teams, [...matches].reverse()));
    expect(backtest(data.teams, matches.slice(0, 100))).toMatchObject({ metrics: null, nTest: 0, smallSample: true, verdict: 'Inconclusive on this sample.' });
  });
  it('reports all four half-lives without changing primary defaults or choosing a winner', () => {
    const data = syntheticLeague('signal'), matches = data.completed.slice(0, 110);
    const results = halfLifeSensitivity(data.teams, matches);
    expect(results.map(r => r.halfLifeDays)).toEqual([120, 300, 600, Infinity]);
    expect(results[1].result).toEqual(backtest(data.teams, matches));
    expect(DEFAULT_FIT_CONFIG.halfLifeDays).toBe(300);
  });
  it('exposes non-convergence without hiding predictions or changing diagnostics', () => {
    const data = syntheticLeague('signal'), block = chronologicalBlocks(data.completed)[0];
    const result = evaluateBlock(data.teams, data.completed, block, undefined, { ...DEFAULT_FIT_CONFIG, maxIter: 1 });
    expect(result.warning).toBe('not converged');
    expect(result.fit.diag).toMatchObject({ converged: false, iterations: 1, reason: 'maximum iterations' });
    expect(result.predictions).toHaveLength(block.matches.length);
  });
});

describe('hard acceptance gates', () => {
  it('G2: randomizing every score on or after cutoff leaves warm-started fits and predictions bit-identical', () => {
    const data = syntheticLeague('signal'), blocks = chronologicalBlocks(data.completed);
    const target = 12, cutoff = blocks[target].cutoff, rng = mulberry32(813);
    const perturbed = data.completed.map(m => m.date < cutoff ? { ...m } : { ...m, hg: Math.floor(rng() * 9), ag: Math.floor(rng() * 9) });
    const alteredBlocks = chronologicalBlocks(perturbed);
    let original, altered;
    for (let i = 0; i <= target; i++) {
      original = evaluateBlock(data.teams, data.completed, blocks[i], original?.fit);
      altered = evaluateBlock(data.teams, perturbed, alteredBlocks[i], altered?.fit);
      expect(altered).toEqual(original);
    }
    const a = original!, b = altered!;
    const numbersA = [...a.fit.attack, ...a.fit.defense, a.fit.baseLog, a.fit.homeAdv, a.fit.rho, ...a.predictions.flatMap(p => p.probabilities)];
    const numbersB = [...b.fit.attack, ...b.fit.defense, b.fit.baseLog, b.fit.homeAdv, b.fit.rho, ...b.predictions.flatMap(p => p.probabilities)];
    expect(Buffer.from(new Float64Array(numbersA).buffer)).toEqual(Buffer.from(new Float64Array(numbersB).buffer));
    const changed = perturbed.filter((m, i) => m.hg !== data.completed[i].hg || m.ag !== data.completed[i].ag).length;
    expect(changed).toBeGreaterThan(0);
    console.log('G2', JSON.stringify({ cutoff, training: a.fit.nTrain, randomized: perturbed.filter(m => m.date >= cutoff).length, changed, predictions: a.predictions.length, maxAbsoluteDifference: Math.max(...numbersA.map((v, i) => Math.abs(v - numbersB[i]))), identicalBytes: numbersA.length * 8 }));
  });
  for (const world of ['null', 'signal'] as const) it(world === 'null' ? 'G3: equal-team null canary cannot claim improvement' : 'G4: realistic signal beats baseline with positive CI and ECE < 0.05', () => {
    const data = syntheticLeague(world), start = performance.now();
    const result = backtest(data.teams, data.completed), durationMs = performance.now() - start;
    const rps = result.metrics!.rps;
    console.log(world === 'null' ? 'G3' : 'G4', JSON.stringify({ ...rps, ece: result.calibration.ece, verdict: result.verdict, nTest: result.nTest, blocks: result.blocks.length, nonConverged: result.nonConvergedCutoffs, durationMs }));
    expect(result.nTest).toBe(1040);
    for (const block of result.blocks) {
      expect(typeof block.fit.diag.converged).toBe('boolean');
      expect(block.warning).toBe(block.fit.diag.converged ? null : 'not converged');
      expect(result.nonConvergedCutoffs.includes(block.cutoff)).toBe(!block.fit.diag.converged);
    }
    expect(result.smallSample).toBe(false);
    if (world === 'null') {
      expect(rps.gain).toBeLessThanOrEqual(0.001);
      expect(['Inconclusive on this sample.', 'Baseline better']).toContain(result.verdict);
    } else {
      expect(result.verdict).toBe('Model better than baseline');
      expect(rps.ci[0]).toBeGreaterThan(0);
      expect(result.calibration.ece).toBeLessThan(0.05);
    }
  }, 30000);
});
