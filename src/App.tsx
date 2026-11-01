import { useEffect, useRef, useState } from 'react';
import { DEFAULT_FIT_CONFIG } from './config/defaults';
import { demoLeague } from './core/demo';
import { importCsv, inferSeasonStart, validateFormat } from './core/importer';
import { forecastCutoff } from './core/simulate';
import type { Probability, SimulationResult } from './core/simulate';
import { startSimulation } from './core/simulationClient';
import { buildTable } from './core/table';
import type { Dataset, FitResult } from './core/types';
import type { backtest, halfLifeSensitivity } from './core/backtest';
import type { AnalysisRequest } from './workers/analysis.worker';
import { Evidence, Heatmap, Table, number, percent } from './views';
import './style.css';
const tabs = ['Data', 'Model', 'Forecast', 'What-if', 'Evidence', 'Export / Pro', 'About'] as const;
const empty: Dataset = { teams: [], completed: [], remaining: [], seasonStart: '' };
const pText = (p: Probability) => `${percent(p.probability)} ± ${percent(p.standardError)}`;
export default function App() {
  const [tab, setTab] = useState<string>('Data'), [data, setData] = useState<Dataset>(demoLeague);
  const [source, setSource] = useState('Synthetic demo · seed 20261101');
  const [parseErrors, setParseErrors] = useState<{ completed: string[]; remaining: string[] }>({ completed: [], remaining: [] });
  const [ack, setAck] = useState(false), [fit, setFit] = useState<FitResult>();
  const [config, setConfig] = useState({ ...DEFAULT_FIT_CONFIG }), [gradient, setGradient] = useState('');
  const [evidence, setEvidence] = useState<ReturnType<typeof backtest>>(), [sensitivity, setSensitivity] = useState<ReturnType<typeof halfLifeSensitivity>>();
  const [baseline, setBaseline] = useState<SimulationResult>(), [scenario, setScenario] = useState<SimulationResult>();
  const [count, setCount] = useState(10000), [seed, setSeed] = useState(20261101), [topK, setTopK] = useState(4), [bottomK, setBottomK] = useState(3);
  const [locks, setLocks] = useState<Record<string, { hg: number; ag: number }>>({});
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [progress, setProgress] = useState(0);
  const [sort, setSort] = useState('net');
  const worker = useRef<Worker | null>(null), cancelSimulation = useRef<(() => void) | null>(null), generation = useRef(0);
  useEffect(() => () => { generation.current++; worker.current?.terminate(); cancelSimulation.current?.(); }, []);
  const formatErrors = validateFormat(data), rowErrors = [...parseErrors.completed, ...parseErrors.remaining];
  const blocked = !!formatErrors.length || (!!rowErrors.length && !ack);
  function cancel() { generation.current++; worker.current?.terminate(); worker.current = null; cancelSimulation.current?.(); cancelSimulation.current = null; setBusy(''); setProgress(0); }
  function invalidate() { cancel(); setFit(undefined); setBaseline(undefined); setScenario(undefined); setEvidence(undefined); setSensitivity(undefined); setGradient(''); setLocks({}); setError(''); }
  function replaceData(d: Dataset) { invalidate(); setData(d); setTopK(Math.min(4, d.teams.length)); setBottomK(Math.min(3, d.teams.length)); }
  function loadDemo() { replaceData(demoLeague()); setSource('Synthetic demo · seed 20261101'); setParseErrors({ completed: [], remaining: [] }); setAck(false); }
  async function upload(files: FileList | null, kind: 'completed' | 'remaining') {
    if (!files?.length) return;
    invalidate(); setBusy('Reading CSV files'); const version = generation.current;
    try {
      const parsed = await Promise.all(Array.from(files).map(async (file, i) => importCsv(await file.text(), kind, `${file.name} [${i+1}]`)));
      if (version !== generation.current) return;
      const base = source.startsWith('Synthetic') ? empty : data;
      const completed = kind === 'completed' ? parsed.flatMap(p => p.completed).sort((a,b) => a.date.localeCompare(b.date)) : base.completed;
      const next = { teams: [...new Set(completed.flatMap(m => [m.home, m.away]))].sort(), completed,
        remaining: kind === 'remaining' ? parsed.flatMap(p => p.remaining) : base.remaining,
        seasonStart: kind === 'completed' ? inferSeasonStart(completed) : base.seasonStart };
      replaceData(next); setSource('Your local CSV files'); setAck(false);
      setParseErrors(previous => ({ ...(source.startsWith('Synthetic') ? { completed: [], remaining: [] } : previous), [kind]: parsed.flatMap(p => p.errors) }));
    } catch (e) { if (version === generation.current) { setError((e as Error).message); setBusy(''); } }
  }
  function analyze(task: AnalysisRequest['task']) {
    if (blocked || busy) return;
    setError(''); setBusy(task === 'evidence' ? 'Running backtest' : task === 'fit' ? 'Fitting model' : 'Checking gradient');
    if (task === 'evidence') { setEvidence(undefined); setSensitivity(undefined); }
    const version = generation.current;
    const w = new Worker(new URL('./workers/analysis.worker.ts', import.meta.url), { type: 'module' }); worker.current = w;
    const finish = () => { w.terminate(); worker.current = null; setBusy(''); };
    w.onmessage = ({ data: message }) => {
      if (version !== generation.current) return;
      if (message.stage === 'error') { setError(message.error); finish(); }
      else if (message.stage === 'primary') { setEvidence(message.result); setBusy('Running half-life sensitivity'); }
      else if (message.stage === 'sensitivity') { setSensitivity(message.result); finish(); }
      else if (message.stage === 'fit') { setFit(message.result); setBaseline(undefined); setScenario(undefined); finish(); }
      else { setGradient(`${message.result.passed ? 'Passed' : 'Failed'} · maximum relative error ${message.result.maxRelativeError.toExponential(3)}`); finish(); }
    };
    w.onerror = e => { setError(e.message); finish(); };
    w.onmessageerror = () => { setError('Unable to read analysis response.'); finish(); };
    w.postMessage({ task, dataset: data, config } satisfies AnalysisRequest);
  }
  async function forecast(withLocks = false) {
    if (!fit || blocked || busy) return;
    if (!Number.isInteger(count) || count < 1 || count > 50000 || !Number.isInteger(seed) || seed < 0 || seed > 4294967295 || ![topK,bottomK].every(k => Number.isInteger(k) && k >= 1 && k <= data.teams.length)) { setError('Enter 1–50,000 simulations, an integer seed from 0 to 4294967295, and valid position thresholds.'); return; }
    setBusy(withLocks ? 'Simulating scenario' : 'Simulating season'); setError(''); setProgress(0);
    const version = generation.current;
    try {
      const run = startSimulation({ dataset: data, fit, seed, simulations: count, topK, bottomK, locks: withLocks ? locks : {} }, (done,total) => setProgress(done/total));
      cancelSimulation.current = run.cancel;
      const result = await run.result;
      if (version === generation.current) { if (withLocks) setScenario(result); else { setBaseline(result); setScenario(undefined); } }
    } catch(e) { if (version === generation.current) setError((e as Error).message); }
    finally { if (version === generation.current) { setBusy(''); cancelSimulation.current = null; } }
  }
  function changeControls(update: () => void) { update(); setBaseline(undefined); setScenario(undefined); }
  function csv() {
    if (!baseline) return;
    const rows = [['Team','ExpectedPoints','PointsP05','PointsP95','TitleProbability','TopProbability','BottomProbability','ExpectedRank','Seed','Simulations','Cutoff'], ...baseline.teams.map(t => [t.team,t.expectedPoints,...t.pointsRange,t.title.probability,t.top.probability,t.bottom.probability,t.expectedRank,baseline.seed,baseline.simulations,baseline.cutoff]), ['Created with LeagueLab']];
    const encode = (x: unknown) => '"' + String(x).replace(/^[=+@\-]/, "'$&").replaceAll('"','""') + '"';
    const url = URL.createObjectURL(new Blob([rows.map(r => r.map(encode).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'leaguelab-forecast.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const current = data.teams.length >= 2 ? buildTable(data.teams, data.completed, data.seasonStart, () => .5) : [];
  return <div className="app"><header><div className="brand">LL</div><div><h1>LeagueLab</h1><p>Local results. Transparent forecasts.</p></div><span className="badge">Browser only · Free</span></header>
    <nav aria-label="LeagueLab sections" role="tablist">{tabs.map((t,i) => <button key={t} id={`tab-${i}`} role="tab" aria-selected={tab===t} aria-controls={`panel-${i}`} tabIndex={tab===t ? 0 : -1} onClick={() => setTab(t)} onKeyDown={e => { if (['ArrowRight','ArrowLeft','Home','End'].includes(e.key)) { e.preventDefault(); const next = e.key==='Home' ? 0 : e.key==='End' ? tabs.length-1 : (i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length; setTab(tabs[next]); document.getElementById(`tab-${next}`)?.focus(); } }}>{t}</button>)}</nav>
    <div className="context"><span>{source}</span><span>{data.teams.length} teams · {data.completed.length} results · {data.remaining.length} remaining</span></div>
    {error && <p role="alert" className="warning">{error}</p>}
    {busy && <div className="activity" role="status">{busy}… <progress aria-label="Simulation progress" value={busy.startsWith('Simulating') ? progress : undefined} max="1"/><button onClick={cancel}>Cancel</button></div>}
    {blocked && tab !== 'Data' && <p className="warning">Analysis blocked. Resolve the Data validation report and acknowledge rejected rows.</p>}
    <main role="tabpanel" id={`panel-${tabs.indexOf(tab as typeof tabs[number])}`} aria-labelledby={`tab-${tabs.indexOf(tab as typeof tabs[number])}`}>
    {tab==='Data' && <><div className="heading"><div><h2>Your league, locally</h2><p>One double round-robin league, with separate results and remaining fixtures.</p></div><button onClick={loadDemo}>Load demo league</button></div>
      <p>The demo is synthetic and contains no real-world results. Importing your first file replaces the demo. Selecting completed files replaces the loaded history; select multiple seasons together.</p>
      <div className="upload-grid">{(['completed','remaining'] as const).map(kind => <label key={kind} className="drop" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void upload(e.dataTransfer.files,kind); }}><strong>{kind==='completed' ? 'Completed results' : 'Remaining fixtures'}</strong><span>Drop CSV files here or choose files</span><input aria-label={kind==='completed' ? 'Completed results CSV' : 'Remaining fixtures CSV'} type="file" accept=".csv,text/csv" multiple={kind==='completed'} disabled={!!busy} onChange={e => { void upload(e.target.files,kind); e.target.value=''; }}/></label>)}</div>
      <p>Results: Date, HomeTeam, AwayTeam, FTHG, FTAG. Fixtures: HomeTeam, AwayTeam and optional Date. Dates: dd/mm/yyyy, dd/mm/yy or yyyy-mm-dd. Other columns are ignored.</p>
      <label>Season start <input type="date" value={data.seasonStart} onChange={e => replaceData({ ...data, seasonStart:e.target.value })}/></label><p>Training uses all history. Standings use results on or after the season start. The suggested start follows the last gap longer than 45 days.</p>
      <h3>Validation report</h3>{rowErrors.length ? <><ul className="warning">{rowErrors.map((e,i) => <li key={i}>{e}</li>)}</ul><label><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)}/> I acknowledge these rejected rows. Only valid rows will be used.</label></> : <p>No row parsing errors.</p>}
      {formatErrors.length ? <><p className="warning">Format check blocked</p><ul>{formatErrors.map((e,i) => <li key={i}>{e}</li>)}</ul></> : <p className="success">Format check passed: every ordered pair appears exactly once in the current season.</p>}
      <Table caption="Current season standings and team list" headers={['Team','Played','Points','GD','GF']} rows={current.map(t => [t.team,t.played,t.points,t.gd,t.gf])}/></>}
    {tab==='Model' && <><h2>Fit the model</h2><p>Training cutoff (exclusive): <strong>{data.completed.length ? forecastCutoff(data) : 'No completed results'}</strong></p><button disabled={blocked || !!busy} onClick={() => analyze('fit')}>Fit model</button>
      <details><summary>Advanced settings</summary><p>These settings affect forecasts only. Evidence uses frozen defaults.</p><label>Half-life (days)<input type="number" min="1" value={config.halfLifeDays} onChange={e => { invalidate(); setConfig({...config,halfLifeDays:Number(e.target.value)}); }}/></label><label>Ridge<input type="number" min="0" step="0.001" value={config.ridge} onChange={e => { invalidate(); setConfig({...config,ridge:Number(e.target.value)}); }}/></label><button disabled={blocked || !!busy} onClick={() => analyze('gradient')}>Run gradient check</button><p role="status">{gradient}</p><p>Checks every coordinate at the loaded sample's initial parameters; the automated G1 test also checks five seeded points.</p></details>
      {fit && <><p className={fit.diag.converged ? 'success':'warning'}>{fit.diag.converged ? 'Converged' : 'not converged'} · {fit.diag.reason}</p><Table caption="Fit diagnostics" headers={['Training matches','Effective N','Iterations','Objective','Gradient ∞','ρ','Home log advantage']} rows={[[fit.nTrain,number(fit.effectiveN,1),fit.diag.iterations,number(fit.diag.objective),fit.diag.gradInfNorm.toExponential(3),number(fit.rho),number(fit.homeAdv)]]}/><label>Sort ratings by<select value={sort} onChange={e => setSort(e.target.value)}><option value="net">Net strength</option><option value="attack">Attack</option><option value="defense">Defense</option><option value="team">Team</option></select></label><Table caption="Centered team ratings (higher defense means fewer conceded)" headers={['Team','Attack','Defense','Net strength']} rows={fit.teams.map((team,i) => ({team,attack:fit.attack[i],defense:fit.defense[i],net:fit.attack[i]+fit.defense[i]})).sort((a,b) => sort==='team' ? a.team.localeCompare(b.team) : b[sort as 'net'|'attack'|'defense']-a[sort as 'net'|'attack'|'defense']).map(t => [t.team,number(t.attack),number(t.defense),number(t.net)])}/></>}
    </>}
    {tab==='Forecast' && <><h2>Where could the season finish?</h2><p>Fit the model first, then simulate the remaining fixtures.</p><fieldset disabled={!!busy}><legend>Simulation controls</legend><label>Simulations<input type="number" min="1" max="50000" value={count} onChange={e => changeControls(() => setCount(Number(e.target.value)))}/></label><label>Seed<input type="number" min="0" max="4294967295" value={seed} onChange={e => changeControls(() => setSeed(Number(e.target.value)))}/></label><button onClick={() => changeControls(() => setSeed(crypto.getRandomValues(new Uint32Array(1))[0]))}>Reshuffle seed</button><label>Top K<input type="number" min="1" max={data.teams.length} value={topK} onChange={e => changeControls(() => setTopK(Number(e.target.value)))}/></label><label>Bottom K<input type="number" min="1" max={data.teams.length} value={bottomK} onChange={e => changeControls(() => setBottomK(Number(e.target.value)))}/></label></fieldset><button disabled={!fit || blocked || !!busy} onClick={() => void forecast()}>Run forecast</button>
      {fit && !fit.diag.converged && <p className="warning">Forecast model: not converged. Treat these estimates with caution.</p>}
      <p>± is one Monte Carlo standard error, √(p(1−p)/N). More simulations reduce simulation noise and do not reduce model uncertainty. Points ranges are the 5th–95th percentiles.</p>
      {baseline && <><p>{baseline.simulations.toLocaleString()} simulations · seed {baseline.seed} · as of {baseline.cutoff}</p><Table caption="Unlocked baseline forecast" headers={['Team','Current points','Expected points (5–95%)','P(title) ± SE',`P(top ${baseline.topK}) ± SE`,`P(bottom ${baseline.bottomK}) ± SE`,'Expected rank']} rows={[...baseline.teams].sort((a,b) => a.expectedRank-b.expectedRank).map(t => [t.team,current.find(r => r.team===t.team)?.points,`${number(t.expectedPoints,1)} (${t.pointsRange.join('–')})`,pText(t.title),pText(t.top),pText(t.bottom),number(t.expectedRank,2)])}/><Heatmap forecast={baseline}/></>}
    </>}
    {tab==='What-if' && <><h2>Explore a fixed result</h2><p>Free tier supports one locked result. Run an unlocked forecast first. Scenario comparisons use the same seed, count and thresholds.</p><button disabled={!baseline || !Object.keys(locks).length || !!busy || blocked} onClick={() => void forecast(true)}>Run locked scenario</button>{fit && !fit.diag.converged && <p className="warning">Scenario model: not converged.</p>}
      {scenario && baseline && <Table caption="Scenario change versus unlocked forecast" headers={['Team','Δ expected points','Δ title (percentage points)','Δ expected rank']} rows={scenario.teams.map(t => { const b=baseline.teams.find(x=>x.team===t.team)!; return [t.team,number(t.expectedPoints-b.expectedPoints,2),number(100*(t.title.probability-b.title.probability),2),number(t.expectedRank-b.expectedRank,2)]; })}/>}
      <Table caption="Remaining fixtures" headers={['Fixture','Date','Lock result','Home goals','Away goals']} rows={data.remaining.map(f => [f.home+' → '+f.away,f.date ?? 'Unscheduled',<input aria-label={`Lock ${f.home} vs ${f.away}`} type="checkbox" disabled={!!busy || (!locks[f.id] && Object.keys(locks).length>=1)} checked={!!locks[f.id]} onChange={e => { setScenario(undefined); setLocks(e.target.checked ? {[f.id]:{hg:0,ag:0}} : {}); }}/>,...(['hg','ag'] as const).map(key => <input aria-label={`${f.home} vs ${f.away} ${key==='hg'?'home':'away'} goals`} type="number" min="0" step="1" disabled={!locks[f.id] || !!busy} value={locks[f.id]?.[key] ?? ''} onChange={e => { const score=Number(e.target.value); if(Number.isSafeInteger(score)&&score>=0) { setScenario(undefined); setLocks({...locks,[f.id]:{...locks[f.id],[key]:score}}); } }}/>)])}/>
    </>}
    {tab==='Evidence' && <><div className="heading"><div><h2>Evidence before confidence</h2><p>Chronological evaluation against an empirical home / draw / away baseline. Always free.</p></div><button disabled={blocked || !!busy} onClick={() => analyze('evidence')}>Run backtest</button></div><Evidence result={evidence} sensitivity={sensitivity}/></>}
    {tab==='Export / Pro' && <><h2>Take your forecast with you</h2><p>Export the unlocked forecast as CSV, including the LeagueLab credit line.</p><button disabled={!baseline} onClick={csv}>Download forecast CSV</button><h3>Edition limits</h3><Table caption="Free and planned Pro scope" headers={['Feature','Free','Pro specification']} rows={[["Evidence and backtest","Included","Included"],["Simulations","50,000","100,000"],["Result locks","1","Unlimited"],["CSV","With credit","Without credit"],["Static widget and chart exports","—","HTML, SVG, PNG"],["Saved scenarios","—","Up to 20"]]}/><p>This build runs the Free edition. License validation and Pro exports are not implemented in this phase.</p><label>License key<input disabled placeholder="LL1-XXXXX-XXXXX-XXXXX-CCCC" aria-describedby="license-note"/></label><p id="license-note">License entry is disabled until the entitlement module is implemented.</p></>}
    {tab==='About' && <><h2>Method and limits</h2><h3>A time-decayed Dixon–Coles model</h3><p>Home scoring rate λ = exp(c + η + attack(home) − defense(away)); away rate μ = exp(c + attack(away) − defense(home)). A ρ correction adjusts the four low-score outcomes. The score grid is truncated at 10 goals and renormalized.</p><p>Attack and defense ratings are centered. Older results receive exponentially smaller weights with a default half-life of 300 days. Ridge regularization (default 0.01) is a disclosed deviation from the original Dixon–Coles model, used to stabilize small samples.</p><h3>Season simulation</h3><p>Points are 3 / 1 / 0. Tie-breaks use points, goal difference, goals for, then a seeded random draw. Head-to-head is not implemented. Ratings are point estimates; simulations do not incorporate rating uncertainty, injuries or lineups.</p><h3>Scope and privacy</h3><p>One flat double round-robin league only. No playoffs, groups, knockout rounds or split seasons. No financial or wagering functionality. All calculations and CSV processing stay in your browser. No accounts, live feeds or server uploads.</p><h3>Reading evidence</h3><p>Evaluation starts only after 100 earlier matches. Each seven-day block uses strictly earlier training dates. Hyperparameters are fixed before evaluation. Confidence intervals are approximate because matches are not independent. Synthetic examples demonstrate the method; they do not establish accuracy for a real league.</p></>}
    </main><footer>LeagueLab · Simulated from past results, not a guarantee.</footer></div>;
}
