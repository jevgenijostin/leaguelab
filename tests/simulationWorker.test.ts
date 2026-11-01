import { afterEach, expect, test, vi } from 'vitest';
import { Worker as NodeWorker } from 'node:worker_threads';
import { resolve } from 'node:path';
import { build } from 'vite';
import { simulate } from '../src/core/simulate';
import { startSimulation } from '../src/core/simulationClient';
import type { SimulationMessage } from '../src/workers/simulate.worker';
import { toy } from './simulationFixture';

class FakeWorker {
  static latest: FakeWorker;
  onmessage?: (event: { data: SimulationMessage }) => void;
  onerror?: (event: { message: string }) => void;
  onmessageerror?: () => void;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor(public url: URL, public options: WorkerOptions) { FakeWorker.latest = this; }
}
afterEach(() => vi.unstubAllGlobals());

test('worker client forwards input/progress/result and terminates on completion', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  const progress = vi.fn(), input = toy(), run = startSimulation(input, progress), worker = FakeWorker.latest;
  expect(worker.url.pathname).toContain('simulate.worker.ts');
  expect(worker.options.type).toBe('module');
  expect(worker.postMessage).toHaveBeenCalledWith(input);
  worker.onmessage!({ data: { type: 'progress', completed: 250, total: 10000 } });
  expect(progress).toHaveBeenCalledWith(250, 10000);
  const expected = simulate(input);
  worker.onmessage!({ data: { type: 'result', result: expected } });
  expect(await run.result).toEqual(expected);
  run.cancel();
  expect(worker.terminate).toHaveBeenCalledTimes(1);
});

test('cancellation rejects with AbortError, terminates immediately, and ignores late messages', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  const progress = vi.fn(), run = startSimulation(toy(), progress), worker = FakeWorker.latest;
  run.cancel(); run.cancel();
  await expect(run.result).rejects.toMatchObject({ name: 'AbortError' });
  worker.onmessage!({ data: { type: 'progress', completed: 250, total: 10000 } });
  expect(progress).not.toHaveBeenCalled();
  expect(worker.terminate).toHaveBeenCalledTimes(1);
});

test.each(['model', 'runtime', 'message'] as const)('worker client surfaces %s errors and cleans up', async kind => {
  vi.stubGlobal('Worker', FakeWorker);
  const run = startSimulation(toy()), worker = FakeWorker.latest;
  if (kind === 'model') worker.onmessage!({ data: { type: 'error', message: 'Invalid model' } });
  if (kind === 'runtime') worker.onerror!({ message: 'Worker failed' });
  if (kind === 'message') worker.onmessageerror!();
  await expect(run.result).rejects.toThrow();
  expect(worker.terminate).toHaveBeenCalledTimes(1);
});

test('bundled worker executes engine off-thread and reports progress, result, and model errors', async () => {
  const bundle = await build({ configFile: false, logLevel: 'silent', build: {
    write: false, lib: { entry: resolve('src/workers/simulate.worker.ts'), name: 'SimulationWorker', formats: ['iife'] },
  } });
  const output = (Array.isArray(bundle) ? bundle[0] : bundle) as { output: { type: string; code?: string }[] };
  const code = output.output.find(chunk => chunk.type === 'chunk')!.code!;
  // Adapt only the browser transport; the actual bundled worker and engine run unchanged.
  const worker = new NodeWorker(`const { parentPort } = require('node:worker_threads');
    globalThis.self = { postMessage: message => parentPort.postMessage(message) };
    ${code}
    parentPort.on('message', data => self.onmessage({ data }));`, { eval: true });
  const input = { ...toy(), simulations: 501 };
  const messages: SimulationMessage[] = [];
  try {
    const result = new Promise<SimulationMessage>((resolve, reject) => {
      worker.on('error', reject);
      worker.on('message', (message: SimulationMessage) => { messages.push(message); if (message.type === 'result') resolve(message); });
    });
    worker.postMessage(input);
    expect(await result).toEqual({ type: 'result', result: simulate(input) });
    expect(messages.filter(m => m.type === 'progress').map(m => m.completed)).toEqual([0, 250, 500, 501]);
    const failure = new Promise<SimulationMessage>(resolve => worker.once('message', resolve));
    worker.postMessage({ ...input, simulations: 0 });
    expect(await failure).toMatchObject({ type: 'error', message: expect.stringContaining('Simulation count') });
  } finally { await worker.terminate(); }
});
