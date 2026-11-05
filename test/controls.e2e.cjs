// Browser test: cashier controls — discount limit with manager PIN at the POS, cashier refund and void with a PIN,
// manager sets their PIN, store settings, audit log.
// Needs: fresh seed data (manager.pp PIN 2580), API on :3000, vite preview on :4173, Playwright.
const { chromium } = require('playwright');
const OUT = process.env.SHOTS_DIR ? process.env.SHOTS_DIR + '/' : null;
const W = 'http://localhost:4173';
let fails = 0; const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = (p) => { p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text())); return p; };
  const pin = async (p, digits) => { for (const d of digits) await p.locator('.pad button', { hasText: new RegExp(`^${d}$`) }).click(); await p.getByRole('button', { name: 'Approve' }).click(); await p.waitForTimeout(900); };

  // ── Cashier gives 20% at the POS
  const pos = watch(await (await browser.newContext({ viewport: { width: 1366, height: 820 } })).newPage());
  const shot = (n, p = pos) => (OUT ? p.screenshot({ path: OUT + n + '.png' }) : null);
  await pos.goto(W + '/login'); await pos.fill('#email', 'cashier1@pos.local'); await pos.fill('#password', 'Password@123'); await pos.click('button[type=submit]');
  await pos.waitForURL(W + '/pos'); await pos.waitForSelector('.tile'); await pos.waitForTimeout(1500);
  if (await pos.getByRole('button', { name: 'Open shift' }).count()) { await pos.getByRole('button', { name: 'Open shift' }).click(); await pos.locator('.p-dialog input').fill('100'); await pos.locator('.p-dialog button[type=submit]').click(); await pos.waitForTimeout(600); }
  const s = pos.locator('.search-input');
  await s.fill('10*885000000001'); await s.press('Enter'); await pos.waitForTimeout(300);
  await pos.getByRole('button', { name: 'Discount' }).click(); await pos.waitForTimeout(300);
  ok((await pos.locator('.p-dialog').textContent()).includes('Up to 10% without a manager'), 'discount dialog shows the cashier limit');
  await pos.locator('.p-dialog .p-selectbutton').getByText('Percent').click();
  await pos.locator('.p-dialog input').last().fill('20'); await pos.locator('.p-dialog input').last().press('Tab');
  await pos.locator('.p-dialog').getByRole('button', { name: 'Apply' }).click(); await pos.waitForTimeout(400);
  ok((await pos.getByText('needs manager PIN').count()) === 1, 'cart shows "needs manager PIN"');
  await pos.keyboard.press('F9'); await pos.waitForSelector('.pad');
  ok((await pos.locator('.p-dialog').textContent()).includes('above the cashier limit of 10%'), 'paying asks for a manager PIN');
  await pin(pos, '0000');
  ok((await pos.locator('.p-dialog .p-message-error').textContent()).includes('Wrong manager PIN'), 'wrong PIN refused');
  await shot('c0-approval');
  await pin(pos, '2580');
  ok((await pos.locator('.p-toast-message', { hasText: 'Approved by Sokha Chan' }).count()) === 1, 'manager approved');
  await pos.waitForSelector('.pay');
  await pos.locator('.quick button').last().click();
  await pos.waitForSelector('text=Sale complete'); await pos.waitForTimeout(500);
  const receiptNo = /(PP01-\d{8})/.exec(await pos.locator('.receipt-box').textContent())?.[1];
  ok(!!receiptNo, 'sale with 20% discount completed: ' + receiptNo);
  await pos.keyboard.press('Escape');

  // ── Cashier refunds 2 waters, then voids another sale (both need the PIN)
  await pos.goto(W + `/sales?receipt=${receiptNo}`); await pos.waitForSelector('.receipt'); await pos.waitForTimeout(500);
  await pos.getByRole('button', { name: 'Refund', exact: true }).click(); await pos.waitForTimeout(400);
  await pos.locator('.p-dialog .p-inputnumber input').first().fill('2'); await pos.locator('.p-dialog .p-inputnumber input').first().press('Tab');
  await pos.locator('.p-dialog').getByRole('button', { name: 'Refund', exact: true }).click(); await pos.waitForSelector('.pad');
  await pin(pos, '2580');
  ok((await pos.locator('.p-toast-message', { hasText: 'Refund done' }).count()) === 1, 'cashier refund with manager PIN');
  ok((await pos.locator('.receipt').textContent()).includes(`${receiptNo}-R1`), 'receipt shows the refund');
  await pos.keyboard.press('Escape');

  await pos.goto(W + '/pos'); await pos.waitForSelector('.tile'); await pos.waitForTimeout(800);
  await s.fill('885000000001'); await s.press('Enter'); await pos.waitForTimeout(300);
  await pos.keyboard.press('F9'); await pos.waitForSelector('.pay'); await pos.locator('.quick button').last().click();
  await pos.waitForSelector('text=Sale complete'); await pos.waitForTimeout(400);
  const voidNo = /(PP01-\d{8})/.exec(await pos.locator('.receipt-box').textContent())?.[1];
  await pos.goto(W + `/sales?receipt=${voidNo}`); await pos.waitForSelector('.receipt'); await pos.waitForTimeout(500);
  await pos.getByRole('button', { name: 'Void', exact: true }).click(); await pos.waitForTimeout(300);
  await pos.locator('.p-dialog input').first().fill('customer changed mind');
  await shot('c1-void');
  await pos.getByRole('button', { name: 'Void sale' }).click(); await pos.waitForSelector('.pad');
  await pin(pos, '2580');
  ok((await pos.locator('.p-toast-message', { hasText: 'Sale voided' }).count()) === 1, 'cashier void with manager PIN');
  ok((await pos.locator('.receipt').textContent()).includes('Void: customer changed mind'), 'receipt shows the void reason');

  // ── Manager: audit log, PIN, store settings
  const ad = watch(await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage());
  await ad.goto(W + '/login'); await ad.fill('#email', 'manager.pp@pos.local'); await ad.fill('#password', 'Password@123'); await ad.click('button[type=submit]');
  await ad.waitForTimeout(1500);
  await ad.goto(W + '/audit'); await ad.waitForSelector('.p-datatable-tbody tr'); await ad.waitForTimeout(800);
  const log = (await ad.locator('.p-datatable-tbody').textContent()).replace(/\s+/g, ' ');
  ok(log.includes('Discount approved') && log.includes('Approval denied') && log.includes('Refund') && log.includes('Void'), 'audit log: discount approved, wrong PIN, refund, void');
  ok(log.includes('Sokha Chan'), 'audit log shows who approved');
  await shot('c2-audit', ad);
  await ad.getByRole('button', { name: 'Voids' }).click(); await ad.waitForTimeout(800);
  ok((await ad.locator('.p-datatable-tbody tr').count()) === 1, 'filter: 1 void');
  await ad.locator('.p-datatable-tbody tr').first().click(); await ad.waitForTimeout(400);
  ok((await ad.locator('.p-dialog').textContent()).includes(voidNo), 'audit detail shows the voided receipt');
  await ad.keyboard.press('Escape'); await ad.waitForTimeout(300);

  await ad.getByRole('button', { name: 'My approval PIN' }).click(); await ad.waitForTimeout(300);
  await ad.fill('#ap-pw', 'Password@123'); await ad.fill('#ap-pin', '1234'); await ad.fill('#ap-pin2', '1234');
  await ad.getByRole('button', { name: 'Save PIN' }).click(); await ad.waitForTimeout(700);
  ok((await ad.locator('.p-dialog .p-message-error').textContent()).includes('harder to guess'), 'easy PIN refused');
  await ad.fill('#ap-pin', '4826'); await ad.fill('#ap-pin2', '4826');
  await ad.getByRole('button', { name: 'Save PIN' }).click(); await ad.waitForTimeout(800);
  ok((await ad.locator('.p-toast-message', { hasText: 'Approval PIN saved' }).count()) === 1, 'manager changed their PIN');

  console.log('page errors:', errors.length, errors.slice(0, 5));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  await browser.close();
})();
