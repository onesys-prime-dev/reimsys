// Opens every tab of Access control as the Super Admin (computer and phone) and reports errors, empty tabs and sideways scrolling.
// Needs the API (4000) and web app (5173). Usage: node e2e/access-tabs.mjs
import { chromium } from 'playwright';
const WEB = process.env.WEB ?? 'http://localhost:5173';
const browser = await chromium.launch({ channel: 'chrome' });
let failed = 0;
const ok = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : x); if (!c) failed++; };
for (const [label, size] of [['computer', { width: 1280, height: 860 }], ['phone', { width: 390, height: 780 }]]) {
  console.log('\n' + label);
  const ctx = await browser.newContext({ viewport: size, baseURL: WEB });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => m.type() === 'error' && !/40[0-9]|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  p.on('response', (r) => { if (r.status() >= 400 && !(r.status() === 401 && new URL(r.url()).pathname === '/api/me')) errors.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`); });
  await p.goto('/');
  await p.fill('input[type=email]', 'admin@example.com'); await p.fill('input[type=password]', 'Reimsys#2026'); await p.click('button[type=submit]');
  await p.waitForSelector('.shell');
  await p.goto('/access');
  await p.waitForSelector('.tabs button');
  const tabs = await p.$$eval('.tabs button', (bs) => bs.map((b) => b.textContent.trim()));
  console.log('  tabs:', tabs.join(', '));
  for (const t of tabs) {
    await p.click(`.tabs button:has-text("${t}")`);
    await p.waitForTimeout(900);
    const text = (await p.locator('main.page').innerText()).trim();
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    ok(`${t} tab has content`, text.length > 80, `only ${text.length} characters`);
    if (label === 'phone') ok(`${t} tab fits the phone`, !overflow);
  }
  // Users tab shows the privacy status
  await p.click('.tabs button:has-text("Users")');
  await p.waitForTimeout(600);
  ok('users show their privacy notice status', (await p.locator('main.page').innerText()).includes('Privacy notice'));
  ok('no errors in the browser', errors.length === 0, errors.join(' | '));
  await ctx.close();
}
await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nAll Access tabs passed.');
process.exit(failed ? 1 : 0);
