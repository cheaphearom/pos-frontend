// Copyright (c) 2026 Chea Phearom. All rights reserved.
// Proprietary and confidential: see the LICENSE file.
// Browser test: a coupon only for some categories / products (admin form, POS cart, server total, refusals).
// Needs: fresh seed data, API on :3000, vite preview on :4173, Playwright.
const { chromium } = require('playwright');
const OUT = process.env.SHOTS_DIR ? process.env.SHOTS_DIR + '/' : null;
const W = 'http://localhost:4173', API = 'http://localhost:3000/api/v1';
let fails = 0; const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const fmt = (n) => '$' + Number(n).toFixed(2);
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const login = async (email) => {
    const page = await (await browser.newContext({ viewport: { width: 1366, height: 860 } })).newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
    await page.goto(W + '/login'); await page.fill('#email', email); await page.fill('#password', 'Password@123'); await page.click('button[type=submit]');
    await page.waitForTimeout(1500);
    return page;
  };
  const shot = (p, n) => (OUT ? p.screenshot({ path: OUT + n + '.png' }) : null);

  // ── 1. Admin: a 50% coupon for the Bakery category only
  const ad = await login('admin@pos.local');
  await ad.goto(W + '/coupons'); await ad.waitForTimeout(1000);
  await ad.getByRole('button', { name: 'New coupon' }).click(); await ad.waitForTimeout(300);
  const dlg = ad.locator('.p-dialog');
  await dlg.locator('input').first().fill('Bakery half price');
  await dlg.locator('.field', { hasText: 'Percent' }).locator('input').fill(''); await dlg.locator('.field', { hasText: 'Percent' }).locator('input').pressSequentially('50');
  await dlg.locator('input[placeholder="e.g. SAVE10"]').fill('BAKE50');
  ok(await dlg.locator('[data-test=coupon-items]').count() === 1, 'New coupon has an "Items" choice');
  await dlg.getByText('Only some categories / products').click(); await ad.waitForTimeout(200);
  await dlg.getByRole('button', { name: 'Create' }).click(); await ad.waitForTimeout(600);
  ok(await ad.getByText('Choose the categories or products the coupon is for').count() > 0, '"Only some" with nothing chosen is refused');
  await dlg.locator('.field', { hasText: 'Categories' }).locator('.p-multiselect').click(); await ad.waitForTimeout(300);
  await ad.locator('.p-multiselect-overlay .p-multiselect-option', { hasText: /^Bakery$/ }).click(); await ad.keyboard.press('Escape'); await ad.waitForTimeout(200);
  ok((await dlg.locator('.secret').textContent()).trim() === '50% off · selected items only', 'form preview: "50% off · selected items only"');
  await shot(ad, 'ci1-new-coupon');
  await dlg.getByRole('button', { name: 'Create' }).click(); await ad.waitForTimeout(1000);
  ok(await dlg.count() === 0, 'coupon created');
  const row = ad.locator('.p-datatable-tbody tr', { hasText: 'Bakery half price' });
  ok((await row.textContent()).includes('selected items only'), 'list says "selected items only"');
  await row.click(); await ad.waitForTimeout(1000);
  ok(/Categories: Bakery/.test(await ad.locator('[data-test=coupon-items-detail]').textContent()), 'details show Categories: Bakery');
  await shot(ad, 'ci2-detail');

  // ── 2. POS: rice (no category match) + croissant (Bakery)
  const pos = await login('cashier1@pos.local');
  await pos.waitForSelector('.tile'); await pos.waitForTimeout(800);
  if (await pos.getByRole('button', { name: 'Open shift' }).count()) { await pos.getByRole('button', { name: 'Open shift' }).click(); await pos.locator('.p-dialog input').first().fill('50'); await pos.locator('.p-dialog button[type=submit]').click(); await pos.waitForTimeout(600); }
  const tok = await pos.evaluate(() => localStorage.getItem('pos.accessToken'));
  const get = async (p) => (await fetch(API + p, { headers: { Authorization: 'Bearer ' + tok } })).json();
  const s = pos.locator('.search-input');
  const scan = async (c) => { await s.fill(c); await s.press('Enter'); await pos.waitForTimeout(800); };
  const total = async () => (await pos.locator('.r.total .num').textContent()).trim();
  const payCash = async () => { await pos.keyboard.press('F9'); await pos.waitForSelector('.pay'); await pos.locator('.quick button').first().click(); await pos.locator('[data-test=complete-sale]').click({ timeout: 3000 }).catch(() => {}).then(() => pos.waitForSelector('text=Sale complete', { timeout: 10000 })); };

  // only rice: refused
  await scan('SKU-0017');
  await scan('BAKE50');
  ok(await pos.getByText('None of the items in this sale can use this coupon').count() > 0, 'only non-bakery items: coupon refused');

  // add a croissant: 50% of the croissant only
  await pos.locator('.tile', { hasText: 'Butter Croissant' }).click(); await pos.waitForTimeout(400);
  ok(await pos.locator('.coupon-row').count() === 1 && (await pos.locator('.coupon-row').textContent()).includes('−$0.75'), 'coupon takes 50% of the croissant only: −$0.75 (' + (await pos.locator('.coupon-row').textContent()).replace(/\s+/g, ' ').trim() + ')');
  const shown = await total();
  await shot(pos, 'ci3-pos');
  await payCash();
  const sale = await get('/sales/' + (await get('/sales?limit=1')).data[0].id);
  ok(fmt(sale.couponDiscount) === '$0.75' && fmt(sale.total) === shown, `server charged the same: coupon ${fmt(sale.couponDiscount)}, total ${fmt(sale.total)} = POS ${shown}`);
  await pos.keyboard.press('Enter');

  // ── 3. Server refuses it too (online order quote / API), with the same reason
  const store = (await get('/stores/directory')).find((x) => x.code === 'PP01') ?? (await get('/stores/directory'))[0];
  const rice = (await get('/products?search=SKU-0017')).data?.[0] ?? (await get('/products?search=SKU-0017'))[0];
  const res = await fetch(API + '/sales', { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'content-type': 'application/json' }, body: JSON.stringify({ storeId: store.id, clientRef: 'ci-test-1', items: [{ productId: rice.id, quantity: 1 }], couponCode: 'BAKE50', payments: [{ method: 'CASH', amount: 100 }] }) });
  const body = await res.json();
  ok(res.status === 400 && /None of the items/.test(JSON.stringify(body)), 'API refuses the coupon on a sale without bakery items');

  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})();
