// Browser test: cash in / out at the POS (cash out with manager PIN), X report, close the shift, Z report.
// Needs: fresh seed data (manager.pp PIN 2580, 4100 riel = $1), API on :3000, vite preview on :4173, Playwright.
const { chromium } = require('playwright');
const OUT = process.env.SHOTS_DIR ? process.env.SHOTS_DIR + '/' : null;
const W = 'http://localhost:4173';
let fails = 0; const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = (p) => { p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text())); p.on('dialog', (d) => d.accept()); return p; };
  const pos = watch(await (await browser.newContext({ viewport: { width: 1366, height: 860 } })).newPage());
  const shot = (n, p = pos) => (OUT ? p.screenshot({ path: OUT + n + '.png' }) : null);
  const text = async (p, sel) => (await p.locator(sel).first().textContent()).replace(/\s+/g, ' ').trim();

  await pos.goto(W + '/login'); await pos.fill('#email', 'cashier1@pos.local'); await pos.fill('#password', 'Password@123'); await pos.click('button[type=submit]');
  await pos.waitForURL(W + '/pos'); await pos.waitForSelector('.tile'); await pos.waitForTimeout(1500);
  await pos.getByRole('button', { name: 'Open shift' }).click(); await pos.locator('.p-dialog input').first().fill('50'); await pos.locator('.p-dialog button[type=submit]').click(); await pos.waitForTimeout(800);

  // Cash out $5 (needs the manager PIN)
  await pos.getByRole('button', { name: 'Cash in/out' }).click(); await pos.waitForTimeout(300);
  await pos.locator('.p-dialog .p-inputnumber input').first().fill('5'); await pos.locator('.p-dialog .p-inputnumber input').first().press('Tab');
  await pos.locator('.p-dialog input[placeholder*="Ice"]').fill('Ice delivery');
  await shot('z0-cash-out');
  await pos.getByRole('button', { name: 'Take out' }).click(); await pos.waitForSelector('.pad');
  for (const d of '2580') await pos.locator('.pad button', { hasText: new RegExp(`^${d}$`) }).click();
  await pos.getByRole('button', { name: 'Approve' }).click(); await pos.waitForTimeout(1000);
  ok((await pos.locator('.p-toast-message', { hasText: 'Cash out recorded' }).count()) === 1, 'cash out $5 recorded with the manager PIN');

  // Cash in 10,000 riel
  await pos.getByRole('button', { name: 'Cash in/out' }).click(); await pos.waitForTimeout(300);
  await pos.locator('.p-dialog .p-selectbutton').first().getByText('Cash in').click();
  await pos.locator('.p-dialog .p-selectbutton').nth(1).getByText('Riel').click(); await pos.waitForTimeout(200);
  await pos.locator('.p-dialog .p-inputnumber input').first().fill('10000'); await pos.locator('.p-dialog .p-inputnumber input').first().press('Tab');
  await pos.locator('.p-dialog input[placeholder*="float"]').fill('Riel float');
  await pos.getByRole('button', { name: 'Put in' }).click(); await pos.waitForTimeout(900);
  ok((await pos.locator('.p-toast-message', { hasText: 'Cash in recorded' }).count()) === 1, 'cash in 10,000 riel recorded');

  // X report: $50 - $5 = $45, riel 10,000
  await pos.getByRole('button', { name: 'X report' }).click(); await pos.waitForSelector('[data-test=reg-report]');
  ok((await text(pos, '[data-test=x-expected]')) === '$45.00' && (await text(pos, '[data-test=x-expected-khr]')) === '៛10,000', 'X report: expected $45.00 and ៛10,000');
  const xr = await text(pos, '[data-test=reg-report]');
  ok(xr.includes('X REPORT') && xr.includes('Ice delivery') && xr.includes('Sokha Chan'), 'X report lists the cash out and the approving manager');
  await shot('z1-x-report');
  await pos.keyboard.press('Escape'); await pos.waitForTimeout(300);

  // Close the shift (counted $45 / ៛10,000)
  await pos.goto(W + '/shifts'); await pos.waitForTimeout(1200);
  await pos.locator('.p-datatable-tbody tr').first().click(); await pos.waitForTimeout(600);
  await pos.getByRole('button', { name: 'Close shift' }).click(); await pos.waitForTimeout(400);
  await pos.locator('.p-dialog button[type=submit]').click(); await pos.waitForTimeout(1000);
  ok((await pos.locator('.p-dialog').textContent()).includes('The drawer balances.'), 'shift closed, drawer balances');

  // Manager: Z report
  const mg = watch(await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage());
  await mg.goto(W + '/login'); await mg.fill('#email', 'manager.pp@pos.local'); await mg.fill('#password', 'Password@123'); await mg.click('button[type=submit]');
  await mg.waitForTimeout(1500);
  await mg.goto(W + '/z-reports'); await mg.waitForSelector('[data-test=z-preview]'); await mg.waitForTimeout(500);
  ok(!(await mg.locator('[data-test=run-z]').isDisabled()), 'all shifts closed: Run Z report is available');
  await shot('z2-z-page', mg);
  await mg.locator('[data-test=run-z]').click(); await mg.waitForSelector('[data-test=reg-report]'); await mg.waitForTimeout(500);
  const zr = await text(mg, '[data-test=reg-report]');
  ok(zr.includes('Z REPORT PP01-Z0001') && zr.includes('Srey Mom') && zr.includes('Ice delivery'), 'Z report PP01-Z0001 with the shift and the cash out');
  await shot('z3-z-report', mg);
  await mg.keyboard.press('Escape'); await mg.waitForTimeout(500);
  ok((await mg.locator('.p-datatable-tbody tr', { hasText: 'PP01-Z0001' }).count()) === 1, 'Z list shows PP01-Z0001');
  ok(await mg.locator('[data-test=run-z]').isDisabled() && (await mg.locator('.p-message', { hasText: 'This day is closed' }).count()) === 1, 'day closed: cannot run the Z report again');

  console.log('page errors:', errors.length, errors.slice(0, 5));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  await browser.close();
})();
