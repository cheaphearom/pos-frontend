// Browser test: coupons and gift vouchers at the POS and in admin.
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
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 820 }, acceptDownloads: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
    await page.goto(W + '/login'); await page.fill('#email', email); await page.fill('#password', 'Password@123'); await page.click('button[type=submit]');
    await page.waitForTimeout(1500);
    return page;
  };
  const shot = (p, n) => (OUT ? p.screenshot({ path: OUT + n + '.png' }) : null);
  const pos = await login('cashier1@pos.local');
  await pos.waitForSelector('.tile'); await pos.waitForTimeout(800);
  if (await pos.getByRole('button', { name: 'Open shift' }).count()) { await pos.getByRole('button', { name: 'Open shift' }).click(); await pos.locator('.p-dialog input').first().fill('50'); await pos.locator('.p-dialog button[type=submit]').click(); await pos.waitForTimeout(600); }
  const s = pos.locator('.search-input');
  const tok = await pos.evaluate(() => localStorage.getItem('pos.accessToken'));
  const get = async (p) => (await fetch(API + p, { headers: { Authorization: 'Bearer ' + tok } })).json();
  const scan = async (c) => { await s.fill(c); await s.press('Enter'); await pos.waitForTimeout(700); };
  const total = async () => (await pos.locator('.r.total .num').textContent()).trim();
  const payCash = async () => { await pos.keyboard.press('F9'); await pos.waitForSelector('.pay'); await pos.locator('.quick button').first().click(); await pos.waitForSelector('text=Sale complete', { timeout: 10000 }); };
  const lastSale = async () => get('/sales/' + (await get('/sales?limit=1')).data[0].id);

  // 1. members-only coupon
  await scan('SKU-0017'); // rice 6.50, no tax
  await scan('WELCOME10');
  ok(await pos.getByText(/members only/i).count() > 0, 'members-only coupon refused without a member');
  await pos.keyboard.press('F4'); await pos.locator('.p-dialog input').fill('012345678'); await pos.locator('.p-dialog button[type=submit]').click(); await pos.waitForTimeout(800);
  await scan('welcome10');
  ok((await pos.locator('.coupon-row').textContent()).includes('−$0.65') && (await total()) === '$5.85', 'coupon 10% applied in the cart: total ' + (await total()));
  await shot(pos, '60-pos-coupon');
  await payCash();
  let sale = await lastSale();
  ok(fmt(sale.total) === '$5.85' && sale.couponName?.startsWith('Welcome 10%') && (await pos.locator('.receipt-box').textContent()).includes('coupon'), 'server total $5.85 and receipt shows the coupon');
  await pos.keyboard.press('Enter');

  // 2. single-use code
  await scan('SKU-0017'); await scan('LUCKY-AAAA1111');
  ok((await total()) === '$5.50', 'single-use $1 coupon applied');
  await payCash(); await pos.keyboard.press('Enter');
  await scan('SKU-0017'); await scan('LUCKY-AAAA1111');
  ok(await pos.getByText('This coupon code has already been used').count() > 0 && (await pos.locator('.coupon-row').count()) === 0, 'the same single-use code is refused the second time');

  // 3. sell a voucher, then pay with it
  await pos.getByRole('button', { name: 'Clear' }).click();
  await scan('GVDEMO10A');
  ok(await pos.getByText('Sell gift voucher').count() > 0, 'scanning an unsold voucher opens "Sell gift voucher"');
  await shot(pos, '61-pos-sell-voucher');
  await pos.getByRole('button', { name: /activate voucher/ }).click(); await pos.waitForTimeout(800);
  await scan('SKU-0017'); await scan('GVDEMO10A');
  ok((await pos.locator('.coupon-row').textContent()).includes('$10.00'), 'voucher attached to the sale with $10.00');
  await pos.keyboard.press('F9'); await pos.waitForSelector('.pay');
  await pos.locator('.method', { hasText: 'Voucher' }).first().click(); await pos.waitForTimeout(300);
  await shot(pos, '62-pos-voucher-pay');
  await pos.getByRole('button', { name: 'Use voucher' }).click();
  await pos.waitForSelector('text=Sale complete', { timeout: 10000 }); await pos.keyboard.press('Enter');
  ok((await get('/vouchers/lookup?code=GVDEMO10A')).balance === '3.5', 'voucher paid $6.50, $3.50 left');

  // 4. free voucher + cash for the rest
  await scan('SKU-0017'); await scan('GVFREE2A');
  await pos.keyboard.press('F9'); await pos.waitForSelector('.pay');
  await pos.locator('.method', { hasText: 'Voucher' }).first().click(); await pos.waitForTimeout(300);
  await pos.getByRole('button', { name: 'Use voucher' }).click(); await pos.waitForTimeout(300);
  await pos.locator('.method', { hasText: 'Cash' }).click(); await pos.locator('.quick button').first().click();
  await pos.getByRole('button', { name: 'Complete sale' }).click();
  await pos.waitForSelector('text=Sale complete', { timeout: 10000 });
  sale = await lastSale();
  ok(sale.payments.map((p) => `${p.method}:${p.amount}`).join(',') === 'VOUCHER:2,CASH:4.5', 'free $2 voucher + cash: ' + sale.payments.map((p) => `${p.method}:${p.amount}`).join(','));
  await pos.keyboard.press('Enter');

  // 5. admin
  const ad = await login('admin@pos.local');
  await ad.goto(W + '/coupons');
  await ad.waitForFunction(() => document.querySelectorAll('.p-datatable-tbody tr').length >= 2, null, { timeout: 10000 }).catch(() => {});
  ok((await ad.locator('.p-datatable-tbody tr').count()) === 2, 'coupons page lists the 2 demo campaigns');
  await shot(ad, '63-coupons');
  await ad.getByRole('button', { name: 'New coupon' }).click(); await ad.waitForTimeout(300);
  await ad.locator('.p-dialog input').first().fill('Test unique');
  await ad.getByText('Unique single-use codes').click();
  await shot(ad, '64-coupon-new');
  const [dl] = await Promise.all([ad.waitForEvent('download'), ad.getByRole('button', { name: 'Create' }).click()]);
  ok(dl.suggestedFilename().startsWith('coupons-Test-unique'), 'unique codes CSV downloaded: ' + dl.suggestedFilename());
  await ad.goto(W + '/vouchers'); await ad.waitForTimeout(800);
  await ad.locator('input[placeholder="Scan or type a voucher code"]').fill('GVDEMO10A'); await ad.keyboard.press('Enter'); await ad.waitForTimeout(800);
  ok((await ad.locator('.voucher').textContent()).includes('$3.50'), 'voucher check shows $3.50 left');
  await shot(ad, '65-vouchers');
  await ad.goto(W + '/reports'); await ad.waitForTimeout(1500);
  ok(await ad.getByText('Unspent sold vouchers').count() === 1, 'reports show coupons and vouchers');
  await ad.locator('h3', { hasText: 'Gift vouchers' }).scrollIntoViewIfNeeded(); await shot(ad, '66-report-cv');

  console.log('page errors:', errors.length, errors.slice(0, 5));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  await browser.close();
})();
