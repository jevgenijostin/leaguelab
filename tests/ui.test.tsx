// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { Worker as NodeWorker } from 'node:worker_threads';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import App from '../src/App';
import { Evidence } from '../src/views';
import { backtest } from '../src/core/backtest';
const bundles: Record<string,string> = {};
const live = new Set<BrowserWorker>();
// Only adapt transport: actual production worker code executes in a separate thread.
class BrowserWorker {
  worker: NodeWorker;
  onmessage?: (e: {data: any})=>void;
  onerror?: (e: {message: string})=>void;
  onmessageerror?: ()=>void;
  constructor(url: URL) {
    const key=url.pathname.includes('analysis.worker')?'analysis':'simulate';
    this.worker=new NodeWorker(`const {parentPort}=require('node:worker_threads'); globalThis.self={postMessage: data=>parentPort.postMessage(data)}; ${bundles[key]}; parentPort.on('message',data=>self.onmessage({data}));`,{eval:true});
    this.worker.on('message',data=>this.onmessage?.({data})); this.worker.on('error',e=>this.onerror?.({message:e.message})); live.add(this);
  }
  postMessage(data: unknown) { this.worker.postMessage(data); }
  terminate() { void this.worker.terminate(); live.delete(this); }
}
let root: Root;
beforeAll(async()=>{
  for(const key of ['analysis','simulate']) {
    const entry=resolve(`src/workers/${key}.worker.ts`);
    const script=`import {build} from 'vite'; const result=await build({configFile:false,logLevel:'silent',build:{write:false,lib:{entry:${JSON.stringify(entry)},name:'TestWorker',formats:['iife']}}}); const bundle=Array.isArray(result)?result[0]:result; process.stdout.write(bundle.output.find(c=>c.type==='chunk').code);`;
    bundles[key]=execFileSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',windowsHide:true});
  }
});
afterEach(async()=>{ if(root) await act(()=>root.unmount()); live.forEach(w=>w.terminate()); vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML=''; });
async function mount(component=<App/>) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true); vi.stubGlobal('Worker',BrowserWorker);
  document.body.innerHTML='<div id="root"></div>'; root=createRoot(document.getElementById('root')!); await act(()=>root.render(component));
}
async function click(text: string) {
  const button=Array.from(document.querySelectorAll('button')).find(b=>b.textContent===text)!;
  expect(button,`button ${text}`).toBeTruthy(); expect(button.disabled).toBe(false); await act(()=>button.click());
}
async function until(check: ()=>boolean, timeout=120000) {
  const start=Date.now(); while(!check()) { if(Date.now()-start>timeout) throw new Error('UI timed out: '+document.body.textContent?.slice(-1000)); await act(async()=>{await new Promise(r=>setTimeout(r,50));}); }
}
test('demo load → real worker fit → forecast → scenario → backtest with rendered verdict and no console errors',async()=>{
  const errors=vi.spyOn(console,'error'); await mount(); await click('Load demo league'); expect(document.body.textContent).toContain('Format check passed');
  await click('Model'); await click('Fit model'); await until(()=>!document.querySelector('.activity')); expect(document.body.textContent).toContain('Fit diagnostics');
  await click('Forecast'); await click('Run forecast'); await until(()=>!document.querySelector('.activity')); expect(document.body.textContent).toContain('Unlocked baseline forecast'); expect(document.querySelector('svg')).toBeTruthy();
  await click('What-if'); const lock=document.querySelector<HTMLInputElement>('input[type=checkbox]')!; await act(()=>lock.click()); expect(document.querySelectorAll('input[type=checkbox]:disabled')).toHaveLength(189); await click('Run locked scenario'); await until(()=>!document.querySelector('.activity')); expect(document.body.textContent).toContain('Scenario change versus unlocked forecast');
  await click('Evidence'); await click('Run backtest'); await until(()=>!!document.querySelector('.verdict')); expect(document.querySelector('.verdict')!.textContent).toContain('Model better than baseline');
  expect(document.body.textContent).toContain('850 test matches'); expect(document.body.textContent).toContain('not converged');
  await until(()=>!document.querySelector('.activity')); expect(document.body.textContent).toContain('no decay'); expect(document.querySelectorAll('svg')).toHaveLength(1); expect(document.body.textContent).toContain('Wilson 95% interval');
  await click('Data'); await click('Load demo league'); await click('Evidence'); expect(document.querySelector('.verdict')).toBeNull();
  expect(errors).not.toHaveBeenCalled();
},120000);
test('small-sample and empty-evaluation evidence is explicitly inconclusive',async()=>{
  await mount(<Evidence result={backtest(['A','B'],[])}/>); expect(document.body.textContent).toContain('Inconclusive on this sample.'); expect(document.body.textContent).toContain('Small sample'); expect(document.body.textContent).toContain('No eligible test matches'); expect(document.body.textContent).toContain('too few to read');
});
test('invalid season blocks analysis and tab keyboard navigation works',async()=>{
  await mount(); const date=document.querySelector<HTMLInputElement>('input[type=date]')!;
  await act(()=>{ Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(date,'2022-08-01'); date.dispatchEvent(new Event('change',{bubbles:true})); date.dispatchEvent(new Event('input',{bubbles:true})); });
  expect(document.body.textContent).toContain('Format check blocked'); await click('Model'); expect(Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Fit model')!.disabled).toBe(true);
  const tab=document.querySelector('[aria-selected=true]')!; await act(()=>tab.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}))); expect(document.querySelector('[aria-selected=true]')!.textContent).toBe('About');
});

