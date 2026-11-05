const { chromium } = require('playwright');
// End-to-end test of the POS screen, including offline mode.
// Needs: API on :3000 with seed data, `npm run build && npx vite preview` on :4173, and Playwright installed.
// Run: node test/pos.e2e.cjs
const OUT = process.env.SHOTS_DIR ? process.env.SHOTS_DIR + '/' : null;
const W = 'http://localhost:4173', API = 'http://localhost:3000/api/v1';
let fails = 0; const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 820 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(m.text()) && errors.push(m.text()));
  const shot = (n) => (OUT ? page.screenshot({ path: OUT + n + '.png' }) : Promise.resolve());
  const total = async () => (await page.locator('.r.total .num').textContent()).trim();

  await page.goto(W + '/login');
  await page.fill('#email', 'cashier1@pos.local'); await page.fill('#password', 'Password@123');
  await page.click('button[type=submit]');
  await page.waitForURL(W + '/pos'); ok(true, 'cashier lands on /pos');
  await page.waitForSelector('.tile'); ok((await page.locator('.tile').count()) > 10, `product tiles shown: ${await page.locator('.tile').count()}`);

  // open shift if needed
  if (await page.getByRole('button', { name: 'Open shift' }).count()) {
    await page.getByRole('button', { name: 'Open shift' }).click();
    await page.locator('.p-dialog input').fill('100'); await page.locator('.p-dialog button[type=submit]').click();
    await page.waitForTimeout(600);
  }
  ok(await page.getByText(/Shift since/).count() > 0, 'shift is open');

  // scan barcode, multiplier, tap tile
  const s = page.locator('.search-input');
  await s.fill('885000000001'); await s.press('Enter');
  await s.fill('3*SKU-0002'); await s.press('Enter');
  await page.locator('.tile', { hasText: 'Bananas' }).click();
  await page.waitForTimeout(300);
  ok((await page.locator('.line').count()) === 3, 'scan + 3*code + tap = 3 cart lines');
  ok((await page.locator('.line').nth(1).locator('.qty span').textContent()).trim() === '3', 'multiplier sets quantity 3');
  // edit bananas weight to 1.25 kg
  await page.locator('.line').nth(2).locator('.ln-edit').click();
  await page.locator('.p-dialog input').first().fill('1.25'); await page.locator('.p-dialog button[type=submit]').click();
  await page.waitForTimeout(300);

  // member + redeem 50 points
  await page.keyboard.press('F4');
  await page.locator('.p-dialog input').fill('012345678'); await page.locator('.p-dialog button[type=submit]').click();
  await page.waitForTimeout(800);
  ok((await page.locator('.cust').textContent()).includes('Chea Sokunthea'), 'member attached');
  await page.locator('.redeem input').fill('50'); await page.locator('.redeem input').press('Tab');
  await page.waitForTimeout(300);
  const shownTotal = await total();
  await shot('20-pos-cart');

  // pay with quick cash
  await page.keyboard.press('F9');
  await page.waitForSelector('.pay');
  await shot('21-pos-payment');
  await page.locator('.quick button').last().click();
  await page.waitForSelector('text=Sale complete');
  await page.waitForTimeout(500);
  await shot('22-pos-receipt');
  const rec = await page.locator('.receipt-box').textContent();
  const receiptNo = /(PP01-\d{8})/.exec(rec)?.[1];
  ok(!!receiptNo, 'server receipt number ' + receiptNo);

  // compare with server
  const tok = await page.evaluate(() => localStorage.getItem('pos.accessToken'));
  const sale = await (await fetch(`${API}/sales/${receiptNo}`, { headers: { Authorization: 'Bearer ' + tok } })).json();
  const fmt = (n) => '$' + Number(n).toFixed(2);
  ok(fmt(sale.amountDue) === shownTotal, `screen total ${shownTotal} = server amount due ${fmt(sale.amountDue)} (total ${sale.total}, points ${sale.pointsRedeemed})`);
  ok(sale.pointsRedeemed === 50 && sale.customer, 'points redeemed on server');
  ok(sale.items.map((i) => i.quantity).join(',') === '1,3,1.25', 'quantities saved: ' + sale.items.map((i) => i.quantity).join(','));
  await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  ok((await page.locator('.line').count()) === 0, 'Enter starts a new sale (cart empty)');

  // ── OFFLINE ──
  await page.reload(); await page.waitForSelector('.tile'); await page.waitForTimeout(1500); // let the service worker take control & cache
  await ctx.setOffline(true);
  await page.waitForTimeout(300);
  ok(await page.getByText('OFFLINE').count() > 0, 'offline badge shown');
  await s.fill('885000000005'); await s.press('Enter');
  await s.fill('2*885000000010'); await s.press('Enter');
  const offTotal = await total();
  await page.keyboard.press('F9'); await page.waitForSelector('.pay');
  await page.locator('.quick button').first().click(); // exact cash
  await page.waitForSelector('text=Sale complete');
  ok((await page.locator('.receipt-box').textContent()).includes('OFF-'), 'offline receipt number shown');
  await shot('23-pos-offline-receipt');
  await page.keyboard.press('Enter');
  ok((await page.getByRole('button', { name: /1 to upload/ }).count()) === 1, 'queue shows 1 sale to upload');

  // reload while offline: app must still open from the service worker + IndexedDB
  await page.reload();
  await page.waitForSelector('.tile', { timeout: 10000 }).catch(() => {});
  ok((await page.locator('.tile').count()) > 10, 'reload while OFFLINE still shows products');
  ok((await page.getByRole('button', { name: /1 to upload/ }).count()) === 1, 'queued sale survived the reload');
  await shot('24-pos-offline');

  // back online: auto-upload
  await ctx.setOffline(false);
  await page.waitForFunction(() => !document.body.innerText.includes('to upload'), null, { timeout: 15000 }).catch(() => {});
  ok((await page.getByRole('button', { name: /to upload/ }).count()) === 0, 'queue emptied after reconnect');
  const list = await (await fetch(`${API}/sales?limit=3&storeId=${sale.store.id}`, { headers: { Authorization: 'Bearer ' + tok } })).json();
  const latest = await (await fetch(`${API}/sales/${list.data[0].id}`, { headers: { Authorization: 'Bearer ' + tok } })).json();
  ok(fmt(latest.total) === offTotal && latest.items.length === 2, `offline sale on server: ${latest.receiptNo} total ${fmt(latest.total)} (screen ${offTotal})`);
  // resend same clientRef must not duplicate
  const again = await (await fetch(`${API}/sales`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ storeId: sale.store.id, clientRef: latest.clientRef, items: [{ productId: latest.items[0].productId, quantity: 1 }], payments: [{ method: 'CASH', amount: 100 }] }) })).json();
  ok(again.id === latest.id, 'resending the same offline sale returns the same sale (no duplicate)');

  // hold & recall
  await s.fill('885000000003'); await s.press('Enter');
  await page.getByRole('button', { name: 'Hold', exact: true }).click();
  ok((await page.locator('.line').count()) === 0, 'hold clears cart');
  await page.getByRole('button', { name: /Held \(1\)/ }).click(); await page.getByRole('button', { name: 'Recall' }).click();
  ok((await page.locator('.line').count()) === 1, 'recall restores cart');

  // mobile/tablet layout
  await page.setViewportSize({ width: 820, height: 1180 }); await page.waitForTimeout(400); await shot('25-pos-tablet');
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  ok(sw <= 820, 'tablet: no horizontal scroll (' + sw + ')');

  console.log('page errors:', errors.length, errors.slice(0, 5));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  await browser.close();
})();
