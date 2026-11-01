import { useEffect, useState } from 'react';
import type { SimulationInput, SimulationResult } from './core/simulate';
import { activate, deactivate } from './license/license';
import { can, limit } from './license/entitlements';
import { PRICING } from './config/pricing';
import { chartSvg, download, forecastCsv, png, widget } from './export/exports';
import { clearScenarios, comparable, deleteScenario, loadScenarios, saveScenario } from './export/scenarios';
import type { Snapshot } from './export/scenarios';
import { Table, number } from './views';
export function ExportPro({ forecast, input, changed }: { forecast?: SimulationResult; input?: SimulationInput; changed: () => void }) {
  const [key, setKey] = useState(''), [message, setMessage] = useState(''), [html, setHtml] = useState('');
  const [name, setName] = useState(''), [saved, setSaved] = useState<Snapshot[]>([]), [left, setLeft] = useState(''), [right, setRight] = useState('');
  useEffect(() => { try { setSaved(loadScenarios()); } catch(e) { setMessage((e as Error).message); } }, []);
  useEffect(() => { setHtml(''); }, [forecast]);
  async function perform(action: () => void | Promise<void>) { try { await action(); } catch(e) { setMessage((e as Error).message); } }
  const a = saved.find(s => s.id === left), b = saved.find(s => s.id === right), compatible = a && b && comparable(a,b);
  return <><h2>Take your forecast with you</h2><p>Exports use the latest computed locked scenario when available, otherwise the unlocked forecast.</p>
    <button disabled={!forecast} onClick={() => forecast && download(forecastCsv(forecast, input?.fit.diag.converged), 'leaguelab-forecast.csv', 'text/csv;charset=utf-8')}>Download forecast CSV</button>
    <h3>Edition limits</h3><Table caption="Free and Pro" headers={['Feature','Free','Pro']} rows={[["Evidence and backtest","Included","Included"],["Simulations","50,000","100,000"],["Result locks","1","Unlimited"],["CSV","With credit","Without credit"],["Static widget and chart exports","—","HTML, SVG, PNG"],["Saved scenarios and comparison","—","Up to 20"]]}/>
    <p>License validation is a client-only development stub, trivially bypassable. It does not validate monetization. Real server-side validation is required before charging anyone.</p>
    <label>License key<input value={key} placeholder="LL1-XXXXX-XXXXX-XXXXX-CCCC" onChange={e => setKey(e.target.value)}/></label>
    <button onClick={() => { const ok = activate(key); setMessage(ok ? 'Pro activated on this browser.' : 'Invalid key or browser storage unavailable.'); if(ok) changed(); }}>Activate key</button>
    <button onClick={() => { const ok = deactivate(); setMessage(ok ? 'Free edition active.' : 'Browser storage unavailable.'); if(ok) { setHtml(''); changed(); } }}>Remove key</button>
    <a href={PRICING.buyUrl} target="_blank" rel="noreferrer">Buy Pro (placeholder · {PRICING.priceLabel})</a><p role="status">{message}</p>
    <h3>Widget and charts</h3><p>Pro exports are static snapshots. The HTML widget has inline CSS and no JavaScript.</p>
    <button disabled={!forecast || !can('widget')} onClick={() => void perform(() => { setHtml(widget(forecast!, !!input?.fit.diag.converged)); })}>Generate HTML widget</button>
    {html && can('widget') && <><label>Embeddable HTML<textarea readOnly rows={8} value={html}/></label><button onClick={() => download(html, 'leaguelab-widget.html','text/html')}>Download widget HTML</button></>}
    <button disabled={!forecast || !can('chart')} onClick={() => void perform(() => download(chartSvg(forecast!, !!input?.fit.diag.converged), 'leaguelab-chart.svg', 'image/svg+xml'))}>Download SVG chart</button>
    <button disabled={!forecast || !can('chart')} onClick={() => void perform(async () => download(await png(chartSvg(forecast!, !!input?.fit.diag.converged)), 'leaguelab-chart.png'))}>Download PNG chart</button>
    <h3>Saved scenarios</h3><p>Stored only in this browser, including inputs, locks, fit and forecast. Clearing site storage removes them. {saved.length} / {limit('scenarios')} saved.</p>
    <label>Scenario name<input maxLength={100} value={name} onChange={e => setName(e.target.value)}/></label>
    <button disabled={!forecast || !input || !name.trim() || !can('scenarios') || saved.length >= limit('scenarios')} onClick={() => void perform(() => { setSaved(saveScenario({ id: crypto.randomUUID(), name:name.trim(), savedAt:new Date().toISOString(), forecast:forecast!, input:input!, converged:input!.fit.diag.converged })); setName(''); setMessage('Scenario saved.'); })}>Save scenario</button>
    <button onClick={() => void perform(() => { clearScenarios(); setSaved([]); })}>Clear saved scenarios</button>
    {can('scenarios') && <><Table caption="Saved forecast snapshots" headers={['Name','Saved','Cutoff','Locks','Status','Delete']} rows={saved.map(s => [s.name,s.savedAt,s.forecast.cutoff,Object.keys(s.input.locks ?? {}).length,s.converged ? 'Converged' : 'not converged',<button onClick={() => void perform(() => setSaved(deleteScenario(s.id)))}>Delete {s.name}</button>])}/>
    <label>Compare first<select aria-label="Compare first" value={left} onChange={e => setLeft(e.target.value)}><option value="">Choose scenario</option>{saved.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    <label>Compare second<select aria-label="Compare second" value={right} onChange={e => setRight(e.target.value)}><option value="">Choose scenario</option>{saved.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    {a && b && !compatible && <p className="warning">These snapshots use different data, fits, seeds, counts or thresholds. Comparison requires matching settings.</p>}
    {compatible && <Table caption="Saved comparison: second minus first" headers={['Team','Δ expected points','Δ title (percentage points)','Δ expected rank']} rows={b.forecast.teams.map(t => { const previous = a.forecast.teams.find(p => p.team === t.team)!; return [t.team,number(t.expectedPoints-previous.expectedPoints,2),number(100*(t.title.probability-previous.title.probability),2),number(t.expectedRank-previous.expectedRank,2)]; })}/>}</>}
  </>;
}
