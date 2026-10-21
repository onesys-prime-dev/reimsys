// The privacy notice settings on screen: an administrator types the retention period and the contact in Access → Settings, saves, and the notice
// (readable before signing in) shows them; empty boxes show "To be confirmed". Puts the settings back. Needs the API (4000) and web app (5173).
// Usage: node e2e/privacy-settings-ui.mjs
import { chromium } from 'playwright';
const API = process.env.API ?? 'http://localhost:4000/api';
const WEB = process.env.WEB ?? 'http://localhost:5173';
let failed = 0;
const ok = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : x); if (!c) failed++; };
const call = async (cookie, m, p, b) => { const r = await fetch(API + p, { method: m, headers: { 'x-requested-with': 'reimsys', cookie, ...(b ? { 'content-type': 'application/json' } : {}) }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, d: await r.json().catch(() => null), cookie: r.headers.get('set-cookie')?.split(';')[0] }; };
const admin = (await call('', 'POST', '/auth/login', { email: 'admin@example.com', password: 'Reimsys#2026' })).cookie;
const cur = (await call(admin, 'GET', '/app-settings')).d.settings;
await call(admin, 'PUT', '/app-settings', { ...cur, privacyRetention: '', privacyContact: '' });
const b = await chromium.launch({ channel: 'chrome' });
try {
  const anon = await (await b.newContext({ viewport: { width: 1280, height: 860 }, baseURL: WEB })).newPage();
  await anon.goto('/privacy'); await anon.waitForSelector('.notice');
  ok('with empty boxes the notice says "To be confirmed" twice', (await anon.locator('.notice').innerText()).split('To be confirmed').length === 3);

  const p = await (await b.newContext({ viewport: { width: 1280, height: 860 }, baseURL: WEB })).newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto('/'); await p.fill('input[type=email]', 'admin@example.com'); await p.fill('input[type=password]', 'Reimsys#2026'); await p.click('button[type=submit]'); await p.waitForSelector('.shell');
  await p.goto('/access'); await p.click('.tabs button:has-text("Settings")');
  await p.waitForSelector('input[aria-label="How long records are kept"]');
  ok('the Privacy notice settings are there as text boxes', await p.locator('input[aria-label="Data protection contact"][type=text]').count() === 1 && await p.locator('input[aria-label="Notice version"][type=number]').count() === 1);
  await p.fill('input[aria-label="How long records are kept"]', 'Receipts are kept for 10 years.');
  await p.fill('input[aria-label="Data protection contact"]', 'Dana Cruz, dpo@company.com');
  await p.click('button:has-text("Save settings")');
  await p.locator('#toast').first().waitFor({ timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(600);
  await anon.reload(); await anon.waitForSelector('.notice');
  const t = await anon.locator('.notice').innerText();
  ok('the notice shows what was typed', t.includes('Receipts are kept for 10 years.') && t.includes('Dana Cruz, dpo@company.com'), t.slice(0, 400));
  ok('and no longer says "To be confirmed"', !t.includes('To be confirmed'));
  await p.goto('/access'); await p.waitForSelector('.urow');
  ok('the Access user list shows who accepted the notice', (await p.locator('main.page').innerText()).includes('Privacy notice accepted'));
  ok('no errors in the browser', errors.length === 0, errors.join(' | '));
} finally {
  await b.close();
  await call(admin, 'PUT', '/app-settings', { ...cur });
}
console.log(failed ? `\n${failed} FAILED` : '\nPrivacy notice settings work on screen.');
process.exit(failed ? 1 : 0);
