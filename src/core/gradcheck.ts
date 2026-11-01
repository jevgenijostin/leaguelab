import type { Evaluation } from './fitter';

export interface GradientCheck {
  analytic: number[];
  numerical: number[];
  relativeErrors: number[];
  maxRelativeError: number;
  passed: boolean;
}

/** Pure central-difference check of every coordinate; does not mutate theta. */
export function gradientCheck(evaluate: (theta: readonly number[]) => Evaluation,
  theta: readonly number[], h = 1e-6, tolerance = 1e-5): GradientCheck {
  if (!(h > 0) || !Number.isFinite(h) || !(tolerance > 0)) throw new RangeError('Invalid check settings.');
  const analytic = evaluate(theta).gradient;
  const numerical = theta.map((_, k) => {
    const plus = [...theta], minus = [...theta];
    plus[k] += h; minus[k] -= h;
    return (evaluate(plus).objective - evaluate(minus).objective) / (2 * h);
  });
  const relativeErrors = numerical.map((n, k) => {
    const a = analytic[k];
    return Number.isFinite(a) && Number.isFinite(n) ? Math.abs(a - n) / Math.max(1, Math.abs(a), Math.abs(n)) : Infinity;
  });
  const maxRelativeError = Math.max(...relativeErrors);
  return { analytic, numerical, relativeErrors, maxRelativeError, passed: maxRelativeError < tolerance };
}
