import { DEFAULT_FIT_CONFIG } from '../config/defaults';
import { jointPmf, scoringRates } from './dixonColes';
import { fit, prepareFit } from './fitter';
import { brier, calibration, logLoss, outcome, pairedBootstrap, rps, verdict } from './metrics';
import type { Probabilities } from './metrics';
import type { CompletedMatch, FitConfig, FitResult } from './types';

const day = (date: string) => Date.parse(date + 'T00:00:00Z') / 86400000;
export interface BacktestBlock { cutoff: string; matches: CompletedMatch[] }
/** Seven-day windows anchored at the first eligible date; empty windows are omitted.
 * Each actual block trains at its first observed date, including after schedule gaps. */
export function chronologicalBlocks(completed: readonly CompletedMatch[]): BacktestBlock[] {
  const sorted = [...completed].sort((a, b) => a.date.localeCompare(b.date) || a.home.localeCompare(b.home) || a.away.localeCompare(b.away));
  const first = sorted.find(m => sorted.filter(previous => previous.date < m.date).length >= 100);
  if (!first) return [];
  const blocks: BacktestBlock[] = [];
  let previousKey = -1;
  for (const match of sorted) {
    if (match.date < first.date) continue;
    const key = Math.floor((day(match.date) - day(first.date)) / 7);
    if (key !== previousKey) { blocks.push({ cutoff: match.date, matches: [] }); previousKey = key; }
    blocks[blocks.length - 1].matches.push(match);
  }
  return blocks;
}
export function predictOutcome(fitted: FitResult, home: string, away: string, maxGoals = DEFAULT_FIT_CONFIG.maxGoals): Probabilities {
  const { lambda, mu } = scoringRates(fitted, home, away);
  const p: [number, number, number] = [0, 0, 0];
  jointPmf(lambda, mu, fitted.rho, maxGoals).forEach((mass, i) => {
    p[outcome(Math.floor(i / (maxGoals + 1)), i % (maxGoals + 1))] += mass;
  });
  return p;
}
/** Training and baseline share the canonical strict-cutoff sample and decay weights. */
export function evaluateBlock(teams: readonly string[], completed: readonly CompletedMatch[], block: BacktestBlock,
  warmStart?: FitResult, config: FitConfig = DEFAULT_FIT_CONFIG) {
  if (warmStart && warmStart.cutoff >= block.cutoff) throw new RangeError('Warm start must precede this block.');
  const problem = prepareFit(teams, completed, block.cutoff, config);
  const frequencies: [number, number, number] = [1, 1, 1];
  for (const m of problem.matches) frequencies[outcome(m.x, m.y)] += m.w;
  const baseline = frequencies.map(x => x / (problem.effectiveN + 3)) as [number, number, number];
  const fitted = fit(teams, completed, block.cutoff, config, warmStart);
  return { cutoff: block.cutoff, fit: fitted, baseline, warning: fitted.diag.converged ? null : 'not converged',
    predictions: block.matches.map(m => ({ date: m.date, home: m.home, away: m.away,
      probabilities: predictOutcome(fitted, m.home, m.away, config.maxGoals) })) };
}
function run(teams: readonly string[], completed: readonly CompletedMatch[], seed: number, config: FitConfig) {
  const blocks = chronologicalBlocks(completed);
  let warmStart: FitResult | undefined;
  const evaluated = blocks.map(block => {
    const result = evaluateBlock(teams, completed, block, warmStart, config);
    warmStart = result.fit;
    return { ...result, predictions: result.predictions.map((p, i) => ({ ...p,
      observed: outcome(block.matches[i].hg, block.matches[i].ag), cutoff: block.cutoff, baseline: result.baseline })) };
  });
  const predictions = evaluated.flatMap(b => b.predictions);
  const compare = (loss: typeof rps) => pairedBootstrap(predictions.map(p => loss(p.probabilities, p.observed)),
    predictions.map(p => loss(p.baseline, p.observed)), seed);
  const metrics = predictions.length ? { rps: compare(rps), logLoss: compare(logLoss), brier: compare(brier) } : null;
  return { blocks: evaluated, predictions, metrics, calibration: calibration(predictions),
    verdict: metrics ? verdict(metrics.rps.ci) : 'Inconclusive on this sample.' as const,
    nTest: predictions.length, smallSample: predictions.length < 200,
    nonConvergedCutoffs: evaluated.filter(b => !b.fit.diag.converged).map(b => b.cutoff),
    bootstrap: { seed, resamples: 2000, caption: 'Approximate paired bootstrap 95% intervals; matches are not independent.' },
    config: { ...config } };
}
/** Primary verdict always uses frozen defaults; sensitivity results cannot select it. */
export function backtest(teams: readonly string[], completed: readonly CompletedMatch[], seed = 20261101) {
  return run(teams, completed, seed, DEFAULT_FIT_CONFIG);
}
export function halfLifeSensitivity(teams: readonly string[], completed: readonly CompletedMatch[], seed = 20261101) {
  return [120, 300, 600, Infinity].map(halfLifeDays => ({ halfLifeDays,
    label: halfLifeDays === Infinity ? 'no decay' : `${halfLifeDays} days`,
    result: run(teams, completed, seed, { ...DEFAULT_FIT_CONFIG, halfLifeDays }) }));
}
