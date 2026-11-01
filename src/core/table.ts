import type { CompletedMatch } from './types';

export interface TableRow {
  team: string;
  played: number;
  points: number;
  gf: number;
  ga: number;
  gd: number;
}

export function emptyTable(teams: readonly string[]): TableRow[] {
  if (teams.length < 2 || new Set(teams).size !== teams.length) throw new RangeError('At least two unique teams required.');
  return teams.map(team => ({ team, played: 0, points: 0, gf: 0, ga: 0, gd: 0 }));
}

export function addScore(home: TableRow, away: TableRow, hg: number, ag: number): void {
  if (home === away || ![hg, ag].every(g => Number.isSafeInteger(g) && g >= 0)) throw new RangeError('Invalid match score.');
  home.played++; away.played++;
  home.gf += hg; home.ga += ag; home.gd += hg - ag;
  away.gf += ag; away.ga += hg; away.gd += ag - hg;
  home.points += hg > ag ? 3 : hg === ag ? 1 : 0;
  away.points += ag > hg ? 3 : hg === ag ? 1 : 0;
}

/** Keys are drawn before sorting, never inside the comparator. */
export function rankTable(rows: readonly TableRow[], random: () => number): TableRow[] {
  return rows.map(row => ({ row, key: random() })).sort((a, b) =>
    b.row.points - a.row.points || b.row.gd - a.row.gd || b.row.gf - a.row.gf || a.key - b.key ||
    (a.row.team < b.row.team ? -1 : a.row.team > b.row.team ? 1 : 0),
  ).map(({ row }) => row);
}

export function buildTable(teams: readonly string[], matches: readonly CompletedMatch[], seasonStart: string, random: () => number): TableRow[] {
  const rows = emptyTable(teams), byTeam = new Map(rows.map(row => [row.team, row]));
  for (const match of matches) if (match.date >= seasonStart) {
    const home = byTeam.get(match.home), away = byTeam.get(match.away);
    if (!home || !away) throw new RangeError('Unknown table team.');
    addScore(home, away, match.hg, match.ag);
  }
  return rankTable(rows, random);
}
