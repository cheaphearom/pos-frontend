// Browser test: member app (phone login, points, wallet, order ahead with the account, history, reorder) + POS member QR.
// Needs: fresh seed data, API on :3000 (MEMBER_OTP_MODE=dev, the default outside production), vite preview on :4173, Playwright.
const { chromium, devices } = require('playwright');
const OUT = process.env.SHOTS_DIR ? process.env.SHOTS_DIR + '/' : null;
const W = 'http://localhost:4173';
let fails = 0; const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = (p) => { p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text())); return p; };
  const shot = (p, n) => (OUT ? p.screenshot({ path: OUT + n + '.png' }) : null);
  const text = async (p, sel) => (await p.locator(sel).first().textContent()).replace(/\s+/g, ' ').trim();

  async function login(p, phone) {
    await p.goto(W + '/m'); await p.waitForURL(/\/m\/login/);
    await p.fill('#m-phone', phone); await p.getByRole('button', { name: 'Send code' }).click();
    await p.waitForSelector('#m-code');
    const code = (await p.locator('.p-message-info b').textContent()).trim();
    return code;
  }

  // ── Existing member logs in (seed: Chea Sokunthea 012345678, 500 points, wallet card $20)
  const phone = watch(await (await browser.newContext({ ...devices['iPhone 13'] })).newPage());
  const code = await login(phone, '+855 12 345 678');
  ok(/^\d{6}$/.test(code), 'login code sent (test mode shows it)');
  await shot(phone, 'm0-login-code');
  await phone.fill('#m-code', '000000'); await phone.getByRole('button', { name: 'Log in' }).click(); await phone.waitForTimeout(600);
  ok((await phone.locator('.p-message-error').count()) === 1 && /Wrong code/.test(await text(phone, '.p-message-error')), 'wrong code is refused');
  await phone.fill('#m-code', ''); await phone.locator('#m-code').pressSequentially(code); // 6 digits → logs in by itself
  await phone.waitForURL(W + '/m'); await phone.waitForSelector('[data-test=points]'); await phone.waitForTimeout(500);
  ok((await text(phone, '.pnum')) === '500' && (await text(phone, '.wbal')) === '$20.00', 'home: 500 points, wallet $20.00');
  ok((await phone.getByText('Chea Sokunthea').count()) > 0, 'home greets the member by name');
  await shot(phone, 'm1-home');
  await phone.locator('.qr').click(); await phone.waitForTimeout(400);
  ok((await text(phone, '.bigqr .code')) === 'M0000001', 'member QR shows the member number');
  await shot(phone, 'm2-member-qr');
  await phone.keyboard.press('Escape'); await phone.waitForTimeout(300);

  // ── Order ahead, pay with the wallet
  await phone.locator('.cta').click(); await phone.waitForSelector('.store');
  await phone.locator('.store', { hasText: 'Central' }).click(); await phone.waitForSelector('.item'); await phone.waitForTimeout(800);
  ok((await phone.getByText('500 pts').count()) === 1, 'menu header shows the member points');
  await phone.locator('.item', { hasText: 'Butter Croissant' }).click(); await phone.waitForTimeout(200);
  await phone.locator('.item', { hasText: 'Butter Croissant' }).click(); await phone.waitForTimeout(200);
  await phone.locator('.cartbar').click(); await phone.waitForTimeout(1200);
  ok((await phone.locator('.memberbox').count()) === 1 && (await phone.locator('.sheet input[autocomplete=name]').count()) === 0, 'logged in: no name/phone to type');
  ok((await phone.locator('.pay button.on').textContent()).includes('Wallet $20.00'), 'wallet is the chosen payment');
  ok((await text(phone, '.grand')).includes('$3.30'), '2 croissants = $3.30');
  await shot(phone, 'm3-cart-member');
  await phone.getByRole('button', { name: /Pay with wallet · \$3.30/ }).click();
  await phone.waitForSelector('.q', { timeout: 10000 });
  ok(/^A\d{3}$/.test(await text(phone, '.q')) && (await phone.getByText('Paid from wallet').count()) === 1, 'paid from wallet at once, queue number ' + (await text(phone, '.q')));
  await shot(phone, 'm4-status');
  await phone.getByRole('link', { name: /Back to my account/ }).click(); await phone.waitForSelector('[data-test=points]'); await phone.waitForTimeout(600);
  ok((await text(phone, '.wbal')) === '$16.70' && (await text(phone, '.pnum')) === '503', 'home: wallet $16.70, points 503 (+3)');
  ok((await phone.locator('.aorder').count()) === 1, 'home shows the order in progress');

  // ── Second order: use points
  await phone.goto(W + '/order/PP01'); await phone.waitForSelector('.item'); await phone.waitForTimeout(600);
  await phone.locator('.item', { hasText: 'Butter Croissant' }).click(); await phone.waitForTimeout(200);
  await phone.locator('.cartbar').click(); await phone.waitForTimeout(1200);
  await phone.locator('.usepts').click(); await phone.waitForTimeout(300);
  ok((await text(phone, '.totals')).includes('Points (164)') && (await text(phone, '.grand')).includes('$0.01'), 'points pay all but 1 cent: ' + (await text(phone, '.grand')));
  await shot(phone, 'm5-points');
  await phone.getByRole('button', { name: /Pay with wallet/ }).click();
  await phone.waitForSelector('.q', { timeout: 10000 });
  ok((await phone.getByText('Points used (164)').count()) === 1, 'status page shows the points used');

  // ── History, receipt, order again
  await phone.goto(W + '/m/orders'); await phone.waitForSelector('.row-o'); await phone.waitForTimeout(400);
  ok((await phone.locator('.row-o').count()) === 2, 'history: 2 orders');
  await shot(phone, 'm6-history');
  await phone.locator('.row-o').nth(1).click(); await phone.waitForSelector('.earned');
  ok((await text(phone, '.earned')).includes('3 points') && (await text(phone, '.grand')).includes('$3.30'), 'receipt: paid $3.30, earned 3 points');
  await shot(phone, 'm7-receipt');
  await phone.getByRole('button', { name: 'Order this again' }).click(); await phone.waitForSelector('.sheet .line'); await phone.waitForTimeout(1000);
  ok((await phone.locator('.sheet .line').count()) === 1 && (await text(phone, '.sheet .line')).includes('2'), 'order again: same items in the cart');
  await phone.goto(W + '/m/points'); await phone.waitForSelector('.row-p');
  ok((await phone.locator('.row-p').count()) === 2, 'points history: earned 3, used 164 (' + (await phone.locator('.row-p').count()) + ' rows)');
  await phone.goto(W + '/m/profile'); await phone.waitForSelector('#p-name');
  await phone.fill('#p-email', 'thea@example.com'); await phone.getByRole('button', { name: 'Save' }).click(); await phone.waitForTimeout(600);
  ok((await phone.getByText('Saved').count()) === 1, 'profile saved');

  // ── New member signs up with a new number
  const p2 = watch(await (await browser.newContext({ ...devices['Pixel 7'] })).newPage());
  const code2 = await login(p2, '099 888 777');
  await p2.locator('#m-code').pressSequentially(code2); await p2.waitForSelector('#m-name');
  await shot(p2, 'm8-new-name');
  await p2.fill('#m-name', 'Sok Dara'); await p2.getByRole('button', { name: 'Create my membership' }).click();
  await p2.waitForSelector('[data-test=points]'); await p2.waitForTimeout(400);
  ok((await text(p2, '.pnum')) === '0' && (await p2.getByText('No wallet card yet').count()) === 1, 'new member: 0 points, no wallet card');
  await p2.goto(W + '/m/profile'); await p2.waitForSelector('#p-name'); await p2.getByRole('button', { name: 'Log out', exact: true }).click();
  await p2.waitForURL(/\/m\/login/);
  ok(true, 'log out goes back to the login page');

  // ── POS: scan the member QR
  const pos = watch(await (await browser.newContext({ viewport: { width: 1366, height: 820 } })).newPage());
  await pos.goto(W + '/login'); await pos.fill('#email', 'cashier1@pos.local'); await pos.fill('#password', 'Password@123'); await pos.click('button[type=submit]');
  await pos.waitForURL(W + '/pos'); await pos.waitForSelector('.tile'); await pos.waitForTimeout(1500);
  const s = pos.locator('.search-input');
  await s.fill('M0000001'); await s.press('Enter'); await pos.waitForTimeout(800);
  ok((await pos.getByText('Chea Sokunthea').count()) > 0 && (await pos.getByText('339 points').count()) > 0, 'POS: member QR links Chea Sokunthea (339 points)');
  await shot(pos, 'm9-pos-member');

  // Admin sees who uses the app
  await pos.goto(W + '/customers'); await pos.waitForTimeout(1200);
  ok((await pos.locator('.p-tag', { hasText: /^app$/ }).count()) === 2, 'customers list marks the 2 app members');

  console.log('page errors:', errors.length, errors.slice(0, 5));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  await browser.close();
})();
