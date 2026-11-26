// Copyright (c) 2026 Chea Phearom. All rights reserved.
// Proprietary and confidential: see the LICENSE file.
// Browser test: the ADMIN role. A super admin creates an admin and ticks what they may do; the admin has every
// store manager right in all stores, only the ticked owner areas, cannot touch super admins / admins or their own
// permissions, and approves cashier actions with a PIN in any store.
// Needs: fresh seed data, API on :3000, vite preview on :4173, Playwright.
const { chromium } = require('playwright');
const OUT = process.env.SHOTS_DIR ? process.env.SHOTS_DIR + '/' : null;
const W = 'http://localhost:4173', API = 'http://localhost:3000/api/v1';
let fails = 0; const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
(async () => {
  const call = async (m, p, tok, body) => {
    const r = await fetch(API + p, { method: m, headers: { 'content-type': 'application/json', ...(tok && { authorization: 'Bearer ' + tok }) }, body: body && JSON.stringify(body) });
    const t = await r.text();
    return { status: r.status, body: t ? JSON.parse(t) : null };
  };
  const tokenOf = async (email, password = 'Password@123') => (await call('POST', '/auth/login', null, { email, password })).body.accessToken;
  const browser = await chromium.launch();
  const errors = [];
  const login = async (email, password = 'Password@123') => {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
    await page.goto(W + '/login'); await page.fill('#email', email); await page.fill('#password', password); await page.click('button[type=submit]');
    await page.waitForTimeout(1500);
    return page;
  };

  // ── 1. Super admin creates an admin with "Categories, drink options & recipes" only
  const sa = await login('admin@pos.local');
  await sa.goto(W + '/users'); await sa.waitForTimeout(800);
  await sa.getByRole('button', { name: 'New user' }).click(); await sa.waitForTimeout(300);
  const dlg = sa.locator('.p-dialog');
  await dlg.locator('.field', { hasText: 'Full name' }).locator('input').fill('Dara Admin');
  await dlg.locator('input[type=email]').fill('dara.admin@pos.local');
  await dlg.locator('.field', { hasText: 'Password' }).locator('input').fill('Password@123');
  await dlg.locator('.field', { hasText: 'Role *' }).locator('.p-select').click(); await sa.waitForTimeout(200);
  await sa.locator('.p-select-overlay .p-select-option', { hasText: /^Admin$/ }).click(); await sa.waitForTimeout(300);
  ok(await dlg.locator('.field', { hasText: 'Stores *' }).count() === 0, 'Admin: no store list (all stores)');
  ok(await dlg.locator('[data-test=admin-perms] input[type=checkbox]').count() === 9, 'super admin sees 9 permission tick boxes');
  await dlg.locator('label.perm', { hasText: 'Categories, drink options & recipes' }).locator('.p-checkbox').click();
  if (OUT) await dlg.screenshot({ path: OUT + 'admin1-new.png' });
  await dlg.getByRole('button', { name: 'Save' }).click(); await sa.waitForTimeout(1000);
  ok(/Categories, drink options & recipes/.test(await sa.locator('.p-datatable-tbody tr', { hasText: 'Dara Admin' }).innerText()), 'users list: Admin, All stores, its permissions');

  // ── 2. What the admin may do (API)
  const at = await tokenOf('dara.admin@pos.local');
  const me = (await call('GET', '/auth/me', at)).body;
  ok(me.role === 'ADMIN' && me.permissions.join() === 'catalogue', '/auth/me: role ADMIN, permissions [catalogue]');
  const stores = (await call('GET', '/stores', at)).body;
  ok(stores.length === 3, 'sees all 3 stores without being assigned');
  ok((await call('GET', `/reports/sales-summary?storeId=${stores[2].id}`, at)).status === 200, 'store manager right: reports of any store');
  const cat = await call('POST', '/categories', at, { name: 'Admin cat' });
  ok(cat.status === 201, 'ticked area: can create a category');
  ok((await call('POST', '/promotions', at, { name: 'x', type: 'PERCENT_OFF', value: 5, allProducts: true })).status === 403, 'not ticked: promotions refused');
  ok((await call('POST', '/api-keys', at, { name: 'x', scopes: ['products:read'] })).status === 403, 'not ticked: API keys refused');
  ok((await call('POST', '/auth/docs-session', at)).status === 403, 'owner only: API docs refused');
  const cashier = await call('POST', '/users', at, { email: 'new.cashier@pos.local', password: 'Password@123', fullName: 'New Cashier', role: 'CASHIER', storeIds: [stores[2].id] });
  ok(cashier.status === 201, 'can create a cashier in any store');
  ok((await call('POST', '/users', at, { email: 'new.mgr@pos.local', password: 'Password@123', fullName: 'New Mgr', role: 'STORE_MANAGER', storeIds: [stores[0].id] })).status === 403, 'without "Users": cannot create a store manager');
  ok((await call('POST', '/users', at, { email: 'new.adm@pos.local', password: 'Password@123', fullName: 'New Adm', role: 'ADMIN' })).status === 403, 'cannot create an admin');
  ok((await call('PATCH', `/users/${me.id}`, at, { permissions: ['catalogue', 'marketing', 'users'] })).status === 403, 'cannot give itself permissions');

  // ── 3. Super admin ticks more: it works at once
  const st = await tokenOf('admin@pos.local');
  const r = await call('PATCH', `/users/${me.id}`, st, { permissions: ['catalogue', 'marketing', 'users'] });
  ok(r.status === 200 && r.body.permissions.join() === 'catalogue,marketing,users', 'super admin adds Promotions and Users');
  ok((await call('POST', '/promotions', at, { name: 'Admin promo', type: 'PERCENT_OFF', value: 5, allProducts: true })).status === 201, 'now allowed: promotions (same login, no new token)');
  ok((await call('POST', '/users', at, { email: 'new.mgr@pos.local', password: 'Password@123', fullName: 'New Mgr', role: 'STORE_MANAGER', storeIds: [stores[0].id] })).status === 201, 'with "Users": can create a store manager');
  const saUser = (await call('GET', '/users?search=admin@pos.local', at)).body.data.find((u) => u.role === 'SUPER_ADMIN');
  ok((await call('PATCH', `/users/${saUser.id}`, at, { fullName: 'Hacked' })).status === 403, 'still cannot change a super admin');

  // ── 4. Admin PIN approves a cashier discount in any store
  ok((await call('POST', '/auth/approval-pin', at, { currentPassword: 'Password@123', pin: '7531' })).status === 200, 'admin sets an approval PIN');
  const ct = await tokenOf('new.cashier@pos.local');
  const ap = await call('POST', '/approvals', ct, { storeId: stores[2].id, action: 'DISCOUNT', percent: 30, pin: '7531' });
  ok(ap.status < 300 && /Dara Admin/.test(JSON.stringify(ap.body)), `admin PIN approves a 30% discount in ${stores[2].code}`);

  // ── 5. The admin's screens follow the ticks
  const ad = await login('dara.admin@pos.local');
  const nav = (await ad.locator('.sidebar nav').innerText()).replace(/\s+/g, ' ');
  ok(/Categories/.test(nav) && /Promotions/.test(nav) && /Users/.test(nav) && /Reports/.test(nav), 'menu: Categories, Promotions, Users, Reports');
  ok(!/Stores/.test(nav) && !/Integrations/.test(nav) && !/System monitor/.test(nav) && !/Customer display/.test(nav), 'menu: no Stores, Integrations, System monitor, Customer display');
  await ad.goto(W + '/integrations'); await ad.waitForTimeout(800);
  ok(ad.url() === W + '/', '/integrations sends the admin to the dashboard');
  await ad.goto(W + '/products'); await ad.waitForTimeout(1200);
  ok(await ad.getByRole('button', { name: 'New product' }).count() === 0, 'Products: no "New product" (not ticked)');
  await ad.goto(W + '/promotions'); await ad.waitForTimeout(1200);
  ok(await ad.getByRole('button', { name: 'New promotion' }).count() === 1, 'Promotions: "New promotion" (ticked)');
  await ad.goto(W + '/users'); await ad.waitForTimeout(800);
  await ad.locator('.p-datatable-tbody tr', { hasText: 'Dara Admin' }).click(); await ad.waitForTimeout(400);
  ok(await ad.locator('.p-dialog [data-test=admin-perms] input[type=checkbox]').count() === 0 && /only a super admin changes this/.test(await ad.locator('.p-dialog [data-test=admin-perms]').innerText()), 'own user: permissions shown read-only');
  if (OUT) await ad.screenshot({ path: OUT + 'admin2-menu.png' });

  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})();
