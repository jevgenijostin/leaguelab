export type TeamId = string;

export interface CompletedMatch {
  date: string; // ISO yyyy-mm-dd
  home: TeamId;
  away: TeamId;
  hg: number;
  ag: number;
}

export interface RemainingFixture {
  id: string;
  home: TeamId;
  away: TeamId;
  date?: string;
}

export interface Dataset {
  teams: TeamId[]; // sorted, trimmed names
  completed: CompletedMatch[]; // all history, stably sorted by date
  remaining: RemainingFixture[];
  seasonStart: string;
}

export interface FitConfig {
  halfLifeDays: number;
  ridge: number;
  rhoCap: number;
  maxGoals: number;
  maxIter: number;
}

export interface FitResult {
  teams: TeamId[];
  attack: number[];
  defense: number[];
  baseLog: number;
  homeAdv: number;
  rho: number;
  cutoff: string; // training uses date < cutoff
  nTrain: number;
  effectiveN: number;
  diag: {
    iterations: number;
    objective: number;
    gradInfNorm: number;
    converged: boolean;
    reason: string;
  };
}
