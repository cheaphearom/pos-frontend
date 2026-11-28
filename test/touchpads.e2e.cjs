// Copyright (c) 2026 Chea Phearom. All rights reserved.
// Proprietary and confidential: see the LICENSE file.
// Browser test: touchscreen mode, each POS popup has its own keypad and the big keyboard behind it hides.
// Needs: fresh seed data, API on :3000, vite preview on :4173, Playwright.
const { chromium } = require('playwright');
const OUT = process.env.SHOTS_DIR ? process.env.SHOTS_DIR + '/' : null;
const W = 'http://localhost:4173';
let fails = 0; const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  const shot = (n) => (OUT ? page.screenshot({ path: OUT + n + '.png' }) : Promise.resolve());
  const dlg = page.locator('.p-dialog');
  const bigKb = page.locator('.pos-kb');
  const tap = (scope, key) => scope.locator('button.k', { hasText: new RegExp('^' + key + '$') }).first().click();

  await page.addInitScript(() => localStorage.setItem('pos.touchKeyboard', '1'));   // touchscreen mode from the start
  await page.goto(W + '/login');
  await page.fill('#email', 'cashier1@pos.local'); await page.fill('#password', 'Password@123');
  await page.click('button[type=submit]');
  await page.waitForURL(W + '/pos'); await page.waitForSelector('.tile'); await page.waitForTimeout(800);

  if (await page.getByRole('button', { name: 'Open shift' }).count()) {
    await page.getByRole('button', { name: 'Open shift' }).click(); await page.waitForTimeout(300);
    ok(await bigKb.count() === 0, 'shift popup: big keyboard hidden');
    for (const k of ['1', '0', '0']) await tap(dlg, k);
    await tap(dlg, 'Open'); await page.waitForTimeout(800);
  }
  ok(await page.getByText(/Shift since/).count() > 0, 'shift is open');
  ok(await bigKb.count() === 0, 'no popup: big keyboard stays hidden until the search box is tapped');
  await page.locator('.search-input').click(); await page.waitForTimeout(200);
  ok(await bigKb.count() === 1, 'tapping the search box shows the big keyboard');

  await page.locator('.tile', { hasText: 'Bananas' }).click(); await page.waitForTimeout(300);
  const total = async () => (await page.locator('.r.total .num').textContent()).trim();
  const before = await total();

  // ── Discount on the whole sale
  await page.getByRole('button', { name: 'Discount' }).click(); await page.waitForTimeout(400);
  ok(await bigKb.count() === 0, 'discount popup: big keyboard hidden');
  ok(await dlg.locator('[data-test=disc-pad]').count() === 1, 'discount popup has its own number pad');
  await shot('t1-discount');
  await tap(dlg, 'C'); await tap(dlg, '0'); await tap(dlg, '\\.'); await tap(dlg, '5');
  ok((await dlg.locator('input').last().inputValue()).includes('0.5'), 'pad types 0.50 into the discount');
  ok(await dlg.getByRole('button', { name: 'Apply' }).count() === 1, 'one Apply button (on the pad)');
  await tap(dlg, 'Apply'); await page.waitForTimeout(500);
  ok(await dlg.count() === 0 && (await total()) !== before && await page.locator('.p-message-error').count() === 0, `Apply on the pad applies it (${before} → ${await total()})`);
  ok(await bigKb.count() === 1, 'popup closed: big keyboard back');

  // ── Line edit: quantity, then discount
  await page.locator('.line .num').first().click(); await page.waitForTimeout(400);
  ok(await bigKb.count() === 0 && await dlg.locator('[data-test=line-pad]').count() === 1, 'line popup: own pad, big keyboard hidden');
  const [qtyBox, discBox] = [dlg.locator('.field').nth(0), dlg.locator('.field').nth(1)];
  ok(await qtyBox.locator('.pad-target').count() === 1, 'quantity is the highlighted box first');
  await tap(dlg, 'C'); await tap(dlg, '3');
  await discBox.locator('input').click(); await page.waitForTimeout(150);
  ok(await discBox.locator('.pad-target').count() === 1, 'tapping discount moves the highlight');
  await tap(dlg, 'C'); await tap(dlg, '1');
  await shot('t2-line');
  ok((await qtyBox.locator('input').inputValue()) === '3' && (await discBox.locator('input').inputValue()).startsWith('1'), 'pad filled quantity 3 and discount 1');
  await tap(dlg, 'Save'); await page.waitForTimeout(400);
  ok(await dlg.count() === 0 && (await page.locator('.line .num').first().textContent()).trim() === '3', 'Save on the pad saves: quantity 3');

  // ── Loyalty member: full keyboard inside, keeps the leading zero
  await page.getByRole('button', { name: /Add member/ }).click(); await page.waitForTimeout(400);
  ok(await bigKb.count() === 0 && await dlg.locator('[data-test=cust-kb]').count() === 1, 'member popup: own keyboard, big keyboard hidden');
  for (const k of '012345678') await tap(dlg.locator('[data-test=cust-kb]'), k);
  ok((await dlg.locator('input').first().inputValue()) === '012345678', 'keyboard typed 012345678 (leading zero kept)');
  await shot('t3-member');
  await tap(dlg.locator('[data-test=cust-kb]'), 'Find'); await page.waitForTimeout(800);
  ok(await page.getByText('Chea Sokunthea').count() > 0, 'Find on the keyboard links the member');

  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})();
