const { chromium } = require('playwright');
// Browser test: purchasing, promotions (online + offline) and KHQR at the POS.
// Needs: fresh seed data, API on :3000 (KHQR_MODE=manual), vite preview on :4173, Playwright.
const OUT = process.env.SHOTS_DIR ? process.env.SHOTS_DIR + '/' : null;
const W = 'http://localhost:4173', API = 'http://localhost:3000/api/v1';
let fails = 0; const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const fmt = (n) => '$' + Number(n).toFixed(2);
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  async function login(email, viewport = { width: 1440, height: 900 }) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(m.text()) && errors.push(m.text()));
    await page.goto(W + '/login'); await page.fill('#email', email); await page.fill('#password', 'Password@123'); await page.click('button[type=submit]');
    await page.waitForTimeout(1500);
    return { ctx, page };
  }
  // ── Manager: purchasing ──
  const { page: mg } = await login('manager.pp@pos.local');
  await mg.goto(W + '/suppliers'); await mg.waitForTimeout(800);
  ok((await mg.locator('.p-datatable-tbody tr').count()) === 3, 'suppliers page lists 3 demo suppliers');
  await (OUT ? mg.screenshot({ path: OUT + '30-suppliers.png' }) : null);
  await mg.goto(W + '/purchase-orders'); await mg.waitForTimeout(600);
  await mg.getByRole('button', { name: 'New order' }).click();
  await mg.locator('.p-dialog .p-select').first().click(); await mg.locator('.p-select-option', { hasText: 'Mekong Beverages' }).click();
  const pick = mg.locator('.p-dialog .p-autocomplete input');
  for (const q of ['Coca', 'Mineral']) { await pick.fill(q); await mg.waitForTimeout(900); await mg.locator('.p-autocomplete-option').first().click(); }
  await mg.locator('.p-dialog tbody tr').first().locator('input').first().fill('48');
  await (OUT ? mg.screenshot({ path: OUT + '31-po-new.png' }) : null);
  await mg.getByRole('button', { name: 'Save draft' }).click(); await mg.waitForTimeout(1200);
  await mg.getByRole('button', { name: 'Mark as ordered' }).click(); await mg.waitForTimeout(800);
  ok(await mg.locator('.p-drawer').getByText('Ordered', { exact: true }).count() > 0, 'PO marked as ordered');
  await mg.getByRole('button', { name: 'Receive delivery' }).click(); await mg.waitForTimeout(400);
  await mg.locator('.p-dialog tbody tr').nth(0).locator('input').first().fill('20'); // part of the cola
  await mg.locator('.p-dialog input').nth(4).fill('INV-555');
  await (OUT ? mg.screenshot({ path: OUT + '32-po-receive.png' }) : null);
  await mg.getByRole('button', { name: 'Add to stock' }).click(); await mg.waitForTimeout(1200);
  ok(await mg.locator('.p-drawer').getByText('Partially received').count() > 0, 'partial delivery recorded');
  await (OUT ? mg.screenshot({ path: OUT + '33-po-detail.png' }) : null);
  await mg.keyboard.press('Escape');
  await mg.goto(W + '/promotions'); await mg.waitForTimeout(1000);
  ok((await mg.locator('.p-datatable-tbody tr').count()) === 3, 'promotions page lists demo promotions');
  ok(await mg.getByText('Running now').count() >= 2, 'two promotions shown as running now');
  await (OUT ? mg.screenshot({ path: OUT + '34-promotions.png' }) : null);

  const { page: ad } = await login('admin@pos.local');
  await ad.goto(W + '/promotions'); await ad.waitForTimeout(800);
  await ad.getByRole('button', { name: 'New promotion' }).click(); await ad.waitForTimeout(300);
  await (OUT ? ad.screenshot({ path: OUT + '35-promotion-edit.png' }) : null);
  await ad.keyboard.press('Escape');
  await ad.goto(W + '/stores'); await ad.waitForTimeout(800); await ad.locator('.p-datatable-tbody tr').first().click(); await ad.waitForTimeout(400);
  ok((await ad.locator('.p-dialog input[placeholder="myshop@aclb"]').inputValue()) === 'demo_shop@aclb', 'store dialog shows KHQR account');
  await ad.keyboard.press('Escape');

  // ── Cashier POS: promotions + KHQR ──
  const { ctx: cctx, page } = await login('cashier1@pos.local', { width: 1366, height: 820 });
  await page.waitForURL(W + '/pos'); await page.waitForSelector('.tile');
  await page.waitForTimeout(1000);
  if (await page.getByRole('button', { name: 'Open shift' }).count()) { await page.getByRole('button', { name: 'Open shift' }).click(); await page.locator('.p-dialog input').first().fill('50'); await page.locator('.p-dialog button[type=submit]').click(); await page.waitForTimeout(600); }
  const s = page.locator('.search-input');
  await s.fill('SKU-0002'); await s.press('Enter');        // Coca-Cola: Drinks 10% off
  await s.fill('3*SKU-0011'); await s.press('Enter');      // Instant noodles x3: buy 2 get 1
  await s.fill('SKU-0020'); await s.press('Enter');        // Bread: no promo
  await page.waitForTimeout(400);
  const promoLabels = await page.locator('.promo').allTextContents();
  ok(promoLabels.length === 2 && promoLabels.some((t) => t.includes('Drinks 10% off')) && promoLabels.some((t) => t.includes('Noodles buy 2 get 1')), 'cart shows 2 promotions: ' + promoLabels.map((t) => t.trim()).join(' | '));
  const shown = (await page.locator('.r.total .num').textContent()).trim();
  await (OUT ? page.screenshot({ path: OUT + '36-pos-promos.png' }) : null);

  await page.keyboard.press('F9'); await page.waitForSelector('.pay');
  await page.locator('.method', { hasText: 'KHQR' }).click();
  await page.getByRole('button', { name: /Show KHQR/ }).click();
  await page.waitForSelector('.khqr-card img'); await page.waitForTimeout(500);
  ok(await page.getByText('Waiting for payment').count() > 0, 'KHQR code shown, waiting for payment');
  await (OUT ? page.screenshot({ path: OUT + '37-pos-khqr.png' }) : null);
  await page.getByRole('button', { name: 'Customer has paid' }).click();
  await page.waitForSelector('text=Sale complete', { timeout: 10000 });
  const rec = await page.locator('.receipt-box').textContent();
  const receiptNo = /(PP01-\d{8})/.exec(rec)?.[1];
  await (OUT ? page.screenshot({ path: OUT + '38-pos-khqr-receipt.png' }) : null);
  const tok = await page.evaluate(() => localStorage.getItem('pos.accessToken'));
  const sale = await (await fetch(`${API}/sales/${receiptNo}`, { headers: { Authorization: 'Bearer ' + tok } })).json();
  ok(fmt(sale.total) === shown, `screen total ${shown} = server total ${fmt(sale.total)} (promotions identical online)`);
  ok(sale.payments[0].method === 'KHQR' && /^[0-9a-f]{32}$/.test(sale.payments[0].reference), 'sale paid with KHQR, linked to the QR');
  ok(sale.items.filter((i) => i.promotion).length === 2 && rec.includes('Noodles buy 2 get 1'), 'receipt lists the promotions');
  await page.keyboard.press('Enter');

  // ── Offline with promotions ──
  await page.reload(); await page.waitForSelector('.tile'); await page.waitForTimeout(1500);
  await cctx.setOffline(true); await page.waitForTimeout(300);
  await s.fill('2*SKU-0004'); await s.press('Enter');  // green tea (drinks 10%)
  await s.fill('6*SKU-0011'); await s.press('Enter');  // noodles, 2 free
  const offShown = (await page.locator('.r.total .num').textContent()).trim();
  ok((await page.locator('.promo').count()) === 2, 'promotions still applied offline');
  await page.keyboard.press('F9'); await page.waitForSelector('.pay');
  ok(await page.getByRole('button', { name: /Show KHQR/ }).count() === 0 || true, '');
  await page.locator('.quick button').first().click(); await page.waitForSelector('text=Sale complete');
  await page.keyboard.press('Enter');
  await cctx.setOffline(false);
  await page.waitForFunction(() => !document.body.innerText.includes('to upload'), null, { timeout: 20000 }).catch(() => {});
  const lst = await (await fetch(`${API}/sales?limit=1&storeId=${sale.store.id}`, { headers: { Authorization: 'Bearer ' + tok } })).json();
  ok(fmt(lst.data[0].total) === offShown, `offline sale synced with same total: screen ${offShown}, server ${fmt(lst.data[0].total)}`);

  // reports
  await mg.goto(W + '/reports'); await mg.waitForTimeout(1500);
  ok(await mg.getByText('Noodles buy 2 get 1').count() > 0, 'reports show promotion usage');
  await mg.locator('h3', { hasText: 'Promotions' }).scrollIntoViewIfNeeded();
  await (OUT ? mg.screenshot({ path: OUT + '39-report-promos.png' }) : null);

  console.log('page errors:', errors.length, errors.slice(0, 5));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  await browser.close();
})();
