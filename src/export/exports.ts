import type { SimulationResult } from '../core/simulate';
import { can } from '../license/entitlements';
export const escapeMarkup = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
export function forecastCsv(f: SimulationResult, converged?: boolean): string {
  const rows = [['Team','ExpectedPoints','PointsP05','PointsP95','TitleProbability','TopProbability','BottomProbability','ExpectedRank','Seed','Simulations','Cutoff','TopK','BottomK','ModelConverged'], ...f.teams.map(t => [t.team,t.expectedPoints,...t.pointsRange,t.title.probability,t.top.probability,t.bottom.probability,t.expectedRank,f.seed,f.simulations,f.cutoff,f.topK,f.bottomK,converged ?? 'unknown'])];
  if (!can('uncreditedCsv')) rows.push(['Created with LeagueLab']);
  return rows.map(row => row.map(x => '"' + String(x).replace(/^[=+@\-]/, "'$&").replaceAll('"','""') + '"').join(',')).join('\r\n');
}
export function widget(f: SimulationResult, converged: boolean): string {
  if (!can('widget')) throw new Error('Pro required.');
  return `<section class="leaguelab"><style>.leaguelab{font:16px system-ui;color:#16353d;background:#fff;padding:20px;overflow:auto}.leaguelab table{border-collapse:collapse;width:100%}.leaguelab th,.leaguelab td{padding:8px;border-bottom:1px solid #ccd;text-align:left}</style><h2>LeagueLab forecast</h2><table><caption>Seed ${f.seed}; ${f.simulations} simulations</caption><thead><tr><th>Team</th><th>Expected points</th><th>Title</th><th>Top ${f.topK}</th><th>Bottom ${f.bottomK}</th><th>Expected rank</th></tr></thead><tbody>${f.teams.map(t => `<tr><th scope="row">${escapeMarkup(t.team)}</th><td>${t.expectedPoints.toFixed(1)} (${t.pointsRange.join('–')})</td><td>${pct(t.title.probability)}</td><td>${pct(t.top.probability)}</td><td>${pct(t.bottom.probability)}</td><td>${t.expectedRank.toFixed(2)}</td></tr>`).join('')}</tbody></table><p>As of ${escapeMarkup(f.cutoff)}, simulated from past results, not a guarantee. ${converged ? '' : 'Model not converged. '}Point ranges: 5th–95th percentiles. More simulations do not reduce model uncertainty.</p></section>`;
}
export function chartSvg(f: SimulationResult, converged: boolean): string {
  if (!can('chart')) throw new Error('Pro required.');
  const h = 150 + f.teams.length * 30;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="${h}" viewBox="0 0 1000 ${h}" role="img" aria-labelledby="title desc"><title id="title">LeagueLab title probability</title><desc id="desc">${escapeMarkup(f.teams.map(t => `${t.team}: ${pct(t.title.probability)}`).join('; '))}</desc><rect width="100%" height="100%" fill="white"/><g font-family="sans-serif" font-size="14" fill="#16353d"><text x="20" y="30">Title probability · ${f.simulations} simulations · seed ${f.seed}</text>${f.teams.map((t,i) => `<text x="20" y="${65+i*30}">${escapeMarkup(t.team)}</text><rect x="350" y="${50+i*30}" width="${500*t.title.probability}" height="20" fill="#087c83"/><text x="870" y="${65+i*30}">${pct(t.title.probability)}</text>`).join('')}<text x="20" y="${h-45}">As of ${escapeMarkup(f.cutoff)}, simulated from past results, not a guarantee.</text><text x="20" y="${h-20}">${converged ? '' : 'Model not converged. '}More simulations do not reduce model uncertainty.</text></g></svg>`;
}
export function download(content: Blob | string, filename: string, type = 'text/plain') {
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function png(svg: string): Promise<Blob> {
  if (!can('chart')) throw new Error('Pro required.');
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image(); img.src = url; await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Canvas unavailable.');
    ctx.drawImage(img, 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('PNG export failed.')), 'image/png'));
  } finally { URL.revokeObjectURL(url); }
}
