// Browser test: recipes, option effects, ingredient stock used by café sales, usage report.
// Needs: fresh seed data, API on :3000, vite preview on :4173, Playwright.
const { chromium } = require('playwright');
const OUT = process.env.SHOTS_DIR ? process.env.SHOTS_DIR + '/' : null;
const W = 'http://localhost:4173', API = 'http://localhost:3000/api/v1';
let fails = 0; const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const login = async (email) => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 820 } });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
    await p.goto(W + '/login'); await p.fill('#email', email); await p.fill('#password', 'Password@123'); await p.click('button[type=submit]'); await p.waitForTimeout(1500);
    return p;
  };
  const shot = (p, n) => (OUT ? p.screenshot({ path: OUT + n + '.png' }) : null);

  const ad = await login('admin@pos.local');
  const tok = await ad.evaluate(() => localStorage.getItem('pos.accessToken'));
  const get = async (p) => (await fetch(API + p, { headers: { Authorization: 'Bearer ' + tok } })).json();
  const store = (await get('/stores')).find((s) => s.code === 'PP01');
  const beansStock = async () => Number((await get(`/products/lookup?code=IN-001&storeId=${store.id}`)).stock);

  await ad.goto(W + '/recipes'); await ad.waitForSelector('.p-datatable-tbody tr'); await ad.waitForTimeout(500);
  const latteRow = ad.locator('.p-datatable-tbody tr', { hasText: /^\s*Latte/ }).first();
  ok((await latteRow.textContent()).match(/\$0\.\d{4}/) && (await latteRow.textContent()).includes('%'), 'recipes list shows Latte cost and margin: ' + (await latteRow.textContent()).replace(/\s+/g, ' ').trim());
  await shot(ad, '90-recipes');
  await latteRow.click(); await ad.waitForTimeout(1000);
  ok((await ad.locator('.p-drawer .p-datatable').first().locator('tbody tr').count()) === 5, 'Latte base recipe has 5 ingredients');
  ok((await ad.locator('.p-drawer').textContent()).includes('Fresh milk → Oat milk') && (await ad.locator('.p-drawer').textContent()).includes('+30% all (not pieces)'), 'option effects listed (oat replaces milk, Large +30%)');
  // Try it: choose Large
  await ad.locator('.p-drawer .p-select', { hasText: 'Medium' }).click(); await ad.locator('.p-select-option', { hasText: 'Large' }).click(); await ad.waitForTimeout(1000);
  const prev = await ad.locator('.p-drawer .card').last().textContent();
  ok(prev.includes('23.4 g') && prev.includes('Cup 16oz'), 'preview with Large: 23.4 g beans and a 16oz cup');
  await shot(ad, '91-recipe-editor');
  await ad.keyboard.press('Escape');

  // Ingredients on the products page, with the pack helper
  await ad.goto(W + '/products'); await ad.waitForTimeout(800);
  await ad.locator('.p-selectbutton').getByText('Ingredients', { exact: true }).click(); await ad.waitForTimeout(1000);
  ok((await ad.locator('.p-datatable-tbody tr').count()) === 12, 'products page: 12 ingredients');
  await ad.getByRole('button', { name: 'New ingredient' }).click(); await ad.waitForTimeout(300);
  await ad.locator('.p-dialog input').nth(0).fill('IN-099'); await ad.locator('.p-dialog input').nth(2).fill('Condensed milk');
  await ad.locator('.p-dialog input[placeholder="Pack size"]').fill('390'); await ad.locator('.p-dialog input[placeholder="Pack price"]').fill('1.95'); await ad.locator('.p-dialog input[placeholder="Pack price"]').blur(); await ad.waitForTimeout(300);
  ok((await ad.locator('.p-dialog .field', { hasText: 'Cost per' }).locator('input').inputValue()).startsWith('0.005'), 'pack helper: 390 g for $1.95 = $0.005 per g');
  await shot(ad, '92-new-ingredient');
  await ad.getByRole('button', { name: 'Save' }).click(); await ad.waitForTimeout(800);

  // A café sale takes ingredients out of stock
  const before = await beansStock();
  const pos = await login('cashier1@pos.local');
  await pos.waitForSelector('.tile'); await pos.waitForTimeout(800);
  ok(!(await pos.locator('.chip', { hasText: 'Ingredients' }).count()), 'POS hides the Ingredients category');
  if (await pos.getByRole('button', { name: 'Open shift' }).count()) { await pos.getByRole('button', { name: 'Open shift' }).click(); await pos.locator('.p-dialog input').fill('50'); await pos.locator('.p-dialog button[type=submit]').click(); await pos.waitForTimeout(600); }
  await pos.locator('.tile', { hasText: 'Cappuccino' }).click(); await pos.waitForTimeout(300);
  await pos.locator('.choice', { hasText: 'Extra shot' }).click();
  await pos.getByRole('button', { name: /^Add \$/ }).click();
  await pos.keyboard.press('F9'); await pos.waitForSelector('.pay'); await pos.locator('.quick button').first().click(); await pos.waitForSelector('text=Sale complete');
  const after = await beansStock();
  ok(Math.round((before - after) * 1000) / 1000 === 27, `Cappuccino + extra shot used ${Math.round((before - after) * 1000) / 1000} g beans (18 + 9)`);

  // Stock history and usage report
  await ad.goto(W + '/inventory'); await ad.waitForTimeout(800);
  await ad.getByText('Stock history').click(); await ad.waitForTimeout(1200);
  ok(await ad.locator('.p-datatable-tbody tr', { hasText: 'Recipe' }).count() > 0, 'stock history shows "Recipe" movements');
  await shot(ad, '93-stock-history');
  await ad.goto(W + '/reports'); await ad.waitForTimeout(1500);
  ok(await ad.getByText('Ingredients used').count() === 1 && (await ad.locator('.card', { hasText: 'Ingredients used' }).textContent()).includes('Coffee beans'), 'reports: ingredients used');
  await ad.locator('h3', { hasText: 'Ingredients used' }).scrollIntoViewIfNeeded(); await shot(ad, '94-report-ingredients');
  console.log('page errors:', errors.length, errors.slice(0, 5));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  await browser.close();
})();
