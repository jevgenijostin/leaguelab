import type { SimulationInput } from '../src/core/simulate';

export function toy(): SimulationInput {
  return {
    seed: 12345, simulations: 10000, maxGoals: 2, topK: 2, bottomK: 1,
    dataset: { teams: ['A', 'B', 'C'], seasonStart: '2024-01-01', completed: [
      { date: '2024-01-01', home: 'A', away: 'B', hg: 1, ag: 0 },
      { date: '2024-01-02', home: 'B', away: 'A', hg: 0, ag: 0 },
      { date: '2024-01-03', home: 'C', away: 'A', hg: 2, ag: 0 },
      { date: '2024-01-04', home: 'C', away: 'B', hg: 0, ag: 1 },
    ], remaining: [{ id: 'ac', home: 'A', away: 'C' }, { id: 'bc', home: 'B', away: 'C' }] },
    fit: { teams: ['A', 'B', 'C'], attack: [0, 0, 0], defense: [0, 0, 0], baseLog: Math.log(1.1), homeAdv: Math.log(1.4 / 1.1), rho: -0.1,
      cutoff: '2024-01-05', nTrain: 4, effectiveN: 4, diag: { iterations: 1, objective: 1, gradInfNorm: 0, converged: true, reason: 'test' } },
  };
}


