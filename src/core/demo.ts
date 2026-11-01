import { syntheticLeague } from './synth';
import type { Dataset } from './types';
export function demoLeague(): Dataset {
  const full = syntheticLeague('signal');
  return { teams: full.teams, seasonStart: full.seasonStart, completed: full.completed.slice(0, 950),
    remaining: full.completed.slice(950).map((m, i) => ({ id: `demo-${i}`, home: m.home, away: m.away, date: m.date })) };
}
