// Copyright (c) 2026 Chea Phearom. All rights reserved.
// Proprietary and confidential: see the LICENSE file.
// Browser test: Reports page, busy hours, sales by category and the change vs the period before.
// Needs: fresh seed data, API on :3000, vite preview on :4173, Playwright. Makes a few sales itself.
const { chromium } = require('playwright');
const OUT = process.env.SHOTS_DIR ? process.env.SHOTS_DIR + '/' : null;
const W = 'http://localhost:4173', API = 'http://localhost:3000/api/v1';
let fails = 0; const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const near = (a, b) => Math.abs(a - b) < 0.02;
(async () => {
  const call = async (m, p, tok, body) => (await fetch(API + p, { method: m, headers: { 'content-type': 'application/json', ...(tok && { authorization: 'Bearer ' + tok }) }, body: body && JSON.stringify(body) })).json();
  // a few sales as the cashier
  const { accessToken: ct } = await call('POST', '/auth/login', null, { email: 'cashier1@pos.local', password: 'Password@123' });
  const storeId = (await call('GET', '/auth/me', ct)).stores[0].id;
  await call('POST', '/shifts/open', ct, { storeId, openingCash: 50 });
  const prods = (await call('GET', `/products?storeId=${storeId}&limit=100`, ct)).data.filter((p) => p.barcode && p.isActive && !p.isIngredient);
  for (let i = 0; i < 6; i++) {
    await call('POST', '/sales', ct, { storeId, items: [{ productId: prods[i * 3 % prods.length].id, quantity: 1 + (i % 2) }], payments: [{ method: 'CASH', amount: 200 }] });
  }

  // the API numbers agree with each other
  const { accessToken: at } = await call('POST', '/auth/login', null, { email: 'admin@pos.local', password: 'Password@123' });
  const q = `storeId=${storeId}`;
  const [sum, hours, cats, profit] = await Promise.all(['sales-summary', 'hours', 'categories', 'profit'].map((r) => call('GET', `/reports/${r}?${q}`, at)));
  ok(sum.totals.salesCount === 6, 'summary: 6 sales');
  ok(hours.data.reduce((t, x) => t + x.salesCount, 0) === sum.totals.salesCount, 'busy hours count every sale (' + hours.data.reduce((t, x) => t + x.salesCount, 0) + ')');
  ok(near(hours.data.reduce((t, x) => t + x.net, 0), sum.totals.net), 'busy hours net = net sales');
  ok(Object.values(hours.days).reduce((a, b) => a + b, 0) === 30, 'the default period has 30 days, split by weekday');
  const catRev = cats.data.reduce((t, x) => t + x.revenue, 0), profRev = profit.data.reduce((t, x) => t + x.revenue, 0);
  ok(cats.data.length > 0 && near(catRev, profRev), `categories add up to the profit revenue (${catRev.toFixed(2)})`);
  ok(Math.abs(cats.data.reduce((t, x) => t + x.sharePercent, 0) - 100) < 0.1, 'category shares add up to 100% (rounded)');

  // the page
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.goto(W + '/login'); await page.fill('#email', 'admin@pos.local'); await page.fill('#password', 'Password@123'); await page.click('button[type=submit]');
  await page.waitForTimeout(1500); await page.goto(W + '/reports'); await page.waitForSelector('[data-test=busy-hours]'); await page.waitForTimeout(1500);

  const net = await page.locator('[data-test=card-net]').innerText();
  ok(/new\s+vs the 30 days before/.test(net), 'net sales card compares with the 30 days before ("new": nothing before)');
  const heat = page.locator('[data-test=busy-hours] .heat td');
  ok(await heat.count() > 0 && (await page.locator('[data-test=busy-hours] .heat td:not(:empty)').count()) > 0, 'busy hours heat map has filled cells');
  ok(/Busiest hour: \d\d:00–\d\d:00/.test(await page.locator('[data-test=busy-hours]').innerText()), 'busiest hour is named');
  ok(await page.locator('[data-test=categories] .p-datatable-tbody tr').count() === cats.data.length, `category table: ${cats.data.length} rows`);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('[data-test=categories]').getByRole('button', { name: 'CSV' }).click()]);
  ok(dl.suggestedFilename().startsWith('categories-'), 'category CSV downloads');
  if (OUT) await page.locator('[data-test=busy-hours]').screenshot({ path: OUT + 'rep-hours.png' });

  // "Today" → compared with yesterday
  await page.getByRole('button', { name: 'Today' }).click(); await page.waitForTimeout(1500);
  ok(/vs the day before/.test(await page.locator('[data-test=card-net]').innerText()), 'Today is compared with the day before');

  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})();
