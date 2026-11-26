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

  // ── 4. Every other admin action writes an entry (sales are in Sales, not here)
  const req = async (m, path, body) => {
    const r = await fetch(API + path, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + at }, body: body && JSON.stringify(body) });
    const t = await r.text();
    if (r.status >= 400) throw new Error(`${m} ${path} → ${r.status} ${t.slice(0, 200)}`);
    return t ? JSON.parse(t) : null;
  };
  const stores = await req('GET', '/stores/directory');
  const [s1, s2] = stores;
  const prods = (await req('GET', `/products?storeId=${s1.id}&limit=100`)).data;
  const sellable = prods.find((x) => !x.isIngredient && x.trackStock && x.barcode);
  const ingredient = (await req('GET', '/products?limit=100')).data.find((x) => x.isIngredient);
  const cat = await req('POST', '/categories', { name: 'Audit cat' });
  await req('PATCH', `/categories/${cat.id}`, { name: 'Audit cat 2' });
  await req('DELETE', `/categories/${cat.id}`);
  const grp = await req('POST', '/modifiers', { name: 'Audit toppings', minSelect: 0, maxSelect: 2, options: [{ name: 'Jelly', priceDelta: 0.3 }, { name: 'Pearls', priceDelta: 0.5 }] });
  await req('DELETE', `/modifiers/${grp.id}`);
  await req('PUT', `/recipes/${sellable.id}`, { items: [{ ingredientId: ingredient.id, quantity: 10 }] });
  const key = await req('POST', '/api-keys', { name: 'Audit key', scopes: ['products:read'] });
  await req('DELETE', `/api-keys/${key.id ?? key.apiKey?.id}`);
  const sup = await req('POST', '/suppliers', { code: 'SUP-AUD', name: 'Audit Supplies' });
  await req('PATCH', `/suppliers/${sup.id}`, { phone: '012 999 888' });
  const tr = await req('POST', '/transfers', { fromStoreId: s1.id, toStoreId: s2.id, items: [{ productId: sellable.id, quantity: 1 }] });
  await req('POST', `/transfers/${tr.id}/cancel`);
  await req('PUT', `/inventory/${s1.id}/${sellable.id}`, { reorderLevel: 7 });
  const vb = await req('POST', '/vouchers/batches', { name: 'Audit vouchers', value: 5, count: 2, sold: false });
  const cards = await req('POST', '/wallet/cards', { count: 1 });
  const num = cards.cards?.[0]?.cardNumber;
  const card = (await req('GET', `/wallet/cards?search=${num}&limit=5`)).data.find((c) => c.cardNumber === num);
  await req('POST', `/wallet/cards/${card.id}/pin`, { pin: '4321' });
  const cu = await req('POST', '/customers', { name: 'Audit Member', phone: '+855 12 777 666' });
  await req('PATCH', `/customers/${cu.id}`, { email: 'audit.member@example.com' });
  await new Promise((r) => setTimeout(r, 500));
  const all = (await call('GET', '/audit?limit=200', at)).data;
  const has = (action, re) => all.some((e) => e.action === action && (!re || re.test(e.summary)));
  const expect = [
    ['CATEGORY_CREATED', /"Audit cat" created/], ['CATEGORY_CHANGED', /"Audit cat 2": name/], ['CATEGORY_DELETED', /"Audit cat 2" deleted/],
    ['DRINK_OPTIONS_CREATED', /"Audit toppings" created: Jelly, Pearls/], ['DRINK_OPTIONS_DELETED', /"Audit toppings" deleted/],
    ['RECIPE_CHANGED', new RegExp(`Recipe of ${sellable.name.replace(/[()]/g, '.')}: 1 ingredient`)],
    ['API_KEY_CREATED', /"Audit key" created.*scopes: products:read/], ['API_KEY_REVOKED', /"Audit key" revoked/],
    ['SUPPLIER_CREATED', /SUP-AUD Audit Supplies created/], ['SUPPLIER_CHANGED', /SUP-AUD Audit Supplies: phone/],
    ['TRANSFER_CREATED', /sent: 1 product/], ['TRANSFER_CANCELLED', /cancelled/],
    ['STORE_PRODUCT_CHANGED', /reorderLevel 7/],
    ['VOUCHER_BATCH_CREATED', /2 gift voucher\(s\) "Audit vouchers" of \$5\.00 created \(free\)/],
    ['WALLET_CARDS_CREATED', /1 wallet card\(s\) created/], ['WALLET_PIN_CHANGED', /PIN of wallet card ••••\d{4} set or changed/],
    ['CUSTOMER_CREATED', /Member Audit Member .* registered/], ['CUSTOMER_CHANGED', /Audit Member .*: email/],
  ];
  for (const [action, re] of expect) ok(has(action, re), `audit: ${action}` + (has(action) && !has(action, re) ? ' (summary: ' + all.find((e) => e.action === action).summary + ')' : ''));
  const secret = key.key ?? key.apiKey?.key ?? key.token;
  ok(!!secret && !JSON.stringify(all).includes(secret), 'the new API key itself is not in the audit log');
  ok(!JSON.stringify(all).includes('4321'), 'the wallet PIN is not in the audit log');

  // ── 5. Password changes, online orders handled by staff, wallet card numbers masked
  const pw = await req('POST', '/users', { email: 'pw.test@pos.local', password: 'Password@123', fullName: 'Pw Tester', role: 'CASHIER', storeIds: [s1.id] });
  const pwt = await tokenOf('pw.test@pos.local');
  const chg = await fetch(API + '/auth/change-password', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + pwt }, body: JSON.stringify({ currentPassword: 'Password@123', newPassword: 'Password@456' }) });
  ok(chg.status === 204, 'a cashier changes their own password');
  const menu = (await (await fetch(API + `/public/stores/${s1.code}/menu`)).json()).products;
  const plain = menu.find((x) => x.name === 'Butter Croissant') ?? menu[0];
  const placeOrder = async (name, payMethod) => (await fetch(API + `/public/stores/${s1.code}/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: [{ productId: plain.id, quantity: 2 }], customerName: name, phone: '012 345 670', payMethod }) })).status;
  // confirm payment is for KHQR orders waiting for the money; pay-at-counter orders are paid at the till
  ok(await placeOrder('Online One', 'KHQR') === 201 && await placeOrder('Online Two', 'COUNTER') === 201, 'two online orders placed (KHQR, pay at the counter)');
  const mt2 = await tokenOf('manager.pp@pos.local');
  const open = (await (await fetch(API + `/online-orders?storeId=${s1.id}`, { headers: { authorization: 'Bearer ' + mt2 } })).json());
  const openList = Array.isArray(open) ? open : open.data ?? open.orders ?? [];
  const o1 = openList.find((o) => o.customerName === 'Online One');
  const o2 = openList.find((o) => o.customerName === 'Online Two');
  const conf = await fetch(API + `/online-orders/${o1?.id}/confirm-payment`, { method: 'POST', headers: { authorization: 'Bearer ' + mt2 } });
  const canc = await fetch(API + `/online-orders/${o2?.id}/cancel`, { method: 'POST', headers: { authorization: 'Bearer ' + mt2 } });
  ok(conf.status < 300 && canc.status < 300, 'manager confirms one online order and cancels another');
  // wallet: activate, top up, block the new card
  await req('POST', `/wallet/cards/${card.id}/activate`, { storeId: s1.id, amount: 5, method: 'CASH' }).catch(() => null);
  await req('POST', `/wallet/cards/${card.id}/block`, { reason: 'lost' }).catch(() => null);
  await new Promise((r) => setTimeout(r, 500));
  const all2 = (await call('GET', '/audit?limit=200', at)).data;
  const has2 = (action, re) => all2.some((e) => e.action === action && (!re || re.test(e.summary)));
  ok(has2('PASSWORD_CHANGED', /Changed their own password/) && all2.find((e) => e.action === 'PASSWORD_CHANGED').userName === 'Pw Tester', 'audit: PASSWORD_CHANGED by the cashier');
  ok(!JSON.stringify(all2).includes('Password@456'), 'the new password is not in the audit log');
  ok(has2('ONLINE_ORDER_PAID', /Online order of Online One \(\$\d+\.\d\d, KHQR\) marked paid/), 'audit: ONLINE_ORDER_PAID with the customer and amount');
  ok(has2('ONLINE_ORDER_CANCELLED', /Online order of Online Two \(\$\d+\.\d\d\) cancelled \(was pay at counter\)/), 'audit: ONLINE_ORDER_CANCELLED with the customer, amount and former status');
  const walletEntries = all2.filter((e) => e.entityType === 'wallet_card' || e.entityType === 'wallet');
  ok(walletEntries.length >= 2 && walletEntries.every((e) => /••••\d{4}/.test(e.summary) || /wallet card\(s\) created/.test(e.summary)), 'wallet entries show cards as ••••1234 (' + walletEntries.map((e) => e.action).join(', ') + ')');
  ok(!JSON.stringify(all2).includes(num), 'the full wallet card number is not in the audit log');

  // ── 6. The Audit page
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
