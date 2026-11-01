import { download } from './export/exports';
import type { ReactNode } from 'react';
import type { backtest, halfLifeSensitivity } from './core/backtest';
import type { SimulationResult } from './core/simulate';
export const number = (n: number | null, digits = 4) => n === null ? '—' : n.toFixed(digits);
export const percent = (n: number) => `${(100 * n).toFixed(1)}%`;
export function Table({ caption, headers, rows }: { caption: string; headers: string[]; rows: ReactNode[][] }) {
  return <div className="table-scroll"><table><caption>{caption}</caption><thead><tr>{headers.map((h, i) => <th scope="col" key={i}>{h}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => j === 0 ? <th scope="row" key={j}>{cell}</th> : <td key={j}>{cell}</td>)}</tr>)}</tbody></table></div>;
}
export function Evidence({ result, sensitivity }: { result?: ReturnType<typeof backtest>; sensitivity?: ReturnType<typeof halfLifeSensitivity> }) {
  if (!result) return <p>Run the chronological backtest to inspect real computed results for the loaded history. No scores are used before their date.</p>;
  const { calibration: c } = result;
  return <>
    <div role="status" className="verdict"><span>RPS comparison · {result.nTest} test matches</span><h3>{result.verdict}</h3></div>
    {result.smallSample && <p className="warning">Small sample: fewer than 200 test matches.</p>}
    {!!result.nonConvergedCutoffs.length && <p className="warning">Not converged: {result.nonConvergedCutoffs.length} block fits. Their predictions remain in the metrics. Inspect diagnostics below.</p>}
    <p>{result.bootstrap.caption} Positive gain means lower loss for the model. Lower scores are better.</p>
    {result.metrics ? <Table caption="Out-of-sample losses" headers={['Metric', 'Model', 'Baseline', 'Gain', 'Gain 95% CI']} rows={Object.entries(result.metrics).map(([name, m]) => [name, number(m.model), number(m.baseline), number(m.gain), `${number(m.ci[0])} to ${number(m.ci[1])}`])}/> : <p>No eligible test matches. At least 100 strictly earlier matches are needed before the first test date.</p>}
    <button onClick={() => {
      const rows = [['Cutoff','TrainingMatches','EffectiveN','TestMatches','Converged','Iterations','Objective','GradientInfinityNorm','Reason'], ...result.blocks.map(b => [b.cutoff,b.fit.nTrain,b.fit.effectiveN,b.predictions.length,b.fit.diag.converged,b.fit.diag.iterations,b.fit.diag.objective,b.fit.diag.gradInfNorm,b.fit.diag.reason])];
      download(rows.map(r => r.map(x => '"'+String(x).replaceAll('"','""')+'"').join(',')).join('\r\n'), 'leaguelab-cutoffs.csv','text/csv;charset=utf-8');
    }}>Download cutoff audit CSV</button>
    <h3>Calibration reliability</h3><p>All three outcome classes pooled. ECE: {number(c.ece)}. Vertical bars show Wilson 95% intervals. Grey points have fewer than 20 predictions.</p>
    <svg viewBox="0 0 600 360" role="img" aria-labelledby="cal-title cal-desc" className="chart">
      <title id="cal-title">Predicted probability versus observed frequency</title><desc id="cal-desc">The table below gives every bin, count and interval. The dashed diagonal represents perfect agreement.</desc>
      {[0, .2, .4, .6, .8, 1].map(p => <g key={p}><line x1="65" x2="555" y1={300 - 260*p} y2={300 - 260*p} stroke="#dce5e8"/><text x="52" y={305 - 260*p} textAnchor="end">{p}</text><text x={65+490*p} y="322" textAnchor="middle">{p}</text></g>)}
      <line x1="65" y1="300" x2="555" y2="40" stroke="#758991" strokeDasharray="5 5"/>
      {c.bins.filter(b => b.n).map(b => <g key={b.lower} fill={b.greyed ? '#879397' : '#087c83'} stroke={b.greyed ? '#879397' : '#087c83'}><line x1={65+490*b.meanPredicted!} x2={65+490*b.meanPredicted!} y1={300-260*b.interval![0]} y2={300-260*b.interval![1]}/><circle cx={65+490*b.meanPredicted!} cy={300-260*b.observedFrequency!} r="5"/><text stroke="none" x={65+490*b.meanPredicted!} y={290-260*b.interval![1]} textAnchor="middle" fontSize="11">n={b.n}</text></g>)}
      <text x="310" y="350" textAnchor="middle">Mean predicted probability</text><text transform="translate(16 175) rotate(-90)" textAnchor="middle">Observed frequency</text>
    </svg>
    <p>{c.caption}</p>
    <Table caption="Calibration chart data" headers={['Bin', 'Count', 'Mean prediction', 'Observed', 'Wilson 95% interval', 'Reading']} rows={c.bins.map(b => [`${percent(b.lower)}–${percent(b.upper)}`, b.n, number(b.meanPredicted), number(b.observedFrequency), b.interval ? b.interval.map(x => number(x)).join(' to ') : '—', b.label])}/>
    <h3>Half-life sensitivity</h3><p>Reported for context only. The primary verdict always uses frozen defaults: 300-day half-life and ridge 0.01. These results do not select a setting.</p>
    {sensitivity ? <Table caption="Sensitivity runs" headers={['Half-life', 'Model RPS', 'Baseline RPS', 'Gain 95% CI', 'Verdict', 'Unconverged blocks']} rows={sensitivity.map(s => [s.label, number(s.result.metrics?.rps.model ?? null), number(s.result.metrics?.rps.baseline ?? null), s.result.metrics?.rps.ci.map(x => number(x)).join(' to ') ?? '—', s.result.verdict, s.result.nonConvergedCutoffs.length])}/> : <p>Sensitivity results have not finished.</p>}
    <h3>Training cutoffs and diagnostics</h3><p>Every block trains only on dates strictly before its cutoff. Training uses all loaded history with time decay. The baseline uses the same sample and weights, with +1 smoothing.</p>
    <Table caption="Per-block audit" headers={['Cutoff (exclusive)', 'Train', 'Effective N', 'Test', 'Converged', 'Iterations', 'Objective', 'Gradient ∞', 'Reason']} rows={result.blocks.map(b => [b.cutoff, b.fit.nTrain, number(b.fit.effectiveN, 1), b.predictions.length, b.fit.diag.converged ? 'Yes' : 'not converged', b.fit.diag.iterations, number(b.fit.diag.objective), b.fit.diag.gradInfNorm.toExponential(2), b.fit.diag.reason])}/>
  </>;
}
export function Heatmap({ forecast: f }: { forecast: SimulationResult }) {
  const n = f.teams.length;
  return <><h3>Finishing-position probabilities</h3><p>Darker cells mean higher probability. Columns are finishing positions.</p>
    <svg viewBox={`0 0 ${160+n*25} ${40+n*25}`} role="img" aria-labelledby="heat-title" className="heatmap"><title id="heat-title">Position probabilities; exact percentages in the following table</title>
      {f.teams.map((t,i) => <g key={t.team}><text x="125" y={48+i*25} textAnchor="end">{t.team}</text>{t.positions.map((p,j) => <rect key={j} x={140+j*25} y={32+i*25} width="23" height="23" fill="#087c83" fillOpacity={.06+.94*p}/>)}</g>)}
      {f.teams.map((_,j) => <text key={j} x={152+j*25} y="22" textAnchor="middle">{j+1}</text>)}
    </svg><Table caption="Position probabilities: text alternative" headers={['Team', ...f.teams.map((_,i) => String(i+1))]} rows={f.teams.map(t => [t.team, ...t.positions.map(percent)])}/></>;
}
