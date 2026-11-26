// Copyright (c) 2026 Chea Phearom. All rights reserved.
// Proprietary and confidential: see the LICENSE file.
// Browser test: the audit log records shift closes (balanced or with a cash difference) and promotion
// create / change / delete, and the Audit page filters them.
// Needs: fresh seed data, API on :3000, vite preview on :4173, Playwright.
const { chromium } = require('playwright');
const OUT = process.env.SHOTS_DIR ? process.env.SHOTS_DIR + '/' : null;
const W = 'http://localhost:4173', API = 'http://localhost:3000/api/v1';
let fails = 0; const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
(async () => {
  const call = async (m, p, tok, body) => {
    const r = await fetch(API + p, { method: m, headers: { 'content-type': 'application/json', ...(tok && { authorization: 'Bearer ' + tok }) }, body: body && JSON.stringify(body) });
    return r.status === 204 ? null : r.json();
  };
  const tokenOf = async (email) => (await call('POST', '/auth/login', null, { email, password: 'Password@123' })).accessToken;
  const ct = await tokenOf('cashier1@pos.local');
  const at = await tokenOf('admin@pos.local');
  const storeId = (await call('GET', '/auth/me', ct)).stores[0].id;
  const audit = async (action) => (await call('GET', `/audit?action=${action}&limit=20`, at)).data;

  // ── 1. A shift closed $2 short (riel balances)
  const sh = await call('POST', '/shifts/open', ct, { storeId, openingCash: 50, openingKhr: 10000 });
  const closed = await call('POST', `/shifts/${sh.id}/close`, ct, { closingCash: 48, closingKhr: 10000, note: 'counted twice' });
  ok(Number(closed.difference) === -2, 'shift closed $2 short');
  await new Promise((r) => setTimeout(r, 300));
  const d = (await audit('SHIFT_CLOSED_DIFFERENCE'))[0];
  ok(d && d.entityId === sh.id && /closed their shift: expected \$50\.00, counted \$48\.00 \(short \$2\.00\); riel expected ៛10,000, counted ៛10,000 \(balances\) · counted twice/.test(d.summary), 'audit: SHIFT_CLOSED_DIFFERENCE "short $2.00", riel balances, the note');
  ok(d && d.details.difference === -2 && d.details.differenceKhr === 0 && d.userName && d.storeId === storeId, 'audit details: difference −2, riel 0, who and which store');

  // ── 2. A balanced shift, closed by the manager for the cashier
  const mt = await tokenOf('manager.pp@pos.local');
  const sh2 = await call('POST', '/shifts/open', ct, { storeId, openingCash: 20, openingKhr: 0 });
  await call('POST', `/shifts/${sh2.id}/close`, mt, { closingCash: 20, closingKhr: 0 });
  await new Promise((r) => setTimeout(r, 300));
  const b = (await audit('SHIFT_CLOSED'))[0];
  ok(b && b.entityId === sh2.id && /closed the shift of .+: expected \$20\.00, counted \$20\.00 \(balances\)/.test(b.summary), 'audit: SHIFT_CLOSED, manager closed the cashier\'s shift, balances');

  // ── 3. Promotions: create, change, delete
  const promo = await call('POST', '/promotions', at, { name: 'Audit test 10%', type: 'PERCENT_OFF', value: 10, allProducts: true, isActive: true });
  ok(!!promo.id, 'promotion created');
  await call('PATCH', `/promotions/${promo.id}`, at, { value: 15, isActive: false });
  await call('PATCH', `/promotions/${promo.id}`, at, { value: 15 }); // nothing changes: no entry
  await call('DELETE', `/promotions/${promo.id}`, at);
  await new Promise((r) => setTimeout(r, 300));
  const pc = (await audit('PROMOTION_CREATED')).find((x) => x.entityId === promo.id);
  const pch = (await audit('PROMOTION_CHANGED')).filter((x) => x.entityId === promo.id);
  const pd = (await audit('PROMOTION_DELETED')).find((x) => x.entityId === promo.id);
  ok(pc && /New promotion "Audit test 10%"/.test(pc.summary), 'audit: PROMOTION_CREATED');
  ok(pch.length === 1 && /value 10 → 15/.test(pch[0].summary) && /isActive true → false/.test(pch[0].summary), 'audit: one PROMOTION_CHANGED with "value 10 → 15, isActive true → false" (an edit that changes nothing is not logged)');
  ok(pd && /"Audit test 10%" deleted/.test(pd.summary), 'audit: PROMOTION_DELETED');

  // ── 4. The Audit page
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.goto(W + '/login'); await page.fill('#email', 'admin@pos.local'); await page.fill('#password', 'Password@123'); await page.click('button[type=submit]');
  await page.waitForTimeout(1500); await page.goto(W + '/audit'); await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Cash differences' }).click(); await page.waitForTimeout(1200);
  const rows = page.locator('.p-datatable-tbody tr');
  ok(await rows.count() === 1 && /short \$2\.00/.test(await rows.first().innerText()), 'Audit page: "Cash differences" shows the short shift');
  if (OUT) await page.screenshot({ path: OUT + 'audit-cash.png' });
  await page.getByRole('button', { name: 'Promotion changes' }).click(); await page.waitForTimeout(1200);
  ok(/value 10 → 15/.test(await rows.first().innerText()), 'Audit page: "Promotion changes" shows the change');
  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})();
