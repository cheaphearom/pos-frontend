// Copyright (c) 2026 Chea Phearom. All rights reserved.
// Proprietary and confidential: see the LICENSE file.
// Browser test: New product, choose the stores that sell it.
// Needs: fresh seed data (3 stores), API on :3000, vite preview on :4173, Playwright.
const { chromium } = require('playwright');
const OUT = process.env.SHOTS_DIR ? process.env.SHOTS_DIR + '/' : null;
const W = 'http://localhost:4173';
const API = 'http://localhost:3000/api/v1';
let fails = 0; const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  const dlg = page.locator('.p-dialog');
  const sold = dlg.locator('[data-test=sold-in]');

  // the stores that sell a product, from the API
  const { accessToken } = await (await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@pos.local', password: 'Password@123' }) })).json();
  const get = async (path) => (await fetch(API + path, { headers: { authorization: 'Bearer ' + accessToken } })).json();
  const stores = await get('/stores');
  const code = (id) => (Array.isArray(stores) ? stores : stores.items).find((s) => s.id === id)?.code;
  async function soldIn(sku) {
    const list = await get('/products?search=' + sku);
    const p = (list.items ?? list.data ?? list).find((x) => x.sku === sku);
    const d = await get('/products/' + p.id);
    return d.inventory.filter((i) => i.isListed).map((i) => code(i.storeId)).sort().join(',');
  }
  async function create(sku, name, picks) {
    await page.getByRole('button', { name: 'New product' }).click(); await page.waitForTimeout(400);
    await picks();
    await dlg.locator('input').nth(0).fill(sku); await dlg.locator('input').nth(2).fill(name);
    await dlg.locator('.field', { has: page.locator('label', { hasText: /^Selling price/ }) }).locator('input').pressSequentially('2.50');
    await dlg.getByRole('button', { name: 'Save' }).click(); await page.waitForTimeout(1000);
  }

  await page.goto(W + '/login');
  await page.fill('#email', 'admin@pos.local'); await page.fill('#password', 'Password@123'); await page.click('button[type=submit]');
  await page.waitForTimeout(1500); await page.goto(W + '/products'); await page.waitForTimeout(1000);

  // 1. tick one more store
  await create('NP-001', 'Test two stores', async () => {
    ok(await sold.count() === 1, 'New product shows "Sold in stores"');
    ok(await sold.locator('.store-pick').count() === 3, 'one tick box per store (3)');
    ok(await sold.locator('.store-pick.on').count() === 1 && /PP01/.test(await sold.locator('.store-pick.on').textContent()), 'the store chosen at the top is ticked to start with');
    if (OUT) await page.screenshot({ path: OUT + 'np1-sold-in.png' });
    await sold.locator('.store-pick', { hasText: 'SR01' }).click();
  });
  ok(await dlg.count() === 0, 'saved');
  ok((await soldIn('NP-001')) === 'PP01,SR01', 'sold in PP01 and SR01: ' + (await soldIn('NP-001')));

  // 2. all stores
  await create('NP-002', 'Test all stores', async () => {
    await sold.getByRole('button', { name: 'All stores' }).click();
    ok(await sold.locator('.store-pick.on').count() === 3, '"All stores" ticks every store');
  });
  ok((await soldIn('NP-002')) === 'PP01,PP02,SR01', 'sold in all 3 stores');

  // 3. none ticked: refused
  await create('NP-003', 'Test no store', async () => {
    await sold.getByRole('button', { name: 'All stores' }).click(); await sold.getByRole('button', { name: 'None' }).click();
  });
  ok(await dlg.count() === 1 && await page.getByText('Choose at least one store').count() > 0, 'no store ticked: Save refused');
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);

  // 4. editing an existing product: no tick boxes (the list's "Sold in" switch does that per store)
  await page.locator('.p-datatable-tbody tr').first().locator('td').nth(1).click(); await page.waitForTimeout(800);
  if (await dlg.count()) ok(await sold.count() === 0, 'Edit product: no store tick boxes');

  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})();
