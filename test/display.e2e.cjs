const { chromium } = require('playwright');
// Browser test: customer display (second screen) driven by the POS window.
// Needs: fresh seed data, API on :3000 (KHQR_MODE=manual), vite preview on :4173, Playwright.
const OUT = process.env.SHOTS_DIR ? process.env.SHOTS_DIR + '/' : null;
const W = 'http://localhost:4173';
let fails = 0; const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 820 } });
  const errors = [];
  ctx.on('page', (p) => { p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_INTERNET/.test(m.text()) && errors.push(m.text())); });
  const pos = await ctx.newPage();
  await pos.goto(W + '/login'); await pos.fill('#email', 'cashier1@pos.local'); await pos.fill('#password', 'Password@123'); await pos.click('button[type=submit]');
  await pos.waitForURL(W + '/pos'); await pos.waitForSelector('.tile'); await pos.waitForTimeout(1200);
  if (await pos.getByRole('button', { name: 'Open shift' }).count()) { await pos.getByRole('button', { name: 'Open shift' }).click(); await pos.locator('.p-dialog input').first().fill('50'); await pos.locator('.p-dialog button[type=submit]').click(); await pos.waitForTimeout(600); }

  const [disp] = await Promise.all([ctx.waitForEvent('page'), pos.getByRole('button', { name: 'Customer display' }).click()]);
  await disp.setViewportSize({ width: 1280, height: 800 });
  await disp.waitForLoadState(); await disp.waitForTimeout(1500);
  ok(await disp.getByText('Welcome to Phnom Penh - Central').count() === 1, 'display opens on the welcome screen with the store name');
  ok(await disp.locator('.promo-card').count() === 1, 'welcome screen shows a running promotion');
  ok(await pos.getByRole('button', { name: 'Display on' }).count() === 1, 'POS shows the display is connected');
  await (OUT ? disp.screenshot({ path: OUT + '40-display-idle.png' }) : null);

  const s = pos.locator('.search-input');
  await s.fill('SKU-0002'); await s.press('Enter');
  await s.fill('3*SKU-0011'); await s.press('Enter');
  await s.fill('SKU-0020'); await s.press('Enter');
  await disp.waitForTimeout(600);
  const posTotal = (await pos.locator('.r.total .num').textContent()).trim();
  const dispTotal = (await disp.locator('.total b').textContent()).trim();
  ok((await disp.locator('.line').count()) === 3, 'display lists the 3 scanned items live');
  ok(posTotal === dispTotal, `display total ${dispTotal} = POS total ${posTotal}`);
  ok((await disp.locator('.ln-promo').count()) === 2 && (await disp.getByText(/You save/).count()) === 1, 'display shows promotions and "You save"');
  await (OUT ? disp.screenshot({ path: OUT + '41-display-cart.png' }) : null);

  await pos.keyboard.press('F9'); await pos.waitForSelector('.pay');
  await pos.locator('.method', { hasText: 'KHQR' }).click();
  await pos.getByRole('button', { name: /Show KHQR/ }).click();
  await disp.waitForSelector('.khqr-card img', { timeout: 8000 }); await disp.waitForTimeout(500);
  ok(await disp.getByText('Scan to pay').count() === 1, 'KHQR appears big on the customer display');
  await (OUT ? disp.screenshot({ path: OUT + '42-display-khqr.png' }) : null);
  await pos.getByRole('button', { name: 'Customer has paid' }).click();
  await pos.waitForSelector('text=Sale complete'); await disp.waitForTimeout(600);
  ok(await disp.getByText('Thank you!').count() === 1, 'display says thank you after payment');
  await pos.keyboard.press('Enter');

  // cash with change
  await s.fill('SKU-0017'); await s.press('Enter');
  await pos.keyboard.press('F9'); await pos.waitForSelector('.pay');
  await pos.locator('.quick button').last().click();
  await pos.waitForSelector('text=Sale complete'); await disp.waitForTimeout(600);
  const change = (await disp.locator('.change b').textContent().catch(() => '')).trim();
  ok(!!change && change !== '$0.00', 'display shows change to give: ' + change);
  await (OUT ? disp.screenshot({ path: OUT + '43-display-thanks.png' }) : null);
  await pos.keyboard.press('Enter');

  // offline: still updates (no server involved)
  await ctx.setOffline(true);
  await s.fill('SKU-0005'); await s.press('Enter'); await disp.waitForTimeout(500);
  ok((await disp.locator('.line').count()) === 1, 'display keeps working offline');
  await ctx.setOffline(false);

  // POS reload: display reconnects and shows the cart again
  await pos.reload(); await pos.waitForSelector('.tile'); await pos.waitForTimeout(1500);
  ok((await disp.locator('.line').count()) === 1 && (await pos.getByRole('button', { name: 'Display on' }).count()) === 1, 'after POS reload the display reconnects');
  await disp.close(); await pos.waitForTimeout(12500);
  ok(await pos.getByRole('button', { name: 'Customer display' }).count() === 1, 'closing the display is noticed by the POS');

  // portrait tablet-style display
  const d2 = await ctx.newPage(); await d2.setViewportSize({ width: 800, height: 1280 });
  await d2.goto(W + '/display?store=' + (await pos.evaluate(() => localStorage.getItem('pos.currentStoreId')))); await d2.waitForTimeout(1500);
  await (OUT ? d2.screenshot({ path: OUT + '44-display-portrait.png' }) : null);

  console.log('page errors:', errors.length, errors.slice(0, 5));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  await browser.close();
})();
