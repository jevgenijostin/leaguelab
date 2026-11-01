import { describe, expect, it } from 'vitest';
import { brier, calibration, logLoss, pairedBootstrap, rps, verdict, wilson } from '../src/core/metrics';

describe('outcome metrics', () => {
  it('matches hand-computed ordered RPS, multiclass log loss, and unscaled Brier', () => {
    expect(rps([0.5, 0.3, 0.2], 1)).toBeCloseTo(0.145, 14);
    expect(logLoss([0.5, 0.3, 0.2], 1)).toBeCloseTo(-Math.log(0.3), 14);
    expect(brier([0.5, 0.3, 0.2], 1)).toBeCloseTo(0.78, 14);
    expect(rps([1, 0, 0], 0)).toBe(0);
    expect(rps([1, 0, 0], 2)).toBe(1);
    expect(brier([1, 0, 0], 2)).toBe(2);
    expect(logLoss([1, 0, 0], 2)).toBe(-Math.log(1e-12));
  });
  it('matches reference Wilson intervals including empty and boundary bins', () => {
    expect(wilson(5, 10)![0]).toBeCloseTo(0.2365930905, 9);
    expect(wilson(5, 10)![1]).toBeCloseTo(0.7634069095, 9);
    expect(wilson(0, 20)![1]).toBeCloseTo(0.1611251581, 9);
    expect(wilson(20, 20)![0]).toBeCloseTo(0.8388748419, 9);
    expect(wilson(0, 0)).toBeNull();
    expect(() => wilson(2, 1)).toThrow();
  });
  it('resamples paired differences reproducibly and handles constant differences exactly', () => {
    expect(pairedBootstrap([0, 1, 2], [1, 2, 3], 42)).toEqual({ model: 1, baseline: 2, gain: 1, ci: [1, 1] });
    const result = pairedBootstrap([0.1, 0.9, 0.2], [0.2, 0.1, 0.3], 73);
    expect(result).toEqual(pairedBootstrap([0.1, 0.9, 0.2], [0.2, 0.1, 0.3], 73));
    expect(result.ci[0]).toBeLessThan(result.gain);
    expect(result.ci[1]).toBeGreaterThan(result.gain);
    expect(() => pairedBootstrap([], [], 1)).toThrow();
  });
  it('uses strict CI bounds for every verdict, including zero endpoints', () => {
    expect(verdict([0.001, 0.01])).toBe('Model better than baseline');
    expect(verdict([-0.01, -0.001])).toBe('Baseline better');
    for (const ci of [[0, 1], [-1, 0], [-1, 1]] as [number, number][]) expect(verdict(ci)).toBe('Inconclusive on this sample.');
  });
  it('pools classes, places probability one in the last bin, and greys counts strictly below 20', () => {
    const result = calibration(Array.from({ length: 20 }, () => ({ probabilities: [1, 0, 0] as const, observed: 0 as const })));
    expect(result.bins.reduce((s, b) => s + b.n, 0)).toBe(60);
    expect(result.bins[9]).toMatchObject({ n: 20, meanPredicted: 1, observedFrequency: 1, greyed: false });
    expect(result.bins[0]).toMatchObject({ n: 40, meanPredicted: 0, observedFrequency: 0, greyed: false });
    expect(result.bins[1]).toMatchObject({ n: 0, interval: null, greyed: true, label: 'too few to read' });
    expect(result.ece).toBe(0);
    const sparse = calibration([{ probabilities: [0.5, 0.3, 0.2], observed: 1 }]);
    expect(sparse.ece).toBeCloseTo(1.4 / 3);
    expect(sparse.bins.every(b => b.greyed)).toBe(true);
    expect(calibration([]).ece).toBeNull();
  });
});
