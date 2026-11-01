import type { CompletedMatch, Dataset, RemainingFixture } from './types';

export function parseDate(raw: string): string {
  let iso = raw.trim();
  const parts = /^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/.exec(iso);
  if (parts) iso = `${parts[3].length === 2 ? '20' : ''}${parts[3]}-${parts[2]}-${parts[1]}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || !Number.isFinite(Date.parse(iso)) || new Date(iso).toISOString().slice(0, 10) !== iso) throw new Error('Invalid date');
  return iso;
}

// Quoted CSV cells, including embedded newlines; physical line numbers are retained.
function cells(text: string) {
  const rows: { line: number; cells: string[]; malformed: boolean }[] = [];
  let row: string[] = [], cell = '', quoted = false, closed = false, malformed = false, line = 1, start = 1;
  const finishCell = () => { row.push(cell.trim()); cell = ''; closed = false; };
  for (let i = 0; i <= text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else if (c === undefined) { malformed = true; quoted = false; }
      else { cell += c; if (c === '\n') line++; continue; }
      if (c !== undefined) continue;
    }
    if (c === '"') { if (cell.trim() || closed) malformed = true; quoted = true; }
    else if (c === ',') finishCell();
    else if (c === '\n' || c === undefined) {
      finishCell(); rows.push({ line: start, cells: row, malformed });
      row = []; malformed = false; line++; start = line;
    } else if (c !== '\r') { if (closed && c.trim()) malformed = true; cell += c; }
  }
  return rows.filter(r => r.cells.some(Boolean) || r.malformed);
}

export function importCsv(text: string, kind: 'completed' | 'remaining', source = 'CSV') {
  const rows = cells(text.replace(/^\uFEFF/, '')), errors: string[] = [];
  const completed: CompletedMatch[] = [], remaining: RemainingFixture[] = [];
  const header = rows.shift();
  const required = kind === 'completed' ? ['Date', 'HomeTeam', 'AwayTeam', 'FTHG', 'FTAG'] : ['HomeTeam', 'AwayTeam'];
  if (!header || header.malformed || required.some(k => header.cells.filter(c => c === k).length !== 1) || header.cells.filter(c => c === 'Date').length > 1) {
    return { completed, remaining, errors: [`${source}: line 1: required columns missing or duplicated (${required.join(', ')})`] };
  }
  for (const row of rows) {
    try {
      if (row.malformed || row.cells.length !== header.cells.length) throw new Error('Malformed CSV row');
      // Only these five fields are selected; all other columns are ignored.
      const get = (key: 'Date' | 'HomeTeam' | 'AwayTeam' | 'FTHG' | 'FTAG') => row.cells[header.cells.indexOf(key)] ?? '';
      const home = get('HomeTeam'), away = get('AwayTeam');
      if (!home || !away || home === away) throw new Error('Two different team names required');
      const date = get('Date') ? parseDate(get('Date')) : undefined;
      if (kind === 'completed') {
        if (!date) throw new Error('Date required');
        if (![get('FTHG'), get('FTAG')].every(g => /^\d+$/.test(g) && Number.isSafeInteger(Number(g)))) throw new Error('Goals must be nonnegative integers');
        completed.push({ date, home, away, hg: Number(get('FTHG')), ag: Number(get('FTAG')) });
      } else remaining.push({ id: `${source}:${row.line}`, home, away, date });
    } catch (error) { errors.push(`${source}: line ${row.line}: ${(error as Error).message}`); }
  }
  return { completed, remaining, errors };
}

export function inferSeasonStart(matches: CompletedMatch[]) {
  const dates = matches.map(m => m.date).sort();
  let start = dates[0] ?? '';
  for (let i = 1; i < dates.length; i++) if (Date.parse(dates[i]) - Date.parse(dates[i - 1]) > 45 * 86400000) start = dates[i];
  return start;
}

export function validateFormat(dataset: Dataset): string[] {
  const errors: string[] = [], known = new Set(dataset.completed.flatMap(m => [m.home, m.away]));
  if (known.size < 2) errors.push('At least two teams with completed results required.');
  if (!dataset.seasonStart || !dataset.completed.some(m => m.date >= dataset.seasonStart)) errors.push('Season start must include completed matches.');
  const matches = [...dataset.completed.filter(m => m.date >= dataset.seasonStart), ...dataset.remaining];
  const pairs = new Map<string, number>();
  for (const m of matches) {
    if (!known.has(m.home) || !known.has(m.away)) errors.push(`Unknown pair: ${m.home} → ${m.away}`);
    if (m.home === m.away) errors.push(`Invalid self pair: ${m.home}`);
    const key = JSON.stringify([m.home, m.away]); pairs.set(key, (pairs.get(key) ?? 0) + 1);
  }
  for (const home of known) for (const away of known) if (home !== away) {
    const count = pairs.get(JSON.stringify([home, away])) ?? 0;
    if (count !== 1) errors.push(`${count ? 'Duplicated' : 'Missing'} pair: ${home} → ${away}${count ? ` (${count})` : ''}`);
  }
  if (matches.length !== known.size * (known.size - 1)) errors.push(`Total fixtures ${matches.length}; expected ${known.size * (known.size - 1)}.`);
  return errors;
}
