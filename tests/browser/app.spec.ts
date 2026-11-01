import { expect, test } from '@playwright/test';
test('real browser demo, responsive charts, worker cancellation and evidence', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror',e=>errors.push(e.message)); page.on('console',m=>{ if(m.type()==='error') errors.push(m.text()); });
  await page.goto('/'); await page.getByRole('button',{name:'Load demo league'}).click();
  await page.getByRole('tab',{name:'Model',exact:true}).click(); await page.getByRole('button',{name:'Fit model',exact:true}).click();
  await expect(page.getByText('Fit diagnostics',{exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'Forecast',exact:true}).click(); await page.getByRole('button',{name:'Run forecast'}).click();
  await expect(page.getByText('Unlocked baseline forecast',{exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'Export / Pro',exact:true}).click();
  const download = page.waitForEvent('download'); await page.getByRole('button',{name:'Download forecast CSV'}).click(); expect((await download).suggestedFilename()).toBe('leaguelab-forecast.csv');
  await page.getByRole('tab',{name:'Evidence',exact:true}).click(); await page.getByRole('button',{name:'Run backtest'}).click(); await page.getByRole('button',{name:'Cancel',exact:true}).click(); await expect(page.locator('.activity')).toHaveCount(0);
  await page.getByRole('button',{name:'Run backtest'}).click(); await expect(page.locator('.verdict')).toContainText('Model better than baseline',{timeout:60000});
  await expect(page.locator('.activity')).toHaveCount(0,{timeout:90000}); await expect(page.getByRole('cell',{name:'no decay',exact:true})).toHaveCount(0); // row headers carry the label
  await expect(page.getByRole('rowheader',{name:'no decay',exact:true})).toBeVisible();
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
