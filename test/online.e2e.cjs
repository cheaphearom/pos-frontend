// Browser test: online ordering on a phone (table QR + KHQR, pay at counter), POS online orders, barista, QR sheet.
// Needs: fresh seed data, API on :3000 (KHQR_MODE=manual), vite preview on :4173, Playwright.
const { chromium, devices } = require('playwright');
const OUT = process.env.SHOTS_DIR ? process.env.SHOTS_DIR + '/' : null;
const W = 'http://localhost:4173';
let fails = 0; const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = (p) => { p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text())); return p; };
  const shot = (p, n) => (OUT ? p.screenshot({ path: OUT + n + '.png' }) : null);

  // Customer phone: table 4
  const phone = watch(await (await browser.newContext({ ...devices['iPhone 13'] })).newPage());
  await phone.goto(W + '/order/PP01?table=4'); await phone.waitForSelector('.item'); await phone.waitForTimeout(500);
  ok((await phone.locator('.item').count()) === 8 && (await phone.getByText('Table 4').count()) > 0, 'phone menu: 8 items, table 4');
  await shot(phone, 'a0-phone-menu');
  await phone.locator('.item', { hasText: /^\s*Latte/ }).first().click(); await phone.waitForTimeout(400);
  await phone.locator('.choice', { hasText: 'Large' }).click(); await phone.locator('.choice', { hasText: 'Oat milk' }).click();
  await shot(phone, 'a1-phone-options');
  await phone.getByRole('button', { name: /^Add \$/ }).click(); await phone.waitForTimeout(300);
  await phone.locator('.item', { hasText: 'Butter Croissant' }).click(); await phone.waitForTimeout(300);
  await phone.locator('.cartbar').click(); await phone.waitForTimeout(1200);
  // Latte 2.30 + 1.00 + 0.60 = 3.90 + 0.39 tax; croissant 1.50 + 0.15 => 5.94
  ok((await phone.locator('.grand').textContent()).includes('$5.94'), 'server-priced total on the phone: ' + (await phone.locator('.grand').textContent()).trim());
  await phone.locator('.sheet input').nth(1).fill('Dara'); await phone.locator('.sheet input').nth(2).fill('017222333');
  await shot(phone, 'a2-phone-cart');
  await phone.getByRole('button', { name: /Place order/ }).click();
  await phone.waitForSelector('.khqr img', { timeout: 10000 }); await phone.waitForTimeout(400);
  ok(await phone.getByText('Pay with KHQR').count() === 1, 'phone shows the KHQR to pay');
  await shot(phone, 'a3-phone-khqr');

  // Cashier confirms the KHQR payment
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 820 } });
  const pos = watch(await ctx.newPage());
  await pos.goto(W + '/login'); await pos.fill('#email', 'cashier1@pos.local'); await pos.fill('#password', 'Password@123'); await pos.click('button[type=submit]');
  await pos.waitForURL(W + '/pos'); await pos.waitForSelector('.tile'); await pos.waitForTimeout(1500);
  if (await pos.getByRole('button', { name: 'Open shift' }).count()) { await pos.getByRole('button', { name: 'Open shift' }).click(); await pos.locator('.p-dialog input').first().fill('50'); await pos.locator('.p-dialog button[type=submit]').click(); await pos.waitForTimeout(600); }
  ok(await pos.getByRole('button', { name: 'Online (1)' }).count() === 1, 'POS shows "Online (1)"');
  await pos.getByRole('button', { name: 'Online (1)' }).click(); await pos.waitForTimeout(600);
  await shot(pos, 'a4-pos-online');
  await pos.getByRole('button', { name: 'Payment received' }).click(); await pos.waitForTimeout(1500);
  await phone.waitForSelector('.q', { timeout: 10000 });
  const q = (await phone.locator('.q').textContent()).trim();
  ok(/^A\d{3}$/.test(q), 'phone now shows the order number ' + q);
  await pos.keyboard.press('Escape');

  // Barista makes it
  const kds = watch(await ctx.newPage());
  await kds.goto(W + '/kitchen'); await kds.waitForSelector('.ticket'); await kds.waitForTimeout(400);
  const t = kds.locator('.ticket', { hasText: q });
  ok((await t.textContent()).includes('Online') && (await t.textContent()).includes('T4') && (await t.textContent()).includes('Dara'), 'barista ticket: online, table 4, Dara');
  await t.getByRole('button', { name: 'Start' }).click(); await kds.waitForTimeout(400);
  await kds.locator('.ticket', { hasText: q }).getByRole('button', { name: 'Ready' }).click();
  await phone.waitForSelector('text=Ready!', { timeout: 10000 });
  ok(await phone.getByText('We are bringing it to your table').count() === 1, 'phone: "Ready! We are bringing it to your table."');
  await shot(phone, 'a5-phone-ready');

  // Pay at counter (pickup)
  const phone2 = watch(await (await browser.newContext({ ...devices['iPhone 13'] })).newPage());
  await phone2.goto(W + '/order/PP01'); await phone2.waitForSelector('.item');
  await phone2.locator('.item', { hasText: 'Chocolate Muffin' }).click(); await phone2.waitForTimeout(300);
  await phone2.locator('.cartbar').click(); await phone2.waitForTimeout(1200);
  await phone2.locator('.sheet input').nth(1).fill('Kanha');
  await phone2.getByRole('button', { name: /Pay at counter/ }).click();
  await phone2.getByRole('button', { name: /Place order/ }).click();
  await phone2.waitForSelector('text=Please pay at the counter', { timeout: 10000 });
  ok(true, 'pay-at-counter order placed');
  await pos.bringToFront(); await pos.waitForTimeout(11000);
  await pos.getByRole('button', { name: /^Online \(1\)/ }).click(); await pos.waitForTimeout(500);
  await pos.getByRole('button', { name: 'Take payment' }).click(); await pos.waitForTimeout(800);
  ok((await pos.locator('.line').count()) === 1 && (await pos.locator('.ln-name').first().textContent()).includes('Chocolate Muffin'), 'POS loaded the online order into the cart');
  await pos.keyboard.press('F9'); await pos.waitForSelector('.pay'); await pos.locator('.quick button').first().click(); await pos.waitForSelector('text=Sale complete');
  await phone2.waitForSelector('.q', { timeout: 10000 });
  ok(/^A\d{3}$/.test((await phone2.locator('.q').textContent()).trim()), 'after paying at the POS the phone shows the order number');
  await pos.keyboard.press('Enter');

  // Admin: table QR codes
  const ad = watch(await (await browser.newContext({ viewport: { width: 1366, height: 820 } })).newPage());
  await ad.goto(W + '/login'); await ad.fill('#email', 'admin@pos.local'); await ad.fill('#password', 'Password@123'); await ad.click('button[type=submit]'); await ad.waitForTimeout(1500);
  await ad.goto(W + '/stores'); await ad.waitForTimeout(800);
  await ad.locator('.p-datatable-tbody tr', { hasText: 'PP01' }).click(); await ad.waitForTimeout(400);
  await ad.getByRole('button', { name: 'Print table QR codes' }).click(); await ad.waitForTimeout(1500);
  ok((await ad.locator('.qr-card').count()) === 13, 'QR sheet: order-ahead + 12 tables');
  await shot(ad, 'a6-table-qr');
  console.log('page errors:', errors.length, errors.slice(0, 5));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  await browser.close();
})();
