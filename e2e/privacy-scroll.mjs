// The privacy notice must scroll with the mouse wheel on a computer in a short window, so its buttons can be reached (the browser window itself is locked
// on computers, so these pages scroll inside). Playwright's own scrolling reaches hidden areas, so this uses real wheel turns.
// Also: a first-time reader must tick the agreement before continuing. Needs the API (4000) and web app (5173).
import { chromium } from 'playwright';
import { call, login } from './payment-helpers.mjs';
const WEB = process.env.WEB ?? 'http://localhost:5173';
let failed = 0;
const ok = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : x); if (!c) failed++; };
const b = await chromium.launch({ channel: 'chrome' });
const inView = async (p, loc) => { const r = await loc.boundingBox(); const h = await p.evaluate(() => innerHeight); return !!r && r.y >= 0 && r.y + r.height <= h + 1; };
const wheelDown = async (p) => { await p.mouse.move(640, 300); for (let i = 0; i < 12; i++) await p.mouse.wheel(0, 600); await p.waitForTimeout(300); };

console.log('Signed out, a short computer window');
const p = await (await b.newContext({ viewport: { width: 1280, height: 520 }, baseURL: WEB })).newPage();
await p.goto('/privacy'); await p.waitForSelector('.notice');
const back = p.getByRole('link', { name: /Back to sign in/ });
ok('the button is below the fold before scrolling', !(await inView(p, back)));
await wheelDown(p);
ok('the mouse wheel scrolls the notice down to the button', await inView(p, back));
await back.click();
ok('and the button works', await p.locator('input[type=email]').first().waitFor({ timeout: 4000 }).then(() => true, () => false));

console.log('A first-time reader (the version is raised so Ana must accept it again)');
const admin = await login('admin@example.com');
const cur = (await call(admin, 'GET', '/app-settings')).d.settings;
await call(admin, 'PUT', '/app-settings', { ...cur, privacyVersion: cur.privacyVersion + 1 });
try {
  const q = await (await b.newContext({ viewport: { width: 1280, height: 520 }, baseURL: WEB })).newPage();
  await q.goto('/'); await q.fill('input[type=email]', 'ana.reyes@example.com'); await q.fill('input[type=password]', 'Reimsys#2026'); await q.click('button[type=submit]');
  await q.waitForSelector('h1:has-text("Privacy notice")');
  const go = q.getByRole('button', { name: /I agree, continue/ });
  ok('the agree button waits for the tick', await go.isDisabled());
  ok('the tick says she agrees to the terms', (await q.locator('label.check').innerText()).toLowerCase().includes('agree'));
  await wheelDown(q);
  ok('the mouse wheel reaches the agreement and the button', await inView(q, go));
  await q.check('input[type=checkbox]');
  ok('ticking enables it', await go.isEnabled());
  await go.click();
  ok('then the app opens', await q.waitForSelector('.shell', { timeout: 5000 }).then(() => true, () => false));
} finally {
  await call(admin, 'POST', '/me/privacy', {});
  await call(admin, 'PUT', '/app-settings', { ...cur });
}
await b.close();
process.exit(failed ? 1 : 0);
