import { backtest, halfLifeSensitivity } from '../core/backtest';
import { fit, prepareFit, evaluate, initialParameters } from '../core/fitter';
import { gradientCheck } from '../core/gradcheck';
import { forecastCutoff } from '../core/simulate';
import type { Dataset, FitConfig } from '../core/types';
export type AnalysisRequest = { task: 'fit' | 'evidence' | 'gradient'; dataset: Dataset; config: FitConfig };
self.onmessage = ({ data }: MessageEvent<AnalysisRequest>) => {
  try {
    const { dataset: d, config, task } = data;
    if (task === 'evidence') {
      self.postMessage({ stage: 'primary', result: backtest(d.teams, d.completed) });
      self.postMessage({ stage: 'sensitivity', result: halfLifeSensitivity(d.teams, d.completed) });
    } else if (task === 'fit') self.postMessage({ stage: task, result: fit(d.teams, d.completed, forecastCutoff(d), config) });
    else {
      const problem = prepareFit(d.teams, d.completed, forecastCutoff(d), config);
      self.postMessage({ stage: task, result: gradientCheck(t => evaluate(problem, t), initialParameters(problem)) });
    }
  } catch (e) { self.postMessage({ stage: 'error', error: (e as Error).message }); }
};
