// Browser test: bakery production (plan, bake, planned → done, batch sheet), end-of-day write-off, waste, report, product settings.
// Needs: fresh seed data, API on :3000, vite preview on :4173, Playwright.
const { chromium } = require('playwright');
const OUT = process.env.SHOTS_DIR ? process.env.SHOTS_DIR + '/' : null;
const W = 'http://localhost:4173';
let fails = 0; const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  const shot = (n) => (OUT ? page.screenshot({ path: OUT + n + '.png' }) : null);
  const row = (name) => page.locator('.p-datatable-tbody tr', { hasText: name }).first();
  const cell = async (name, i) => (await row(name).locator('td').nth(i).textContent()).replace(/\s+/g, ' ').trim();

  await page.goto(W + '/login'); await page.fill('#email', 'manager.pp@pos.local'); await page.fill('#password', 'Password@123'); await page.click('button[type=submit]');
  await page.waitForTimeout(1500);
  await page.goto(W + '/production'); await page.waitForSelector('text=What to bake today'); await page.waitForTimeout(800);
  ok((await row('Butter Croissant').count()) === 1 && (await row('Chocolate Muffin').count()) === 1, 'plan lists the 2 bakery items');
  ok((await cell('Butter Croissant', 0)).includes('batch of 24') && (await cell('Butter Croissant', 0)).includes('fresh 24 h'), 'croissant: batch of 24, fresh 24 h');
  ok((await cell('Butter Croissant', 6)).includes('$0.31'), 'cost per croissant from the batch recipe: ' + (await cell('Butter Croissant', 6)));
  await shot('b0-plan');

  // Bake 48 croissants (already out of the oven)
  await row('Butter Croissant').getByRole('button', { name: 'Bake' }).click(); await page.waitForTimeout(400);
  await page.locator('.p-dialog .p-inputnumber input').first().fill('48'); await page.locator('.p-dialog .p-inputnumber input').first().press('Tab'); await page.waitForTimeout(200);
  ok((await page.locator('.p-dialog .hint').first().textContent()).includes('2 batches of 24'), 'dialog: 48 pieces = 2 batches of 24');
  await shot('b1-bake');
  await page.getByRole('button', { name: 'Add to stock' }).click(); await page.waitForTimeout(1200);
  ok((await page.locator('.p-toast-message', { hasText: 'Baked 48 × Butter Croissant' }).count()) === 1, 'toast: baked 48 croissants');
  ok((await cell('Butter Croissant', 3)).startsWith('78') && (await cell('Butter Croissant', 4)).startsWith('48'), 'plan: stock 30 + 48 = 78, baked today 48');

  // Plan a muffin batch, then complete it with 10 good pieces
  await row('Chocolate Muffin').getByRole('button', { name: 'Bake' }).click(); await page.waitForTimeout(400);
  await page.locator('.p-dialog .p-inputnumber input').first().fill('12');
  await page.locator('.p-dialog .p-toggleswitch').click();
  await page.getByRole('button', { name: 'Plan batch' }).click(); await page.waitForTimeout(1000);
  const planned = page.locator('.card', { hasText: "Today's batches" }).locator('tr', { hasText: 'Chocolate Muffin' });
  ok((await planned.textContent()).includes('planned'), 'muffin batch is planned');
  await planned.getByRole('button', { name: 'Done' }).click(); await page.waitForTimeout(400);
  await page.locator('.p-dialog .p-inputnumber input').fill('10');
  await page.getByRole('button', { name: 'Put in stock' }).click(); await page.waitForTimeout(1200);
  ok((await planned.textContent()).includes('done') && (await planned.textContent()).includes('10'), 'muffin batch done: 10 pieces');
  await shot('b2-batches');
  await page.locator('.card', { hasText: "Today's batches" }).locator('tr', { hasText: 'Butter Croissant' }).getByRole('button', { name: 'Sheet' }).click(); await page.waitForTimeout(500);
  const sheet = (await page.locator('.p-dialog').textContent()).replace(/\s+/g, ' ');
  ok(sheet.includes('Flour') && sheet.includes('2000 g') && sheet.includes('$14.64'), 'batch sheet: 2000 g flour, total $14.64');
  await shot('b3-sheet');
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);

  // End of day: the 30 opening pieces are older than the fresh batch → expired
  await page.locator('.p-selectbutton').getByText('End of day').click(); await page.waitForSelector('text=Leftovers'); await page.waitForTimeout(800);
  ok((await cell('Butter Croissant', 2)) === '30' && (await cell('Butter Croissant', 4)) === '48', 'end of day: 30 expired, 48 good tomorrow');
  await shot('b4-eod');
  // keep only the croissants: muffins 0
  const muffinInput = row('Chocolate Muffin').locator('input');
  await muffinInput.fill('0'); await muffinInput.press('Tab'); await page.waitForTimeout(200);
  await page.getByRole('button', { name: 'Write off' }).click(); await page.waitForTimeout(1500);
  ok((await cell('Butter Croissant', 1)) === '48' && (await cell('Butter Croissant', 5)) === '30', 'after write-off: 48 left, 30 written off today');

  // Waste anything: spilled milk
  await page.locator('.p-selectbutton').getByText('Record waste').click(); await page.waitForTimeout(500);
  await page.locator('.p-autocomplete input').fill('Fresh milk'); await page.waitForTimeout(900);
  await page.locator('.p-autocomplete-option', { hasText: 'Fresh milk' }).first().click(); await page.waitForTimeout(300);
  const q = row('Fresh milk').locator('td').nth(1).locator('input'); await q.fill('500'); await q.press('Tab'); await page.waitForTimeout(200);
  ok((await page.locator('.card', { hasText: 'Record waste' }).textContent()).includes('$0.80'), '500 ml milk wasted = $0.80');
  await shot('b5-waste');
  await page.getByRole('button', { name: 'Save waste' }).click(); await page.waitForTimeout(1000);
  ok((await page.locator('.p-toast-message', { hasText: 'Waste recorded' }).count()) === 1, 'waste recorded');

  // Report
  await page.goto(W + '/reports'); await page.waitForSelector('text=Bakery production and waste'); await page.waitForTimeout(1200);
  const rep = page.locator('.card', { hasText: 'Bakery production and waste' });
  const repRow = (await rep.locator('tr', { hasText: 'Butter Croissant' }).textContent()).replace(/\s+/g, ' ');
  ok(repRow.includes('48') && repRow.includes('62.5%') && repRow.includes('$14.64'), 'report: croissants made 48, waste 62.5%, cost $14.64 · ' + repRow);
  ok((await rep.textContent()).includes('Expired') && (await rep.locator('tr', { hasText: 'Fresh milk' }).count()) === 1, 'report: waste by reason, ingredient waste included');
  await rep.scrollIntoViewIfNeeded(); await shot('b6-report');

  // Product settings (admins edit products)
  await page.evaluate(() => localStorage.clear());
  await page.goto(W + '/login'); await page.fill('#email', 'admin@pos.local'); await page.fill('#password', 'Password@123'); await page.click('button[type=submit]');
  await page.waitForTimeout(1500);
  await page.goto(W + '/products'); await page.waitForTimeout(1000);
  await page.locator('.p-datatable-tbody tr', { hasText: 'Butter Croissant' }).first().click(); await page.waitForTimeout(500);
  ok((await page.locator('.p-dialog .bake').count()) === 1 && (await page.locator('.p-dialog .bake input').first().inputValue()) === '24', 'product form: made here, 24 pieces per batch');

  console.log('page errors:', errors.length, errors.slice(0, 5));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  await browser.close();
})();
