// Copyright (c) 2026 Chea Phearom. All rights reserved.
// Proprietary and confidential: see the LICENSE file.
// Browser test: kitchen tickets per station (Bar / Kitchen by category), items in no station not printed,
// a printer per station on the till, Print prints the slips once then only the receipt.
// QZ Tray is not installed here: its connection attempts (localhost:8xxx) are expected and ignored.
// Needs: fresh seed data, API on :3000, vite preview on :4173, Playwright.
const { chromium } = require('playwright');
const OUT = process.env.SHOTS_DIR ? process.env.SHOTS_DIR + '/' : null;
const W = 'http://localhost:4173', API = 'http://localhost:3000/api/v1';
let fails = 0; const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const login = async (email) => {
    const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|WebSocket connection to 'wss?:\/\/localhost(\.qz\.io)?:8/.test(m.text()) && errors.push(m.text()));
    await page.goto(W + '/login'); await page.fill('#email', email); await page.fill('#password', 'Password@123'); await page.click('button[type=submit]');
    await page.waitForTimeout(1500);
    return page;
  };

  // ── 1. Admin: PP01 prints kitchen tickets, stations Bar (Beverages) and Kitchen (Bakery)
  const ad = await login('admin@pos.local');
  await ad.goto(W + '/stores'); await ad.waitForSelector('.st-card');
  await ad.locator('.st-card', { hasText: 'PP01' }).click(); await ad.waitForTimeout(500);
  const dlg = ad.locator('.p-dialog');
  const kt = dlg.locator('label', { hasText: 'Kitchen ticket (no prices)' });
  if (!(await kt.locator('input').isChecked())) await kt.click();
  ok(/one kitchen ticket with every item/.test(await dlg.locator('[data-test=stations]').innerText()), 'no stations yet: explains it prints one ticket');
  const addStation = async (name, cat) => {
    await dlg.locator('[data-test=station-add]').click(); await ad.waitForTimeout(150);
    const st = dlg.locator('.station').last();
    await st.locator('input').first().fill(name);
    await st.locator('.p-multiselect').click(); await ad.waitForTimeout(300);
    await ad.locator('.p-multiselect-overlay .p-multiselect-option', { hasText: new RegExp('^' + cat + '$') }).click();
    await ad.keyboard.press('Escape'); await ad.waitForTimeout(150);
  };
  await addStation('Bar', 'Beverages');
  await addStation('Kitchen', 'Bakery');
  // a category already used by Bar cannot be chosen for Kitchen
  await dlg.locator('.station').last().locator('.p-multiselect').click(); await ad.waitForTimeout(300);
  ok(await ad.locator('.p-multiselect-overlay .p-multiselect-option.p-disabled', { hasText: 'Beverages (in Bar)' }).count() === 1, 'Beverages is shown as taken by Bar for the Kitchen station');
  await ad.keyboard.press('Escape');
  if (OUT) await dlg.screenshot({ path: OUT + 'ks1-stations.png' });
  await dlg.getByRole('button', { name: 'Save' }).click(); await ad.waitForTimeout(1000);
  const tok = await ad.evaluate(() => localStorage.getItem('pos.accessToken'));
  const stores = await (await fetch(API + '/stores', { headers: { Authorization: 'Bearer ' + tok } })).json();
  const pp01 = stores.find((x) => x.code === 'PP01');
  ok(pp01.printKitchen && pp01.kitchenStations.map((x) => x.name).join(',') === 'Bar,Kitchen' && pp01.kitchenStations.every((x) => x.categoryIds.length === 1), 'saved: kitchen ticket on, stations Bar and Kitchen with their category');

  // ── 2. POS: Coca-Cola (Beverages), Butter Croissant (Bakery), Bananas (no station)
  const pos = await login('cashier1@pos.local');
  await pos.waitForSelector('.tile'); await pos.waitForTimeout(800);
  if (await pos.getByRole('button', { name: 'Open shift' }).count()) { await pos.getByRole('button', { name: 'Open shift' }).click(); await pos.locator('.p-dialog input').first().fill('50'); await pos.locator('.p-dialog button[type=submit]').click(); await pos.waitForTimeout(600); }
  // printers dialog: one printer per station
  const printersBtn = pos.getByRole('button', { name: 'Printers', exact: true });
  await printersBtn.click(); await pos.waitForTimeout(800);
  const labels = await pos.locator('[data-test=station-printer] label').allInnerTexts();
  ok(labels.length === 2 && /^Bar printer/.test(labels[0]) && /^Kitchen printer/.test(labels[1]), 'Printers dialog: a printer for Bar and for Kitchen (' + labels.map((l) => l.split(' (')[0]).join(', ') + ')');
  if (OUT) await pos.locator('.p-dialog').screenshot({ path: OUT + 'ks2-printers.png' });
  await pos.keyboard.press('Escape'); await pos.waitForTimeout(300);

  for (const n of ['Coca-Cola', 'Butter Croissant', 'Bananas']) { await pos.locator('.tile', { hasText: n }).first().click(); await pos.waitForTimeout(250); }
  await pos.keyboard.press('F9'); await pos.waitForSelector('.pay'); await pos.locator('.quick button').first().click();
  await pos.locator('[data-test=complete-sale]').click({ timeout: 3000 }).catch(() => {});
  await pos.waitForSelector('text=Sale complete', { timeout: 10000 });
  await pos.getByRole('button', { name: 'Print', exact: true }).click(); await pos.waitForTimeout(1500);
  const tickets = await pos.locator('.slips-offscreen .kt').evaluateAll((els) => els.map((e) => ({ head: e.querySelector('.head').textContent.trim(), items: [...e.querySelectorAll('.kt-line b:last-child')].map((b) => b.textContent.trim()) })));
  ok(tickets.length === 2, `Print: 2 kitchen tickets (${tickets.map((t) => t.head.split(' ·')[0]).join(', ')})`);
  ok(/^BAR/.test(tickets[0]?.head) && tickets[0].items.length === 1 && /^Coca-Cola/.test(tickets[0].items[0]), 'BAR ticket: only Coca-Cola (' + JSON.stringify(tickets[0]?.items) + ')');
  ok(/^KITCHEN/.test(tickets[1]?.head) && tickets[1].items.length === 1 && /^Butter Croissant/.test(tickets[1].items[0]), 'KITCHEN ticket: only Butter Croissant');
  ok(!tickets.some((t) => t.items.includes('Bananas')), 'Bananas (no station) is on no kitchen ticket');
  if (OUT) {
    // the slips are drawn off-screen for printing: show the kitchen tickets side by side for a picture
    await pos.evaluate(() => {
      const box = document.createElement('div');
      box.id = 'kt-shot'; box.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;display:flex;gap:16px;padding:12px;background:#ddd';
      document.querySelectorAll('.slips-offscreen .kt').forEach((k) => box.appendChild(k.cloneNode(true)));
      document.body.appendChild(box);
    });
    await pos.locator('#kt-shot').screenshot({ path: OUT + 'ks3-tickets.png' });
    await pos.evaluate(() => document.getElementById('kt-shot').remove());
  }
  // second press: only the customer receipt again
  await pos.getByRole('button', { name: 'Print', exact: true }).click(); await pos.waitForTimeout(1200);
  ok(await pos.locator('.slips-offscreen .kt').count() === 0, 'Print again: only the receipt, no second kitchen tickets');
  await pos.getByRole('button', { name: /New sale/ }).click(); await pos.waitForTimeout(500);

  // ── 3. A sale with only Bananas prints no kitchen ticket
  await pos.locator('.tile', { hasText: 'Bananas' }).first().click(); await pos.waitForTimeout(250);
  await pos.keyboard.press('F9'); await pos.waitForSelector('.pay'); await pos.locator('.quick button').first().click();
  await pos.locator('[data-test=complete-sale]').click({ timeout: 3000 }).catch(() => {});
  await pos.waitForSelector('text=Sale complete', { timeout: 10000 });
  await pos.getByRole('button', { name: 'Print', exact: true }).click(); await pos.waitForTimeout(1200);
  ok(await pos.locator('.slips-offscreen .kt').count() === 0, 'only items in no station: no kitchen ticket');

  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})();
