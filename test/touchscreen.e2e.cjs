// Copyright (c) 2026 Chea Phearom. All rights reserved.
// Proprietary and confidential: see the LICENSE file.
// Browser test: POS on a touchscreen till.
//  - the keyboard appears only when the cashier taps a field, not after a product tap or while scrolling
//  - pop-ups fit the screen and scroll inside, the page behind does not move
//  - a pop-up backdrop left behind (the "frozen screen") is removed by itself
// Needs: fresh seed data, API on :3000, vite preview on :4173, Playwright.
const { chromium } = require('playwright');
const OUT = process.env.SHOTS_DIR ? process.env.SHOTS_DIR + '/' : null;
const W = 'http://localhost:4173';
let fails = 0; const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch();
  // A small touchscreen till (1024 × 600), touch input
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 600 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  const shot = (n) => (OUT ? page.screenshot({ path: OUT + n + '.png' }) : Promise.resolve());

  await page.goto(W + '/login');
  await page.fill('#email', 'cashier1@pos.local'); await page.fill('#password', 'Password@123');
  await page.tap('button[type=submit]');
  await page.waitForURL(W + '/pos'); await page.waitForSelector('.tile'); await page.waitForTimeout(800);
  ok(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), 'the browser sees a touchscreen');
  if (await page.getByRole('button', { name: 'Open shift' }).count()) {
    await page.getByRole('button', { name: 'Open shift' }).tap(); await page.waitForTimeout(400);
    await page.locator('.p-dialog input').first().fill('50'); await page.locator('.p-dialog button[type=submit]').tap(); await page.waitForTimeout(800);
  }

  // ── Device keyboard: not after a product tap, yes after tapping the search box
  const search = page.locator('.search-input');
  await page.locator('.tile', { hasText: 'Bananas' }).tap(); await page.waitForTimeout(300);
  ok(await search.evaluate((el) => document.activeElement === el && el.getAttribute('inputmode') === 'none'),
    'after a product tap the search box has the cursor (scanner works) but no device keyboard');
  await search.tap(); await page.waitForTimeout(300);
  ok(await search.evaluate((el) => document.activeElement === el && !el.hasAttribute('inputmode')), 'tapping the search box brings the device keyboard');
  await page.keyboard.type('ban'); await page.waitForTimeout(200);
  ok((await search.inputValue()) === 'ban', 'typing works after the tap');
  await page.locator('.search-btn').tap();

  // ── On-screen keyboard mode: shows on tap, hides while scrolling the products
  await page.locator('.kt').first().tap(); await page.waitForTimeout(300);   // turn the on-screen keyboard on
  ok(await page.locator('.pos-kb').count() === 1, 'turning the on-screen keyboard on shows it');
  await page.locator('.tiles').evaluate((el) => { el.scrollTop = 200; el.dispatchEvent(new Event('scroll')); }); await page.waitForTimeout(300);
  ok(await page.locator('.pos-kb').count() === 0, 'scrolling the products hides it');
  await page.locator('.tile', { hasText: 'Bananas' }).tap(); await page.waitForTimeout(300);
  ok(await page.locator('.pos-kb').count() === 0, 'a product tap does not bring it back');
  await search.tap(); await page.waitForTimeout(300);
  ok(await page.locator('.pos-kb').count() === 1, 'tapping the search box brings it back');
  await page.locator('.kt').first().tap(); await page.waitForTimeout(300);   // off again
  ok(await page.locator('.pos-kb').count() === 0, 'turning it off hides it');

  // ── Pop-ups fit the screen: big mode on a small screen, the member pop-up
  await page.getByRole('button', { name: 'Big' }).tap(); await page.waitForTimeout(300);
  await page.keyboard.press('F4'); await page.waitForTimeout(600);
  const dlg = page.locator('.p-dialog').first();
  const box = await dlg.boundingBox();
  ok(box && box.y >= 0 && box.y + box.height <= 600 + 1 && box.x >= 0 && box.x + box.width <= 1024 + 1,
    `member pop-up fits the 1024×600 screen in big mode (${box && [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)].join(', ')})`);
  ok(await dlg.evaluate((d) => {
    const c = d.querySelector('.p-dialog-content'); const st = getComputedStyle(c);
    return st.overflowY === 'auto' || c.scrollHeight <= c.clientHeight;
  }), 'its content scrolls inside the window');
  ok(await dlg.evaluate((d) => [...d.querySelectorAll('input')].every((i) => i.getBoundingClientRect().right <= d.getBoundingClientRect().right + 1)), 'no field sticks out of the window');
  await page.mouse.wheel(0, 800); await page.waitForTimeout(200);
  ok(await page.evaluate(() => window.scrollY === 0 && document.scrollingElement.scrollTop === 0), 'scrolling does not move the page behind');
  await shot('touch-member-big');
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Normal' }).tap(); await page.waitForTimeout(300);

  // ── Frozen screen: an empty backdrop left behind is removed and taps work again
  await page.evaluate(() => {
    const m = document.createElement('div');
    m.className = 'p-dialog-mask p-overlay-mask'; m.id = 'stuck';
    m.style.cssText = 'position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,.01)';
    document.body.appendChild(m); document.body.classList.add('p-overflow-hidden');
  });
  const totalNow = async () => (await page.locator('.r.total .num').textContent()).trim();
  const before = await totalNow();
  await page.locator('.tile', { hasText: 'Bananas' }).click({ force: true, timeout: 2000 }).catch(() => undefined); await page.waitForTimeout(200);
  ok(await page.locator('#stuck').count() === 1 && (await totalNow()) === before, 'a leftover backdrop blocks taps (the bug)');
  await page.waitForTimeout(3600);
  ok(await page.locator('#stuck').count() === 0 && !(await page.evaluate(() => document.body.classList.contains('p-overflow-hidden'))), 'it is removed by itself within a few seconds');
  await page.locator('.tile', { hasText: 'Bananas' }).tap(); await page.waitForTimeout(300);
  ok((await totalNow()) !== before, 'taps work again without refreshing');
  // a real pop-up that stays open is never removed
  await page.keyboard.press('F4'); await page.waitForTimeout(4000);
  ok(await page.locator('.p-dialog').count() === 1, 'an open pop-up is left alone');
  await page.keyboard.press('Escape');

  console.log('page errors:', errors.length, errors.slice(0, 5));
  if (errors.length) fails++;
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
