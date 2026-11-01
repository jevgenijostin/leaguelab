import type { FitConfig } from '../core/types';

// Fixed before any evaluation-window results are viewed.
export const DEFAULT_FIT_CONFIG: Readonly<FitConfig> = Object.freeze({
  halfLifeDays: 300,
  ridge: 0.01,
  rhoCap: 0.2,
  maxGoals: 10,
  maxIter: 5000,
});
