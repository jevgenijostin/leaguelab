import { simulate, type SimulationInput, type SimulationResult } from '../core/simulate';

export type SimulationMessage =
  | { type: 'progress'; completed: number; total: number }
  | { type: 'result'; result: SimulationResult }
  | { type: 'error'; message: string };

self.onmessage = (event: MessageEvent<SimulationInput>) => {
  const send = (message: SimulationMessage) => self.postMessage(message);
  try {
    const result = simulate(event.data, (completed, total) => send({ type: 'progress', completed, total }));
    send({ type: 'result', result });
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
