// Browser test: System monitor page (super admins only) — status cards, charts, anomaly scores, alerts, test
// Telegram button, refresh every 15 s that stops while the tab is hidden, Khmer.
// Needs: pos-backend demo data, API on :3000 with the ML detector reachable (DETECTOR_URL), vite preview on :4173, Playwright.
const { chromium } = require('playwright');
const OUT = process.env.SHOTS_DIR ? process.env.SHOTS_DIR + '/' : null;
const W = 'http://localhost:4173';
let fails = 0; const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };

async function login(page, email) {
  await page.goto(W + '/login'); await page.waitForSelector('#email');
  await page.fill('#email', email); await page.fill('#password', 'Password@123'); await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  const calls = [];
  page.on('request', (r) => r.url().includes('/api/v1/monitoring/') && calls.push({ url: r.url(), at: Date.now() }));

  // A store manager does not see the page.
  await login(page, 'manager.pp@pos.local');
  ok((await page.locator('.nav-item', { hasText: 'System monitor' }).count()) === 0, 'manager: no "System monitor" menu item');
  await page.goto(W + '/monitor'); await page.waitForTimeout(800);
  ok(!page.url().endsWith('/monitor') || (await page.locator('h1', { hasText: 'System monitor' }).count()) === 0, 'manager: /monitor is not shown');
  await page.evaluate(() => localStorage.clear());

  await login(page, 'admin@pos.local');
  await page.locator('.nav-item', { hasText: 'System monitor' }).click();
  await page.waitForURL(W + '/monitor');
  await page.waitForSelector('[data-status="detector"]');
  for (const [key, title] of [['api', 'API'], ['db', 'Database'], ['redis', 'Redis'], ['queue', 'Webhook queue'], ['detector', 'Anomaly detector']]) {
    const card = page.locator(`[data-status="${key}"]`);
    const cls = await card.getAttribute('class');
    ok((await card.textContent()).includes(title) && /\b(ok|warn|fail)\b/.test(cls), `status card ${title} (${cls.match(/\b(ok|warn|fail)\b/)[1]})`);
  }
  ok((await page.locator('[data-status="db"]').getAttribute('class')).includes('ok'), 'database is green');
  ok((await page.locator('[data-status="detector"]').textContent()).includes('Trained'), 'detector card shows it is trained');
  ok((await page.locator('.card canvas').count()) >= 4 + 2, 'four metric charts and score charts');
  for (const h of ['Requests per minute', 'Error rate (5xx)', 'p95 response time', 'Sales per minute']) ok((await page.locator('h3', { hasText: h }).count()) === 1, `chart "${h}"`);
  for (const m of ['Rules', 'PCA', 'Isolation Forest']) ok((await page.locator('h3', { hasText: m }).count()) === 1, `score chart "${m}"`);
  const rows = await page.locator('.p-datatable-tbody tr').count();
  const firstRow = rows ? (await page.locator('.p-datatable-tbody tr').first().textContent()) : '';
  ok(rows > 0 && /pos-(api|worker)/.test(firstRow), `alerts table: ${rows} row(s), first names a POS service`);
  if (OUT) await page.screenshot({ path: OUT + 'monitor.png', fullPage: true });

  // Test Telegram button: without a bot token the detector's message is shown.
  await page.getByRole('button', { name: 'Send test Telegram message' }).click();
  await page.waitForSelector('.p-toast-message');
  ok((await page.locator('.p-toast-message').textContent()).includes('Telegram'), 'test button shows the detector answer');

  // Refresh every 15 s, paused while the tab is hidden.
  const statusCalls = () => calls.filter((c) => c.url.includes('/monitoring/status')).length;
  const before = statusCalls();
  await page.waitForTimeout(16_000);
  ok(statusCalls() > before, 'refreshed after 15 s');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  const hiddenAt = statusCalls();
  await page.waitForTimeout(16_000);
  ok(statusCalls() === hiddenAt, 'no refresh while the tab is hidden');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(1500);
  ok(statusCalls() > hiddenAt, 'refreshes again when the tab is visible');

  // Khmer
  await page.evaluate(() => localStorage.setItem('ui.lang', 'km'));
  await page.reload(); await page.waitForSelector('[data-status="detector"]'); await page.waitForTimeout(800);
  const km = (await page.locator('body').textContent()).replace(/\s+/g, ' ');
  ok(km.includes('តាមដានប្រព័ន្ធ') && km.includes('មូលដ្ឋានទិន្នន័យ') && km.includes('ការជូនដំណឹងថ្មីៗ'), 'page in Khmer');
  if (OUT) await page.screenshot({ path: OUT + 'monitor-km.png', fullPage: true });

  // Phone width: no horizontal scroll
  await page.evaluate(() => localStorage.setItem('ui.lang', 'en'));
  await page.setViewportSize({ width: 390, height: 844 }); await page.reload(); await page.waitForSelector('[data-status="detector"]'); await page.waitForTimeout(800);
  const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const contentFits = await page.evaluate(() => [...document.querySelectorAll('.page.monitor > *')].every((e) => e.getBoundingClientRect().right <= window.innerWidth + 1));
  await page.goto(W + '/'); await page.waitForTimeout(1200);
  const dashboardWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  ok(contentFits && pageWidth <= dashboardWidth, `phone width: monitor content fits (page ${pageWidth}px, dashboard ${dashboardWidth}px)`);
  await page.goto(W + '/monitor'); await page.waitForSelector('[data-status="detector"]'); await page.waitForTimeout(800);
  if (OUT) await page.screenshot({ path: OUT + 'monitor-phone.png', fullPage: true });

  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
