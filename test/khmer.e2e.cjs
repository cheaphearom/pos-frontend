// Browser test: Khmer interface — switch on the login page, POS in Khmer (menu text, Khmer product and category
// names, payment, receipt), back to English, customer display follows, online menu and member app in Khmer.
// Needs: fresh seed data (with Khmer names), API on :3000, vite preview on :4173, Playwright.
const { chromium, devices } = require('playwright');
const OUT = process.env.SHOTS_DIR ? process.env.SHOTS_DIR + '/' : null;
const W = 'http://localhost:4173';
let fails = 0; const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 820 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  const shot = (n, p = page) => (OUT ? p.screenshot({ path: OUT + n + '.png' }) : null);
  const body = async (p = page) => (await p.locator('body').textContent()).replace(/\s+/g, ' ');

  await page.goto(W + '/login'); await page.waitForSelector('#email');
  ok((await body()).includes('Sign in to manage your stores'), 'login page starts in English');
  await page.getByRole('button', { name: 'ប្តូរទៅភាសាខ្មែរ' }).click(); await page.waitForTimeout(300);
  ok((await body()).includes('ចូលដើម្បីគ្រប់គ្រងហាងរបស់អ្នក') && (await page.locator('html').getAttribute('lang')) === 'km', 'login page in Khmer');
  await shot('h0-login');
  await page.fill('#email', 'cashier1@pos.local'); await page.fill('#password', 'Password@123'); await page.click('button[type=submit]');
  await page.waitForURL(W + '/pos'); await page.waitForSelector('.tile'); await page.waitForTimeout(1500);
  ok((await page.locator('.chip', { hasText: 'ភេសជ្ជៈ' }).count()) === 1 && (await page.locator('.tile', { hasText: 'ទឹកសុទ្ធ 500ml' }).count()) === 1, 'POS: Khmer category and product names');
  ok((await body()).includes('បើកវេន'), 'POS: "Open shift" in Khmer');
  await page.locator('button', { hasText: 'បើកវេន' }).first().click(); await page.waitForTimeout(300);
  await page.locator('.p-dialog input').first().fill('20'); await page.locator('.p-dialog button[type=submit]').click(); await page.waitForTimeout(800);
  const s = page.locator('.search-input');
  ok((await s.getAttribute('placeholder')).startsWith('ស្កេនបាកូដ'), 'search box placeholder in Khmer');
  await s.fill('2*885000000001'); await s.press('Enter'); await page.waitForTimeout(400);
  ok((await page.locator('.ln-name').first().textContent()).includes('ទឹកសុទ្ធ'), 'cart line in Khmer');
  ok((await body()).includes('សរុបរង') && (await body()).includes('បង់ $'), 'totals and Pay button in Khmer');
  await shot('h1-pos');
  await page.keyboard.press('F9'); await page.waitForSelector('.pay');
  ok((await page.locator('.p-dialog').textContent()).includes('ចំនួនត្រូវបង់') && (await page.locator('.p-dialog').textContent()).includes('សាច់ប្រាក់ ៛'), 'payment dialog in Khmer');
  await shot('h2-pay');
  await page.locator('.quick button').last().click();
  await page.waitForSelector('.receipt-box'); await page.waitForTimeout(500);
  const rec = (await page.locator('.receipt-box').textContent()).replace(/\s+/g, ' ');
  ok(rec.includes('ទឹកសុទ្ធ 500ml') && rec.includes('សរុប') && rec.includes('សូមអរគុណ'), 'receipt in Khmer with the Khmer product name');
  await shot('h3-receipt');
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);

  // Customer display (another window) follows the language
  const disp = await ctx.newPage();
  await disp.goto(W + '/display'); await disp.waitForTimeout(1200);
  ok((await disp.locator('html').getAttribute('lang')) === 'km', 'customer display opens in Khmer');
  await page.getByRole('button', { name: 'Switch to English' }).click(); await page.waitForTimeout(500);
  ok((await body()).includes('Subtotal') || (await body()).includes('Scan or tap a product to start'), 'back to English on the POS');
  ok((await page.locator('.tile', { hasText: 'Mineral Water 500ml' }).count()) === 1, 'English product names again');
  await disp.waitForTimeout(500);
  ok((await disp.locator('html').getAttribute('lang')) === 'en', 'customer display followed to English');

  // Online menu + member app in Khmer (a customer's phone)
  const phone = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage();
  phone.on('pageerror', (e) => errors.push(e.message));
  await phone.goto(W + '/order/PP01'); await phone.waitForSelector('.item');
  await phone.getByRole('button', { name: 'ប្តូរទៅភាសាខ្មែរ' }).click(); await phone.waitForTimeout(400);
  ok((await phone.locator('.item', { hasText: 'អាមេរិកាណូ' }).count()) === 1 && (await phone.locator('.cats button', { hasText: 'កាហ្វេ និងតែ' }).count()) === 1, 'online menu: Khmer drink and category names');
  await phone.locator('.item', { hasText: 'នំក្រូសង់ប៊ឺ' }).click(); await phone.waitForTimeout(300);
  await phone.locator('.cartbar').click(); await phone.waitForTimeout(1200);
  ok((await body(phone)).includes('ការកម្ម៉ង់របស់អ្នក') && (await body(phone)).includes('បង់នៅបញ្ជរ'), 'online cart in Khmer');
  await shot('h4-online', phone);
  await phone.goto(W + '/m/login'); await phone.waitForSelector('#m-phone');
  ok((await body(phone)).includes('ផ្ញើលេខកូដ') && (await body(phone)).includes('លេខទូរស័ព្ទ'), 'member login in Khmer (language remembered)');
  await shot('h5-member', phone);

  console.log('page errors:', errors.length, errors.slice(0, 5));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  await browser.close();
})();
