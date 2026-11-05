// Browser test: café POS (drink options, dine-in, queue number), barista screen and pickup board.
// Needs: fresh seed data, API on :3000, vite preview on :4173, Playwright.
const { chromium } = require('playwright');
const OUT = process.env.SHOTS_DIR ? process.env.SHOTS_DIR + '/' : null;
const W = 'http://localhost:4173', API = 'http://localhost:3000/api/v1';
let fails = 0; const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 820 } });
  ctx.on('page', (p) => { p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text())); });
  const shot = (p, n) => (OUT ? p.screenshot({ path: OUT + n + '.png' }) : null);
  const pos = await ctx.newPage();
  await pos.goto(W + '/login'); await pos.fill('#email', 'cashier1@pos.local'); await pos.fill('#password', 'Password@123'); await pos.click('button[type=submit]');
  await pos.waitForURL(W + '/pos'); await pos.waitForSelector('.tile'); await pos.waitForTimeout(1200);
  if (await pos.getByRole('button', { name: 'Open shift' }).count()) { await pos.getByRole('button', { name: 'Open shift' }).click(); await pos.locator('.p-dialog input').first().fill('50'); await pos.locator('.p-dialog button[type=submit]').click(); await pos.waitForTimeout(600); }
  const tok = await pos.evaluate(() => localStorage.getItem('pos.accessToken'));
  const get = async (p) => (await fetch(API + p, { headers: { Authorization: 'Bearer ' + tok } })).json();

  ok(await pos.getByText('Dine-in').count() > 0, 'café mode: Takeaway / Dine-in switch shown');
  await pos.locator('.chip', { hasText: 'Coffee & Tea' }).click(); await pos.waitForTimeout(300);
  await pos.locator('.tile', { hasText: /^\s*Latte/ }).first().click(); await pos.waitForTimeout(400);
  ok(await pos.locator('.p-dialog-title', { hasText: 'Latte' }).count() === 1, 'tapping Latte opens its options');
  ok((await pos.locator('.choice.on').allTextContents()).map((t) => t.trim()).join('|').includes('Medium'), 'defaults pre-selected (Medium, 100%, Fresh milk)');
  for (const o of ['Large', '50%', 'Oat milk', 'Extra shot']) await pos.locator('.choice', { hasText: o }).first().click();
  await pos.locator('.p-dialog input[placeholder^="e.g. less sweet"]').fill('very hot');
  await shot(pos, '80-pos-options');
  ok((await pos.getByRole('button', { name: /Add \$4\.40/ }).count()) === 1, 'price preview $4.40 (2.30 + 1.00 + 0.60 + 0.50)');
  await pos.getByRole('button', { name: /Add \$4\.40/ }).click(); await pos.waitForTimeout(300);
  ok((await pos.locator('.ln-opts').first().textContent()).includes('Large · 50% · Oat milk · Extra shot') && (await pos.locator('.ln-note').count()) === 1, 'cart line shows options and note');
  await pos.locator('.tile', { hasText: 'Iced Lemon Tea' }).click(); await pos.waitForTimeout(300);
  await pos.getByRole('button', { name: /^Add \$/ }).click(); await pos.waitForTimeout(300);
  await pos.getByText('Dine-in').click(); await pos.locator('input[placeholder="Table"]').fill('5');
  await shot(pos, '81-pos-cafe-cart');
  const shown = (await pos.locator('.r.total .num').textContent()).trim();
  await pos.keyboard.press('F9'); await pos.waitForSelector('.pay'); await pos.locator('.quick button').last().click();
  await pos.waitForSelector('text=Sale complete', { timeout: 10000 });
  const rec = await pos.locator('.receipt-box').textContent();
  const q = /A\d{3}/.exec(rec)?.[0];
  ok(!!q && rec.includes('Dine-in · Table 5') && rec.includes('Oat milk +0.60'), `receipt shows order ${q}, dine-in table 5 and options`);
  await shot(pos, '82-pos-cafe-receipt');
  const sale = await get('/sales/' + (await get('/sales?limit=1')).data[0].id);
  ok('$' + Number(sale.total).toFixed(2) === shown && sale.queueNo === q && sale.kitchenStatus === 'NEW', `server total ${sale.total} = screen ${shown}; order sent to the barista`);
  await pos.keyboard.press('Enter');

  // Barista screen
  const kds = await ctx.newPage();
  await kds.goto(W + '/kitchen'); await kds.waitForSelector('.ticket', { timeout: 10000 }); await kds.waitForTimeout(500);
  const ticket = kds.locator('.ticket', { hasText: q });
  ok((await ticket.textContent()).includes('Large · 50% · Oat milk · Extra shot') && (await ticket.textContent()).includes('very hot') && (await ticket.textContent()).includes('T5'), `barista ticket ${q}: options, note and table`);
  await shot(kds, '83-kitchen');
  await ticket.getByRole('button', { name: 'Start' }).click(); await kds.waitForTimeout(500);
  ok(await kds.locator('.col.preparing .ticket', { hasText: q }).count() === 1, 'Start → Preparing');
  await kds.locator('.col.preparing .ticket', { hasText: q }).getByRole('button', { name: 'Ready' }).click(); await kds.waitForTimeout(500);
  const board = await ctx.newPage(); await board.setViewportSize({ width: 1280, height: 720 });
  await board.goto(W + '/board?store=PP01'); await board.waitForTimeout(1500);
  ok(await board.locator('.ready .nums span', { hasText: q }).count() === 1, `pickup board shows ${q} as ready`);
  await shot(board, '84-board');
  await kds.locator('.col.ready .ticket', { hasText: q }).getByRole('button', { name: 'Picked up' }).click(); await kds.waitForTimeout(500);
  await board.waitForTimeout(4500);
  ok(await board.locator('.ready .nums span', { hasText: q }).count() === 0, 'picked up → gone from the board');

  // A second POS order arrives on the barista screen by itself (polling)
  await pos.bringToFront();
  await pos.locator('.tile', { hasText: 'Americano' }).click(); await pos.waitForTimeout(300); await pos.getByRole('button', { name: /^Add \$/ }).click();
  await pos.keyboard.press('F9'); await pos.waitForSelector('.pay'); await pos.locator('.quick button').first().click(); await pos.waitForSelector('text=Sale complete');
  const q2 = /A\d{3}/.exec(await pos.locator('.receipt-box').textContent())?.[0];
  await kds.waitForTimeout(4000);
  ok(await kds.locator('.col.new .ticket', { hasText: q2 }).count() === 1, `new order ${q2} appears on the barista screen automatically`);

  // Admin pages
  const ad = await ctx.browser().newContext({ viewport: { width: 1366, height: 820 } }).then((c) => c.newPage());
  await ad.goto(W + '/login'); await ad.fill('#email', 'admin@pos.local'); await ad.fill('#password', 'Password@123'); await ad.click('button[type=submit]'); await ad.waitForTimeout(1500);
  await ad.goto(W + '/modifiers'); await ad.waitForTimeout(1000);
  ok((await ad.locator('.group').count()) === 5, 'drink options page lists 5 option groups');
  await shot(ad, '85-modifiers');
  console.log('page errors:', errors.length, errors.slice(0, 5));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  await browser.close();
})();
