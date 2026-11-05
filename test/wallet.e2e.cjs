const { chromium } = require('playwright');
// Browser test: wallet cards at the POS (scan, PIN, top-up, activation, split payment) and admin page.
// Needs: fresh seed data, API on :3000, vite preview on :4173, Playwright.
const OUT = process.env.SHOTS_DIR ? process.env.SHOTS_DIR + '/' : null;
const W = 'http://localhost:4173', API = 'http://localhost:3000/api/v1';
let fails = 0; const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const login = async (email) => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 820 } });
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

  // 1. scan the demo card -> member + wallet attached
  await s.fill('8899000000000015'); await s.press('Enter'); await pos.waitForTimeout(800);
  ok((await pos.locator('.cust').textContent()).includes('Chea Sokunthea') && (await pos.locator('.wallet-line').textContent()).includes('$20.00'), 'scanning the card attaches the member and shows wallet balance $20.00');
  await s.fill('SKU-0017'); await s.press('Enter'); // rice $6.50, no tax
  await pos.keyboard.press('F9'); await pos.waitForSelector('.pay');
  await pos.locator('.method', { hasText: 'Wallet card' }).click(); await pos.waitForTimeout(300);
  ok((await pos.locator('.wallet-box').textContent()).includes('$20.00'), 'payment dialog shows the card balance');
  await pos.locator('.pay input[type=password]').fill('1234');
  await shot(pos, '50-pos-wallet-pay');
  await pos.getByRole('button', { name: 'Pay from card' }).click();
  await pos.waitForSelector('text=Sale complete', { timeout: 10000 });
  const rec = await pos.locator('.receipt-box').textContent();
  ok(rec.includes('Wallet card'), 'receipt shows the wallet payment');
  await shot(pos, '51-pos-wallet-receipt');
  await pos.keyboard.press('Enter');
  const card = await get('/wallet/cards/lookup?code=8899000000000015');
  ok(card.balance === '13.5', `card balance after paying $6.50: ${card.balance}`);

  // 2. top up by scanning
  await pos.getByRole('button', { name: 'Top up' }).click(); await pos.waitForTimeout(300);
  await pos.locator('.p-dialog input').first().fill('8899000000000015'); await pos.getByRole('button', { name: 'Find card' }).click(); await pos.waitForTimeout(600);
  await pos.getByRole('button', { name: '$20.00' }).click();
  await shot(pos, '52-pos-topup');
  await pos.getByRole('button', { name: /Top up \$20.00/ }).click(); await pos.waitForTimeout(800);
  ok((await get('/wallet/cards/lookup?code=8899000000000015')).balance === '33.5', 'top-up $20 → balance $33.50');

  // 3. new card at the till: activate, top up $5, split payment wallet + cash
  await s.fill('8899000000000023'); await s.press('Enter'); await pos.waitForTimeout(800);
  ok(await pos.getByText('New wallet card').count() > 0, 'scanning an unused card opens activation');
  await pos.locator('.p-dialog input').nth(0).fill('demo02-serial');
  await pos.locator('.p-dialog input').nth(1).fill('Walk-in Wallet');
  await shot(pos, '53-pos-activate');
  await pos.getByRole('button', { name: 'Activate card' }).click(); await pos.waitForTimeout(900);
  ok(await pos.getByText('Top up wallet card').count() > 0, 'after activation the top-up dialog opens');
  await pos.getByRole('button', { name: '$5.00' }).click();
  await pos.getByRole('button', { name: /Top up \$5.00/ }).click(); await pos.waitForTimeout(800);
  await s.fill('SKU-0017'); await s.press('Enter');
  await pos.keyboard.press('F9'); await pos.waitForSelector('.pay');
  await pos.locator('.method', { hasText: 'Wallet card' }).click(); await pos.waitForTimeout(300);
  await pos.getByRole('button', { name: 'Pay from card' }).click(); await pos.waitForTimeout(300);
  ok(await pos.getByText('Still to pay').count() > 0, 'card covers $5.00, rest still to pay');
  await pos.locator('.method', { hasText: 'Cash' }).click(); await pos.waitForTimeout(200);
  await pos.locator('.quick button').first().click();
  await shot(pos, '53b-pos-split');
  await pos.getByRole('button', { name: 'Complete sale' }).click();
  await pos.waitForSelector('text=Sale complete', { timeout: 10000 });
  const latest = (await get('/sales?limit=1')).data[0];
  const sale = await get('/sales/' + latest.id);
  ok(sale.payments.map((p) => `${p.method}:${p.amount}`).join(',') === 'WALLET:5,CASH:1.5', 'split saved: ' + sale.payments.map((p) => `${p.method}:${p.amount}`).join(','));
  ok((await get('/wallet/cards/lookup?code=8899000000000023')).balance === '0', 'new card balance used up');
  await pos.keyboard.press('Enter');

  // 4. admin page + report
  const mg = await login('manager.pp@pos.local');
  await mg.goto(W + '/wallet-cards'); await mg.waitForTimeout(1000);
  ok((await mg.locator('.p-datatable-tbody tr').count()) === 11, 'wallet cards page lists 11 demo cards');
  await shot(mg, '54-wallet-cards');
  await mg.locator('.p-datatable-tbody tr', { hasText: '8899 0000 0000 0015' }).click(); await mg.waitForTimeout(800);
  ok((await mg.locator('.wbal').textContent()).includes('33.50') && (await mg.locator('.p-drawer tbody tr').count()) === 3, 'card detail: balance $33.50 and 3 history rows');
  await shot(mg, '55-wallet-detail');
  await mg.keyboard.press('Escape');
  await mg.goto(W + '/reports'); await mg.waitForTimeout(1500);
  ok(await mg.getByText('Held by customers now').count() === 1, 'reports show wallet liability');
  await mg.locator('h3', { hasText: 'Wallet cards' }).scrollIntoViewIfNeeded(); await shot(mg, '56-wallet-report');

  console.log('page errors:', errors.length, errors.slice(0, 5));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  await browser.close();
})();
