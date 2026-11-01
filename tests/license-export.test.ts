// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest';
import { activate, checksum, deactivate, getTier, validateKey } from '../src/license/license';
import { can, limit } from '../src/license/entitlements';
import { chartSvg, forecastCsv, widget } from '../src/export/exports';
import { clearScenarios, comparable, deleteScenario, loadScenarios, saveScenario } from '../src/export/scenarios';
import type { Snapshot } from '../src/export/scenarios';
import { demoLeague } from '../src/core/demo';
const body = 'LL1-ABCDE-12345-ZYXWV', key = `${body}-${checksum(body)}`;
const forecast = {seed:1, simulations:100, cutoff:'2026-01-01', topK:1, bottomK:1, teams:[{team:'<script>alert("x")</script>',expectedPoints:42,pointsRange:[30,50] as [number,number],expectedRank:1,title:{probability:.5,standardError:.05},top:{probability:.5,standardError:.05},bottom:{probability:.5,standardError:.05},positions:[1]}]};
const snapshot = {id:'1',name:'A',savedAt:'2026-01-01',forecast,input:{dataset:demoLeague(),seed:1,fit:{diag:{converged:false}}},converged:false} as Snapshot;
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
test('valid key, normalized input, malformed format and changed checksum', () => {
  expect(checksum(body)).toBe('C94A');
  expect(validateKey(key)).toBe(true); expect(validateKey(` ${key.toLowerCase()} `)).toBe(true);
  expect(validateKey(key.slice(0,-1)+(key.endsWith('0')?'1':'0'))).toBe(false);
  expect(validateKey('LL1-X-X-X-1234')).toBe(false); expect(validateKey(key+'X')).toBe(false);
});
test('central entitlements cover both tiers, persistence and removal', () => {
  for(const feature of ['import','fit','forecast','evidence','csv'] as const) expect(can(feature)).toBe(true);
  expect(can('widget')).toBe(false); expect(can('chart')).toBe(false); expect(can('scenarios')).toBe(false);
  expect([limit('simulations'),limit('locks'),limit('scenarios')]).toEqual([50000,1,0]);
  expect(activate(key)).toBe(true); expect(getTier()).toBe('pro');
  for(const feature of ['widget','chart','scenarios','uncreditedCsv'] as const) expect(can(feature)).toBe(true);
  expect([limit('simulations'),limit('locks'),limit('scenarios')]).toEqual([100000,Infinity,20]);
  expect(activate('bad')).toBe(false); expect(getTier()).toBe('pro');
  expect(deactivate()).toBe(true); expect(getTier()).toBe('free');
});
test('unavailable storage fails closed without claiming activation', () => {
  vi.spyOn(Storage.prototype,'getItem').mockImplementation(() => { throw new Error('denied'); });
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(() => { throw new Error('denied'); });
  expect(getTier()).toBe('free'); expect(activate(key)).toBe(false);
});
test('CSV handles formula names and tier credit, widget and SVG escape markup and disclose convergence', () => {
  expect(forecastCsv(forecast)).toContain('Created with LeagueLab');
  expect(forecastCsv({...forecast,teams:[{...forecast.teams[0],team:'=1+1'}]})).toContain("'=1+1");
  expect(() => widget(forecast,false)).toThrow('Pro required'); expect(() => chartSvg(forecast,false)).toThrow('Pro required');
  activate(key); expect(forecastCsv(forecast)).not.toContain('Created with LeagueLab');
  const html = widget(forecast,false), svg = chartSvg(forecast,false);
  for(const text of [html,svg]) { expect(text).not.toContain('<script>'); expect(text).toContain('&lt;script&gt;'); expect(text).toContain('not converged'); expect(text).toContain(forecast.cutoff); }
  expect(html).not.toMatch(/<script|<link|<iframe|onload=/i);
  expect(new DOMParser().parseFromString(svg,'image/svg+xml').querySelector('parsererror')).toBeNull();
});
test('scenario persistence enforces 20, supports deletion and rejects incompatible comparisons', () => {
  expect(() => saveScenario(snapshot)).toThrow('Pro required'); activate(key);
  for(let i=0;i<20;i++) saveScenario({...snapshot,id:String(i)});
  expect(loadScenarios()).toHaveLength(20); expect(() => saveScenario(snapshot)).toThrow('limit');
  expect(deleteScenario('0')).toHaveLength(19); expect(saveScenario({...snapshot,id:'new'})).toHaveLength(20);
  expect(comparable(snapshot,structuredClone(snapshot))).toBe(true);
  expect(comparable(snapshot,{...snapshot,forecast:{...forecast,seed:2}})).toBe(false);
  clearScenarios(); expect(loadScenarios()).toEqual([]);
});
test('damaged and full storage report errors without overwriting saved content', () => {
  localStorage.setItem('leaguelab:scenarios:v1','{}'); expect(() => loadScenarios()).toThrow('damaged'); clearScenarios(); activate(key);
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(() => { throw new Error('Quota exceeded'); });
  expect(() => saveScenario(snapshot)).toThrow('Quota exceeded'); expect(loadScenarios()).toEqual([]);
});
