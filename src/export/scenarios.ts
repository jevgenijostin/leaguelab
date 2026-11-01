import type { SimulationResult, SimulationInput } from '../core/simulate';
import { can, limit } from '../license/entitlements';
export interface Snapshot { id: string; name: string; savedAt: string; forecast: SimulationResult; input: SimulationInput; converged: boolean }
const KEY = 'leaguelab:scenarios:v1';
export function loadScenarios(): Snapshot[] {
  const raw = localStorage.getItem(KEY); if (!raw) return [];
  const items = JSON.parse(raw) as Snapshot[];
  if (!Array.isArray(items) || items.length > 20 || items.some(s => !s || typeof s.id !== 'string' || typeof s.name !== 'string' || !s.input?.dataset || !Array.isArray(s.forecast?.teams) || s.forecast.teams.some(t => typeof t.team !== 'string' || !Number.isFinite(t.expectedPoints) || !Number.isFinite(t.expectedRank) || !Number.isFinite(t.title?.probability)))) throw new Error('Saved scenarios are damaged. Clear saved scenarios to reset.');
  return items;
}
export function saveScenario(snapshot: Snapshot): Snapshot[] {
  if (!can('scenarios')) throw new Error('Pro required.');
  const items = loadScenarios();
  if (items.length >= limit('scenarios')) throw new Error('Scenario limit reached. Delete a saved scenario first.');
  const next = [...items, snapshot]; localStorage.setItem(KEY, JSON.stringify(next)); return next;
}
export function deleteScenario(id: string): Snapshot[] {
  const next = loadScenarios().filter(s => s.id !== id); localStorage.setItem(KEY, JSON.stringify(next)); return next;
}
export function clearScenarios() { localStorage.removeItem(KEY); }
export function comparable(a: Snapshot, b: Snapshot): boolean {
  return JSON.stringify(a.input.dataset) === JSON.stringify(b.input.dataset) && JSON.stringify(a.input.fit) === JSON.stringify(b.input.fit) && a.forecast.topK === b.forecast.topK && a.forecast.bottomK === b.forecast.bottomK && a.forecast.seed === b.forecast.seed && a.forecast.simulations === b.forecast.simulations;
}
