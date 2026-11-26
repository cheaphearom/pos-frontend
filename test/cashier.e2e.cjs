// Copyright (c) 2026 Chea Phearom. All rights reserved.
// Proprietary and confidential: see the LICENSE file.
// Browser test: a cashier stays on the POS. Their other pages (Sales, Bakery production) open without the admin
// portal menu, with "Back to POS"; portal addresses go back to the POS; a manager still gets the portal.
// Needs: fresh seed data, API on :3000, vite preview on :4173, Playwright.
const { chromium } = require('playwright');
const OUT = process.env.SHOTS_DIR ? process.env.SHOTS_DIR + '/' : null;
const W = 'http://localhost:4173';
let fails = 0; const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const login = async (email) => {
    const page = await (await browser.newContext({ viewport: { width: 1366, height: 820 } })).newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
    await page.goto(W + '/login'); await page.fill('#email', email); await page.fill('#password', 'Password@123'); await page.click('button[type=submit]');
    await page.waitForTimeout(1500);
    return page;
  };

  const c = await login('cashier1@pos.local');
  ok(c.url() === W + '/pos', 'cashier lands on the POS');
  await c.waitForSelector('.tile');
  await c.getByRole('button', { name: 'Sales', exact: true }).click(); await c.waitForURL(W + '/sales'); await c.waitForTimeout(800);
  ok(await c.locator('.sidebar').count() === 0, 'Sales opens without the portal menu');
  ok(await c.locator('[data-test=back-to-pos]').isVisible(), '"Back to POS" button is shown');
  ok(await c.getByRole('button', { name: 'Open POS' }).count() === 0, 'no "Open POS" portal button');
  const links = (await c.locator('.cashier-links .c-link').allInnerTexts()).map((t) => t.trim());
  ok(links.join(',') === 'Sales,Barista screen,Bakery production', 'only their pages are linked: ' + links.join(', '));
  if (OUT) await c.screenshot({ path: OUT + 'cashier-sales.png' });
  await c.locator('.cashier-links .c-link', { hasText: 'Bakery production' }).click(); await c.waitForURL(W + '/production'); await c.waitForTimeout(500);
  ok(await c.locator('.sidebar').count() === 0 && await c.locator('[data-test=back-to-pos]').isVisible(), 'Bakery production: no portal menu, Back to POS');
  await c.locator('[data-test=back-to-pos]').click(); await c.waitForURL(W + '/pos');
  ok(true, '"Back to POS" returns to the POS');
  for (const path of ['/', '/products', '/reports', '/customers', '/shifts']) {
    await c.goto(W + path); await c.waitForTimeout(800);
    ok(c.url() === W + '/pos', `${path} sends the cashier back to the POS`);
  }

  const mgr = await login('manager.pp@pos.local');
  await mgr.goto(W + '/sales'); await mgr.waitForTimeout(800);
  ok(await mgr.locator('.sidebar').count() === 1 && await mgr.locator('[data-test=back-to-pos]').count() === 0, 'a manager still gets the portal menu');

  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})();
