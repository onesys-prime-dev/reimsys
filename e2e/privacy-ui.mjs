// Drives the privacy notice in Chrome: readable before sign-in, a new person must accept it after choosing a password, then it can be re-read in the app.
// Needs the API (4000) and web app (5173), and the seed applied. Usage: node e2e/privacy-ui.mjs [screenshot-dir]
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const API = process.env.API ?? 'http://localhost:4000/api';
const WEB = process.env.WEB ?? 'http://localhost:5173';
const OUT = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'reimsys-privacy-shots'));
fs.mkdirSync(OUT, { recursive: true });

let failed = 0;
const ok = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : x); if (!c) failed++; };

async function call(cookie, method, p, body) {
  const res = await fetch(API + p, { method, headers: { 'x-requested-with': 'reimsys', cookie, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { res, d: await res.json().catch(() => null) };
}
const adminLogin = await call('', 'POST', '/auth/login', { email: 'admin@example.com', password: 'Reimsys#2026' });
const admin = adminLogin.res.headers.get('set-cookie').split(';')[0];
const roles = (await call(admin, 'GET', '/roles')).d.roles;

const browser = await chromium.launch({ channel: 'chrome' });

for (const [label, size] of [['computer', { width: 1280, height: 860 }], ['phone', { width: 390, height: 780 }]]) {
  console.log(`\n${label}`);
  const ctx = await browser.newContext({ viewport: size, baseURL: WEB });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => m.type() === 'error' && !/40[0-9]/.test(m.text()) && errors.push(m.text()));

  // Before signing in
  await p.goto('/');
  await p.click('a:has-text("Privacy notice")');
  await p.waitForSelector('.notice');
  ok('the notice opens from the sign-in page', (await p.locator('h1').innerText()) === 'Privacy notice');
  ok('it names the one cookie and no tracking', (await p.locator('.notice').innerText()).includes('one cookie'));
  await p.screenshot({ path: path.join(OUT, `${label}-1-public.png`), fullPage: true });
  await p.click('a:has-text("Back to sign in")');
  await p.waitForSelector('input[type=email]');

  // A new person: password first, then the notice
  const email = `privacy.ui.${label}.${Date.now()}@example.com`;
  const made = (await call(admin, 'POST', '/users', { name: 'Privacy Walker', email, roleId: roles.find((r) => r.code === 'medref').id })).d;
  const tmp = made.temporaryPassword;
  const pw = 'PrivacyUi-12345';
  await p.fill('input[type=email]', email);
  await p.fill('input[type=password]', tmp);
  await p.click('button[type=submit]');
  await p.waitForSelector('h1:has-text("Choose a new password")');
  const pwInputs = p.locator('input[type=password]');
  await pwInputs.nth(0).fill(tmp);
  await pwInputs.nth(1).fill(pw);
  await pwInputs.nth(2).fill(pw);
  await p.click('button[type=submit]');
  await p.waitForSelector('h1:has-text("Privacy notice")');
  ok('after the password, the notice is shown instead of the app', (await p.locator('.shell').count()) === 0);
  const go = p.locator('button:has-text("I agree, continue")');
  ok('the button waits for the tick', await go.isDisabled());
  await p.screenshot({ path: path.join(OUT, `${label}-2-accept.png`), fullPage: true });
  await p.check('input[type=checkbox]');
  ok('ticking enables it', await go.isEnabled());
  await go.click();
  await p.waitForSelector('.shell');
  ok('the app opens once accepted', true);

  // Re-reading it inside the app
  if (label === 'computer') {
    await p.click('.side a:has-text("Privacy notice")');
    await p.waitForSelector('.page .notice');
    ok('it can be read again inside the app (sidebar link)', true);
  } else {
    await p.goto('/privacy');
    await p.waitForSelector('.page .notice');
    ok('it can be read again inside the app (address)', true);
    ok('nothing is cut off sideways on the phone', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  }
  await p.screenshot({ path: path.join(OUT, `${label}-3-in-app.png`), fullPage: true });
  ok('no errors in the browser console', errors.length === 0, errors.join(' | '));
  await ctx.close();
}
await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nAll privacy screens passed.');
process.exit(failed ? 1 : 0);
