import { DEFAULT_FIT_CONFIG } from '../config/defaults';
import { tau } from './dixonColes';
import type { CompletedMatch, FitConfig, FitResult } from './types';

interface WeightedMatch { h: number; a: number; x: number; y: number; w: number }
export interface FitProblem {
  teams: string[];
  cutoff: string;
  config: FitConfig;
  matches: WeightedMatch[];
  effectiveN: number;
}
export interface Evaluation { objective: number; gradient: number[] }

function day(date: string): number {
  const time = Date.parse(date + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date) {
    throw new RangeError('Expected a valid ISO calendar date.');
  }
  return time / 86400000;
}

export function center(raw: readonly number[]): number[] {
  const mean = raw.reduce((sum, x) => sum + x, 0) / raw.length;
  return raw.map(x => x - mean);
}

export function prepareFit(teams: readonly string[], completed: readonly CompletedMatch[], cutoff: string,
  config: FitConfig = DEFAULT_FIT_CONFIG): FitProblem {
  if (!(config.halfLifeDays > 0) || !Number.isFinite(config.ridge) || config.ridge < 0 ||
      !Number.isFinite(config.rhoCap) || config.rhoCap <= 0 || config.rhoCap >= 1 ||
      !Number.isInteger(config.maxIter) || config.maxIter < 0 || !Number.isInteger(config.maxGoals) || config.maxGoals < 1) {
    throw new RangeError('Invalid fit configuration.');
  }
  const sorted = [...teams].sort();
  if (sorted.length < 2 || new Set(sorted).size !== sorted.length || sorted.some(t => !t || t.trim() !== t)) {
    throw new RangeError('Provide at least two unique normalized teams.');
  }
  const cutoffDay = day(cutoff);
  // Canonical ordering makes team and match input permutations exactly reproducible.
  // Exclude future results before inspecting scores or calculating initialization.
  const training = completed.filter(m => day(m.date) < cutoffDay).sort((a, b) =>
    a.date.localeCompare(b.date) || a.home.localeCompare(b.home) || a.away.localeCompare(b.away) || a.hg - b.hg || a.ag - b.ag);
  const matches = training.map(m => {
    const h = sorted.indexOf(m.home), a = sorted.indexOf(m.away);
    if (h < 0 || a < 0 || h === a || !Number.isInteger(m.hg) || m.hg < 0 || !Number.isInteger(m.ag) || m.ag < 0) {
      throw new RangeError('Invalid training match.');
    }
    return { h, a, x: m.hg, y: m.ag, w: Math.exp(-Math.LN2 * (cutoffDay - day(m.date)) / config.halfLifeDays) };
  });
  const effectiveN = matches.reduce((sum, m) => sum + m.w, 0);
  if (!(effectiveN > 0)) throw new RangeError('No effective training observations before cutoff.');
  return { teams: sorted, cutoff, config: { ...config }, matches, effectiveN };
}

/** Weighted negative log likelihood, omitting constant log-factorials, plus centered ridge. */
export function evaluate(problem: FitProblem, theta: readonly number[]): Evaluation {
  const n = problem.teams.length;
  if (theta.length !== 3 + 2 * n) throw new RangeError('Wrong parameter vector length.');
  const gradient = Array(theta.length).fill(0) as number[];
  const invalid = () => ({ objective: Infinity, gradient: gradient.map(() => NaN) });
  if (!theta.every(Number.isFinite)) return invalid();
  const attack = center(theta.slice(3, 3 + n)), defense = center(theta.slice(3 + n));
  const t = Math.tanh(theta[2]), rho = problem.config.rhoCap * t;
  const dr = problem.config.rhoCap * (1 - t * t);
  let objective = 0;
  for (const m of problem.matches) {
    const u = theta[0] + theta[1] + attack[m.h] - defense[m.a];
    const v = theta[0] + attack[m.a] - defense[m.h];
    const lambda = Math.exp(u), mu = Math.exp(v), correction = tau(m.x, m.y, lambda, mu, rho);
    if (!Number.isFinite(lambda + mu + correction) || correction <= 1e-6) return invalid();
    let gu = m.x - lambda, gv = m.y - mu, gr = 0;
    if (m.x === 0 && m.y === 0) {
      gu -= lambda * mu * rho / correction;
      gv -= lambda * mu * rho / correction;
      gr = -lambda * mu / correction;
    } else if (m.x === 0 && m.y === 1) {
      gu += lambda * rho / correction;
      gr = lambda / correction;
    } else if (m.x === 1 && m.y === 0) {
      gv += mu * rho / correction;
      gr = mu / correction;
    } else if (m.x === 1 && m.y === 1) gr = -1 / correction;
    const scale = -m.w / problem.effectiveN;
    objective += scale * (Math.log(correction) + m.x * u - lambda + m.y * v - mu);
    gradient[0] += scale * (gu + gv);
    gradient[1] += scale * gu;
    gradient[2] += scale * gr * dr;
    gradient[3 + m.h] += scale * gu;
    gradient[3 + m.a] += scale * gv;
    gradient[3 + n + m.a] -= scale * gu;
    gradient[3 + n + m.h] -= scale * gv;
  }
  for (let i = 0; i < n; i++) {
    objective += problem.config.ridge * (attack[i] ** 2 + defense[i] ** 2);
    gradient[3 + i] += 2 * problem.config.ridge * attack[i];
    gradient[3 + n + i] += 2 * problem.config.ridge * defense[i];
  }
  gradient.splice(3, n, ...center(gradient.slice(3, 3 + n)));
  gradient.splice(3 + n, n, ...center(gradient.slice(3 + n)));
  return { objective, gradient };
}

