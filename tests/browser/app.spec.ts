import { expect, test } from '@playwright/test';
test('real browser demo, responsive charts, worker cancellation and evidence', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror',e=>errors.push(e.message)); page.on('console',m=>{ if(m.type()==='error') errors.push(m.text()); });
  await page.goto('/'); await page.getByRole('button',{name:'Load demo league'}).click();
  await page.getByRole('tab',{name:'Model',exact:true}).click(); await page.getByRole('button',{name:'Fit model',exact:true}).click();
  await expect(page.getByText('Fit diagnostics',{exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'Forecast',exact:true}).click(); await page.getByRole('button',{name:'Run forecast'}).click();
  await expect(page.getByText('Unlocked baseline forecast',{exact:true})).toBeVisible();
  await page.setViewportSize({width:1280,height:1200});
  await page.screenshot({path:'docs/forecast.png',fullPage:false});
  await page.getByRole('tab',{name:'Export / Pro',exact:true}).click();
  const download = page.waitForEvent('download'); await page.getByRole('button',{name:'Download forecast CSV'}).click(); expect((await download).suggestedFilename()).toBe('leaguelab-forecast.csv');
  await page.getByRole('tab',{name:'Evidence',exact:true}).click(); await page.getByRole('button',{name:'Run backtest'}).click(); await page.getByRole('button',{name:'Cancel',exact:true}).click(); await expect(page.locator('.activity')).toHaveCount(0);
  await page.getByRole('button',{name:'Run backtest'}).click(); await expect(page.locator('.verdict')).toContainText('Model better than baseline',{timeout:60000});
  await expect(page.locator('.activity')).toHaveCount(0,{timeout:90000}); await expect(page.getByRole('cell',{name:'no decay',exact:true})).toHaveCount(0); // row headers carry the label
  await expect(page.getByRole('rowheader',{name:'no decay',exact:true})).toBeVisible();
  const audit = page.waitForEvent('download'); await page.getByRole('button',{name:'Download cutoff audit CSV'}).click(); expect((await audit).suggestedFilename()).toBe('leaguelab-cutoffs.csv');
  await page.screenshot({path:'test-results/evidence-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/evidence-mobile.png',fullPage:true}); expect(errors).toEqual([]);
});
test('rejected import rows require acknowledgment and invalid pairs block fitting',async({page})=>{
  await page.goto('/');
  await page.getByLabel('Completed results CSV',{exact:true}).setInputFiles({name:'results.csv',mimeType:'text/csv',buffer:Buffer.from('Date,HomeTeam,AwayTeam,FTHG,FTAG\n2024-01-01,A,B,1,0\n2024-01-02,A,B,-1,0')});
  await page.getByLabel('Remaining fixtures CSV',{exact:true}).setInputFiles({name:'fixtures.csv',mimeType:'text/csv',buffer:Buffer.from('HomeTeam,AwayTeam\nB,A')});
  await expect(page.getByText(/line 3: Goals must/)).toBeVisible();
  await page.getByRole('tab',{name:'Model',exact:true}).click(); await expect(page.getByRole('button',{name:'Fit model',exact:true})).toBeDisabled();
  await page.getByRole('tab',{name:'Data',exact:true}).click(); await page.getByRole('checkbox').check();
  await page.getByRole('tab',{name:'Model',exact:true}).click(); await expect(page.getByRole('button',{name:'Fit model',exact:true})).toBeEnabled();
  await page.getByRole('tab',{name:'Data',exact:true}).click();
  await page.getByLabel('Remaining fixtures CSV',{exact:true}).setInputFiles({name:'fixtures.csv',mimeType:'text/csv',buffer:Buffer.from('HomeTeam,AwayTeam\nB,Unknown')});
  await expect(page.getByText('Unknown pair: B → Unknown')).toBeVisible(); await page.getByRole('tab',{name:'Forecast',exact:true}).click(); await expect(page.getByRole('button',{name:'Run forecast'})).toBeDisabled();
});

test('Pro activation, multiple locks, persistent comparison and real export downloads', async ({page}) => {
  const errors: string[] = []; page.on('pageerror',e => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('tab',{name:'Model',exact:true}).click(); await page.getByRole('button',{name:'Fit model',exact:true}).click();
  await expect(page.getByText('Fit diagnostics',{exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'Forecast',exact:true}).click(); await page.getByRole('button',{name:'Run forecast'}).click();
  await expect(page.getByText('Unlocked baseline forecast',{exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'Export / Pro',exact:true}).click();
  await expect(page.getByRole('button',{name:'Download SVG chart'})).toBeDisabled();
  await page.getByLabel('License key',{exact:true}).fill('invalid'); await page.getByRole('button',{name:'Activate key'}).click();
  await expect(page.getByRole('status')).toContainText('Invalid key');
  const { checksum } = await import('../../src/license/license'); const body = 'LL1-ABCDE-12345-ZYXWV';
  await page.getByLabel('License key',{exact:true}).fill(`${body}-${checksum(body)}`); await page.getByRole('button',{name:'Activate key'}).click();
  await expect(page.locator('header')).toContainText('Pro');
  await page.getByRole('tab',{name:'Forecast',exact:true}).click(); await expect(page.getByLabel('Simulations',{exact:true})).toHaveAttribute('max','100000');
  await page.getByRole('tab',{name:'Export / Pro',exact:true}).click();
  await page.getByLabel('Scenario name',{exact:true}).fill('Baseline'); await page.getByRole('button',{name:'Save scenario',exact:true}).click();
  await page.getByRole('tab',{name:'What-if',exact:true}).click();
  await page.getByRole('checkbox').nth(0).check(); await page.getByRole('checkbox').nth(1).check();
  await page.getByRole('button',{name:'Run locked scenario'}).click(); await expect(page.getByText('Scenario change versus unlocked forecast',{exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'Export / Pro',exact:true}).click();
  await page.getByLabel('Scenario name',{exact:true}).fill('Two locks'); await page.getByRole('button',{name:'Save scenario',exact:true}).click();
  await page.getByLabel('Compare first',{exact:true}).selectOption({label:'Baseline'}); await page.getByLabel('Compare second',{exact:true}).selectOption({label:'Two locks'});
  await expect(page.getByText('Saved comparison: second minus first',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Generate HTML widget'}).click(); await expect(page.getByLabel('Embeddable HTML')).toHaveValue(/As of/);
  for(const [button,filename] of [['Download SVG chart','leaguelab-chart.svg'],['Download PNG chart','leaguelab-chart.png'],['Download widget HTML','leaguelab-widget.html']]) {
    const event = page.waitForEvent('download'); await page.getByRole('button',{name:button,exact:true}).click(); const downloaded = await event;
    expect(downloaded.suggestedFilename()).toBe(filename); const path = await downloaded.path(); const { readFileSync } = await import('node:fs'); const bytes = readFileSync(path!); expect(bytes.length).toBeGreaterThan(100);
    if(filename.endsWith('.png')) expect([...bytes.subarray(0,8)]).toEqual([137,80,78,71,13,10,26,10]);
  }
  await page.reload(); await expect(page.locator('header')).toContainText('Pro'); await page.getByRole('tab',{name:'Export / Pro',exact:true}).click();
  await expect(page.getByRole('rowheader',{name:'Two locks',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Remove key'}).click(); await expect(page.locator('header')).toContainText('Free');
  await page.getByRole('tab',{name:'Forecast',exact:true}).click(); await expect(page.getByLabel('Simulations',{exact:true})).toHaveAttribute('max','50000');
  expect(errors).toEqual([]);
});
