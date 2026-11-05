// Browser test: USD/KHR dual currency at the POS (riel total, pay in riel, change $ + ៛, all-riel change),
// receipt, riel drawer on the Shifts page, rate on the Stores page.
// Needs: fresh seed data (4100 riel = $1), API on :3000, vite preview on :4173, Playwright.
const { chromium } = require('playwright');
const OUT = process.env.SHOTS_DIR ? process.env.SHOTS_DIR + '/' : null;
const W = 'http://localhost:4173';
let fails = 0; const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 820 } })).newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  const shot = (n) => (OUT ? page.screenshot({ path: OUT + n + '.png' }) : null);
  const text = async (sel) => (await page.locator(sel).first().textContent()).replace(/\s+/g, ' ').trim();

  await page.goto(W + '/login'); await page.fill('#email', 'cashier1@pos.local'); await page.fill('#password', 'Password@123'); await page.click('button[type=submit]');
  await page.waitForURL(W + '/pos'); await page.waitForSelector('.tile'); await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Open shift' }).click(); await page.waitForTimeout(300);
  ok((await page.locator('.p-dialog').textContent()).includes('Opening riel'), 'open shift asks for dollars and riel');
  await page.locator('.p-dialog input').nth(0).fill('20'); await page.locator('.p-dialog input').nth(1).fill('50000');
  await page.locator('.p-dialog button[type=submit]').click(); await page.waitForTimeout(800);

  const s = page.locator('.search-input');
  await s.fill('10*885000000001'); await s.press('Enter'); await page.waitForTimeout(400);
  ok((await text('[data-test=khr-total]')).includes('៛14,300'), 'cart: $3.47 (after the drinks promotion) = ៛14,300 (rounded up to 100)');
  await shot('k0-cart');

  // Pay 20,000 riel ($4.88) → change $1.41 = $1 + ៛1,700
  await page.keyboard.press('F9'); await page.waitForSelector('.pay');
  ok((await text('[data-test=due-khr]')).includes('៛14,300') && (await text('[data-test=due-khr]')).includes('4,100'), 'payment: riel due and the rate');
  await page.locator('.method', { hasText: 'Cash ៛' }).click(); await page.waitForTimeout(200);
  await shot('k1-pay-riel');
  await page.locator('.quick.khr button', { hasText: '៛20,000' }).click();
  await page.waitForSelector('text=Sale complete'); await page.waitForTimeout(500);
  const rec = (await page.locator('.receipt-box').textContent()).replace(/\s+/g, ' ');
  ok(rec.includes('Cash ៛20,000') && rec.includes('$1.00 + ៛1,700') && rec.includes('Rate 4,100'), 'receipt: Cash ៛20,000, change $1.00 + ៛1,700, rate');
  ok((await text('[data-test=change-big]')).includes('$1.00 + ៛1,700'), 'big change box: $1.00 + ៛1,700');
  await shot('k2-receipt');
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);

  // Pay $5, change all in riel → $1.53 = ៛6,300
  await s.fill('10*885000000001'); await s.press('Enter'); await page.waitForTimeout(300);
  await page.keyboard.press('F9'); await page.waitForSelector('.pay');
  await page.locator('.change-mode').getByText('All ៛').click();
  await page.locator('.quick button', { hasText: '$5.00' }).click();
  await page.waitForSelector('text=Sale complete'); await page.waitForTimeout(500);
  ok((await page.locator('.receipt-box').textContent()).replace(/\s+/g, ' ').includes('Change៛6,300'), 'change all in riel: ៛6,300');
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);

  // Split: $2 + riel for the rest (2 bread loaves = $3.00, no tax on bread)
  await s.fill('2*SKU-0020'); await s.press('Enter'); await page.waitForTimeout(300);
  await page.keyboard.press('F9'); await page.waitForSelector('.pay');
  await page.locator('.change-mode').getByText('$ + ៛').click();
  await page.locator('.pay .p-inputnumber input').first().fill('2'); await page.getByRole('button', { name: 'Pay', exact: true }).click(); await page.waitForTimeout(300);
  await page.locator('.method', { hasText: 'Cash ៛' }).click(); await page.waitForTimeout(200);
  ok((await page.locator('.quick.khr button').first().textContent()).includes('៛4,100'), 'rest to pay in riel: $1.00 = ៛4,100');
  await page.locator('.quick.khr button').first().click(); await page.waitForTimeout(400);
  ok((await text('.paid')).includes('Cash ៛4,100') && (await text('.change')).includes('$0.00'), 'payments list shows the riel; no change');
  await page.getByRole('button', { name: 'Complete sale' }).click();
  await page.waitForSelector('text=Sale complete'); await page.waitForTimeout(400);
  await page.keyboard.press('Escape');

  // Shifts page: riel drawer = 50,000 + 20,000 + 4,100 - 1,700 - 6,300 = 66,100
  await page.goto(W + '/shifts'); await page.waitForTimeout(1200);
  await page.locator('.p-datatable-tbody tr').first().click(); await page.waitForSelector('[data-test=khr-drawer]');
  const drawer = (await text('[data-test=khr-drawer]'));
  ok(drawer.includes('៛50,000') && drawer.includes('+៛24,100') && drawer.includes('−៛8,000') && drawer.includes('៛66,100'), 'riel drawer: opening 50,000, +24,100, −8,000 change, expected 66,100');
  await shot('k3-shift');

  console.log('page errors:', errors.length, errors.slice(0, 5));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  await browser.close();
})();
