import { expect, test } from 'vitest';
import { demoLeague } from '../src/core/demo';
import { importCsv, inferSeasonStart, parseDate, validateFormat } from '../src/core/importer';
const header = 'Date,HomeTeam,AwayTeam,FTHG,FTAG';
test('G8: accepts supported date formats and rejects impossible dates', () => {
  expect(['01/02/2024','01/02/24','2024-02-01'].map(parseDate)).toEqual(Array(3).fill('2024-02-01'));
  for(const raw of ['31/02/2024','2024-13-01','2023-02-29','garbage']) expect(() => parseDate(raw)).toThrow();
});
test('G8: whitelist ignores extra columns and trims names', () => {
  const parsed=importCsv(`${header},Div,Time,B365H\n01/02/24, A , B ,2,1,X,12:00,not-a-number`,'completed');
  expect(parsed.errors).toEqual([]); expect(parsed.completed).toEqual([{date:'2024-02-01',home:'A',away:'B',hg:2,ag:1}]);
});
test('G8: reports every malformed row with physical line numbers', () => {
  const parsed=importCsv(`${header}\n2024-01-01,A,B,-1,0\n2024-01-02,A,B,1.5,0\n2024-01-03,A,A,1,0\n2024-02-31,A,B,1,0\n2024-01-04,A,B,,0\n2024-01-05,A,B,1`,'completed','history.csv');
  expect(parsed.completed).toEqual([]); expect(parsed.errors).toHaveLength(6);
  parsed.errors.forEach((e,i)=>expect(e).toContain(`history.csv: line ${i+2}:`));
});
test('G8: quoted cells, escaped quotes, BOM and multiline line tracking', () => {
  const parsed=importCsv(`\uFEFF${header}\r\n2024-01-01,"A, city","B ""town""",1,0\r\n2024-01-02,"A\ncity",B,2,0\r\n2024-01-03,A,B,no,0`,'completed');
  expect(parsed.completed[0].home).toBe('A, city'); expect(parsed.completed[0].away).toBe('B "town"'); expect(parsed.errors[0]).toContain('line 5:');
});
test('G8: malformed quotes and missing or repeated headers block parsing', () => {
  for (const csv of ['Date,HomeTeam,AwayTeam,FTHG',header+',FTHG',header+'\n2024-01-01,"A,B,1,0',header+'\n2024-01-01,"A"oops,B,1,0']) expect(importCsv(csv,'completed').errors.length).toBeGreaterThan(0);
});
test('G8: remaining dates optional, goals unused and invalid dates reported', () => {
  expect(importCsv('HomeTeam,AwayTeam\n A , B','remaining').remaining[0]).toMatchObject({home:'A',away:'B',date:undefined});
  expect(importCsv('Date,HomeTeam,AwayTeam\nno,A,B','remaining').errors).toHaveLength(1);
});
test('G8: demo has two history seasons and a valid half-finished current season', () => {
  const d=demoLeague(); expect(d.completed).toHaveLength(950); expect(d.remaining).toHaveLength(190); expect(validateFormat(d)).toEqual([]);
  expect(inferSeasonStart(d.completed)).toBe(d.seasonStart);
});
test('G8: missing pairs and total mismatch are specific blocking failures', () => {
  const d=demoLeague(), removed=d.remaining.pop()!; const errors=validateFormat(d);
  expect(errors).toContain(`Missing pair: ${removed.home} → ${removed.away}`); expect(errors.some(e=>e.startsWith('Total fixtures'))).toBe(true);
});
test('G8: duplicated pair detected even with the correct fixture total', () => {
  const d=demoLeague(); d.remaining[1]={...d.remaining[0],id:'duplicate'};
  const errors=validateFormat(d); expect(errors.some(e=>e.startsWith('Duplicated pair'))).toBe(true); expect(errors.some(e=>e.startsWith('Missing pair'))).toBe(true);
});
test('G8: remaining teams must exist in completed history', () => {
  const d=demoLeague(); d.remaining[0].home='Unknown'; expect(validateFormat(d).some(e=>e.startsWith('Unknown pair: Unknown'))).toBe(true);
});
test('G8: season override changes the format check and history is excluded from pair totals', () => {
  const d=demoLeague(); expect(validateFormat(d)).toEqual([]); d.seasonStart='2022-08-01'; expect(validateFormat(d).some(e=>e.startsWith('Duplicated'))).toBe(true);
  d.seasonStart='2099-01-01'; expect(validateFormat(d)).toContain('Season start must include completed matches.');
});
