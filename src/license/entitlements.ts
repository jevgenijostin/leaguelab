import { getTier } from './license';
export type Feature = 'import' | 'fit' | 'forecast' | 'evidence' | 'csv' | 'widget' | 'chart' | 'scenarios' | 'uncreditedCsv';
export function can(feature: Feature): boolean {
  return !['widget', 'chart', 'scenarios', 'uncreditedCsv'].includes(feature) || getTier() === 'pro';
}
export function limit(feature: 'simulations' | 'locks' | 'scenarios'): number {
  const pro = getTier() === 'pro';
  return feature === 'simulations' ? (pro ? 100000 : 50000) : feature === 'locks' ? (pro ? Infinity : 1) : (pro ? 20 : 0);
}
