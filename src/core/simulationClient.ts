import type { SimulationInput, SimulationResult } from './simulate';
import type { SimulationMessage } from '../workers/simulate.worker';

/** Termination cancels immediately, including during CDF preparation. One worker per run. */
export function startSimulation(input: SimulationInput, onProgress?: (completed: number, total: number) => void): {
  result: Promise<SimulationResult>; cancel: () => void;
} {
  const worker = new Worker(new URL('../workers/simulate.worker.ts', import.meta.url), { type: 'module' });
  let settled = false;
  let rejectRun: (reason: Error) => void;
  const finish = () => { settled = true; worker.terminate(); };
  const result = new Promise<SimulationResult>((resolve, reject) => {
    rejectRun = reject;
    worker.onmessage = (event: MessageEvent<SimulationMessage>) => {
      if (settled) return;
      const message = event.data;
      if (message.type === 'progress') onProgress?.(message.completed, message.total);
      else if (message.type === 'result') { finish(); resolve(message.result); }
      else { finish(); reject(new Error(message.message)); }
    };
    worker.onerror = (event) => { if (!settled) { finish(); reject(new Error(event.message)); } };
    worker.onmessageerror = () => { if (!settled) { finish(); reject(new Error('Unable to deserialize simulation response.')); } };
    try { worker.postMessage(input); } catch (error) { finish(); reject(error); }
  });
  return { result, cancel: () => {
    if (!settled) { finish(); rejectRun(new DOMException('Simulation cancelled.', 'AbortError')); }
  } };
}