/** Warm starts are mapped by team name, never by the caller's array order. */
export function initialParameters(problem: FitProblem, warmStart?: FitResult): number[] {
  const n = problem.teams.length;
  if (warmStart) {
    if (warmStart.teams.length !== n || problem.teams.some(t => !warmStart.teams.includes(t)) ||
        Math.abs(warmStart.rho) >= problem.config.rhoCap) throw new RangeError('Incompatible warm start.');
    return [warmStart.baseLog, warmStart.homeAdv, Math.atanh(warmStart.rho / problem.config.rhoCap),
      ...problem.teams.map(t => warmStart.attack[warmStart.teams.indexOf(t)]),
      ...problem.teams.map(t => warmStart.defense[warmStart.teams.indexOf(t)])];
  }
  const mean = problem.matches.reduce((sum, m) => sum + m.w * (m.x + m.y), 0) / (2 * problem.effectiveN);
  // An all-zero sample has log(mean) = -Infinity and no finite intercept optimum.
  if (!(mean > 0)) throw new RangeError('All training goals are zero; no finite intercept initialization.');
  return [Math.log(mean), ...Array(2 + 2 * n).fill(0)];
}

export function fit(teams: readonly string[], matches: readonly CompletedMatch[], cutoff: string,
  config: FitConfig = DEFAULT_FIT_CONFIG, warmStart?: FitResult): FitResult {
  const problem = prepareFit(teams, matches, cutoff, config);
  let theta = initialParameters(problem, warmStart), current = evaluate(problem, theta);
  let iterations = 0, step = 1, smallDecreases = 0, converged = false, reason = 'maximum iterations';
  const norm = () => Math.max(...current.gradient.map(Math.abs));
  if (!Number.isFinite(current.objective)) throw new RangeError('Invalid initial parameters.');
  while (true) {
    if (norm() < 1e-7) { converged = true; reason = 'gradient tolerance'; break; }
    if (iterations >= config.maxIter) break;
    const squaredNorm = current.gradient.reduce((sum, g) => sum + g * g, 0);
    let candidate: number[] = [], next = current, accepted = false;
    for (let backtrack = 0; backtrack < 100; backtrack++) {
      candidate = theta.map((p, i) => p - step * current.gradient[i]);
      next = evaluate(problem, candidate);
      if (Number.isFinite(next.objective) && next.objective <= current.objective - 1e-4 * step * squaredNorm) {
        accepted = true; break;
      }
      step *= 0.5;
    }
    if (!accepted) { reason = 'line search failed'; break; }
    const relativeDecrease = (current.objective - next.objective) / Math.max(1, Math.abs(current.objective));
    smallDecreases = relativeDecrease < 1e-12 ? smallDecreases + 1 : 0;
    theta = candidate; current = next; iterations++; step *= 2;
    if (smallDecreases >= 5) { converged = true; reason = 'relative objective tolerance'; break; }
  }
  const n = problem.teams.length;
  return {
    teams: problem.teams, attack: center(theta.slice(3, 3 + n)), defense: center(theta.slice(3 + n)),
    baseLog: theta[0], homeAdv: theta[1], rho: config.rhoCap * Math.tanh(theta[2]),
    cutoff, nTrain: problem.matches.length, effectiveN: problem.effectiveN,
    diag: { iterations, objective: current.objective, gradInfNorm: norm(), converged, reason },
  };
}
