// The eye button on every password box of the forced "Choose a new password" screen of a new account (computer and phone).
// Needs the API (4000) and web app (5173). Usage: node e2e/password-eye.mjs
import { chromium } from 'playwright';
const API = process.env.API ?? 'http://localhost:4000/api';
const WEB = process.env.WEB ?? 'http://localhost:5173';
let failed = 0;
const ok = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : x); if (!c) failed++; };
const call = async (cookie, m, p, b) => {
  const r = await fetch(API + p, { method: m, headers: { 'x-requested-with': 'reimsys', origin: new URL(API).origin, cookie, ...(b ? { 'content-type': 'application/json' } : {}) }, body: b ? JSON.stringify(b) : undefined });
  return { s: r.status, d: await r.json().catch(() => null), cookie: r.headers.get('set-cookie')?.split(';')[0] };
};
const admin = (await call('', 'POST', '/auth/login', { email: 'admin@example.com', password: 'Reimsys#2026' })).cookie;
const roles = (await call(admin, 'GET', '/roles')).d.roles;
const browser = await chromium.launch({ channel: 'chrome' });
const created = [];
for (const [label, size] of [['computer', { width: 1280, height: 800 }], ['phone', { width: 390, height: 780 }]]) {
  console.log('\n' + label);
  const email = `eye.${label}.${Date.now()}@example.com`;
  const made = await call(admin, 'POST', '/users', { name: 'Eye Tester', email, roleId: roles.find((r) => r.code === 'medref').id });
  created.push(email);
  const p = await (await browser.newContext({ viewport: size, baseURL: WEB })).newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto('/');
  await p.fill('input[type=email]', email);
  await p.fill('input[type=password]', made.d.temporaryPassword);
  await p.click('button[type=submit]');
  await p.waitForSelector('h1:has-text("Choose a new password")');
  const eyes = p.locator('.pw .eye');
  const boxes = p.locator('.pw input');
  ok('there is an eye on all three boxes', (await eyes.count()) === 3, String(await eyes.count()));
  await boxes.nth(1).fill('Eye-Test-Pass-1');
  ok('the new password is hidden at first', (await boxes.nth(1).getAttribute('type')) === 'password');
  await eyes.nth(1).click();
  ok('the eye shows what was typed', (await boxes.nth(1).getAttribute('type')) === 'text' && (await boxes.nth(1).inputValue()) === 'Eye-Test-Pass-1');
  ok('the eye button says "Hide password" while shown', (await eyes.nth(1).getAttribute('aria-label')) === 'Hide password');
  ok('the other boxes stay hidden', (await boxes.nth(0).getAttribute('type')) === 'password' && (await boxes.nth(2).getAttribute('type')) === 'password');
  const inside = await p.evaluate(() => { const i = document.querySelectorAll('.pw input')[1].getBoundingClientRect(); const e = document.querySelectorAll('.pw .eye')[1].getBoundingClientRect(); return e.left >= i.left && e.right <= i.right + 1 && e.top >= i.top && e.bottom <= i.bottom; });
  ok('the eye sits inside the box', inside);
  await p.screenshot({ path: process.env.TEMP + `/eye-${label}.png` });
  await eyes.nth(1).click();
  ok('clicking again hides it', (await boxes.nth(1).getAttribute('type')) === 'password');
  await boxes.nth(0).fill(made.d.temporaryPassword);
  await boxes.nth(1).fill('Eye-Test-Pass-1');
  await boxes.nth(2).fill('Eye-Test-Pass-1');
  await p.click('button:has-text("Update password")');
  await p.waitForFunction(() => !document.body.innerText.includes('Choose a new password'), null, { timeout: 10000 }).catch(() => {});
  ok('the password is changed and the next screen opens', !(await p.locator('h1:has-text("Choose a new password")').count()));
  ok('no errors in the browser', errors.length === 0, errors.join(' | '));
}
await browser.close();
const users = (await call(admin, 'GET', '/users?active=true')).d.users;
for (const e of created) { const id = users.find((x) => x.email === e)?.id; if (id) await call(admin, 'PATCH', `/users/${id}`, { isActive: false }); }
console.log(failed ? `\n${failed} FAILED` : '\nPassword eye works.');
process.exit(failed ? 1 : 0);
