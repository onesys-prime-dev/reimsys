// Appearance: each person's theme, colour, text size and spacing (kept on their account), and the company's colour. Needs the API (4000) and web app (5173).
// Usage: node e2e/appearance.mjs [screenshot-dir]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { call, login } from './payment-helpers.mjs';

const OUT = process.argv[2] ?? path.join(process.env.TEMP ?? '.', 'reimsys-appearance');
fs.mkdirSync(OUT, { recursive: true });
let failed = 0;
const ok = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : x); if (!c) failed++; };
const cookie = await login('ana.reyes@example.com');
const admin = await login('admin@example.com');
const before = (await call(cookie, 'GET', '/me')).d.user;
const company = (await call(admin, 'GET', '/app-settings')).d.settings;
const DEFAULT = { textSize: 'medium', density: 'comfortable', accent: 'default' };
const reset = () => call(cookie, 'PATCH', '/me/preferences', { theme: before.theme, appearance: before.appearance ?? DEFAULT });

console.log('The saved choices');
await reset();
await call(cookie, 'PATCH', '/me/preferences', { theme: 'light', appearance: DEFAULT });
ok('a new account starts with the defaults', (await call(cookie, 'GET', '/me')).d.user.appearance.accent === 'default');
ok('a bad size is refused', (await call(cookie, 'PATCH', '/me/preferences', { appearance: { textSize: 'huge', density: 'compact', accent: 'blue' } })).s === 400);
ok('an unknown colour is refused', (await call(cookie, 'PATCH', '/me/preferences', { appearance: { textSize: 'small', density: 'compact', accent: 'neon' } })).s === 400);
const good = await call(cookie, 'PATCH', '/me/preferences', { appearance: { textSize: 'large', density: 'compact', accent: 'purple' } });
ok('a good one is saved on the account', good.s === 200 && good.d.user.appearance.accent === 'purple' && good.d.user.appearance.textSize === 'large');
ok('and the theme is untouched by it', good.d.user.theme === 'light');
ok('the company colour can be changed by an admin, not by a Med Ref', (await call(admin, 'PUT', '/app-settings', { ...company, brandAccent: 'blue' })).s === 200 && (await call(cookie, 'PUT', '/app-settings', { ...company, brandAccent: 'rose' })).s === 403);
ok('an unknown company colour is refused', (await call(admin, 'PUT', '/app-settings', { ...company, brandAccent: 'neon' })).s === 400);
await call(admin, 'PUT', '/app-settings', { ...company, brandAccent: 'teal' });
await call(cookie, 'PATCH', '/me/preferences', { theme: 'light', appearance: DEFAULT });

const b = await chromium.launch({ channel: 'chrome' });
const errors = [];
async function open(email, size) {
  const ctx = await b.newContext({ viewport: size, baseURL: 'http://localhost:5173' });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto('/'); await p.fill('input[type=email]', email); await p.fill('input[type=password]', 'Reimsys#2026'); await p.click('button[type=submit]'); await p.waitForSelector('.shell');
  return { ctx, p };
}
const css = (p, v) => p.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim().toLowerCase(), v);
const attr = (p, a) => p.evaluate((n) => document.documentElement.getAttribute(n), a);
const gotoLook = async (p) => { await p.goto('/profile'); await p.getByRole('tab', { name: 'Appearance' }).click(); await p.waitForSelector('#ap-h'); };

console.log('\nThe Appearance card');
{
  const { ctx, p } = await open('ana.reyes@example.com', { width: 1280, height: 1000 });
  await gotoLook(p);
  ok('the theme choices are picture cards', (await p.locator('.ap-theme').count()) === 3);
  ok('there is the company colour and six more', (await p.locator('.ap-sw').count()) === 7);
  ok('the four groups are there', (await p.getByRole('radiogroup').count()) >= 4);
  await p.screenshot({ path: path.join(OUT, 'desktop-light.png') });
  await p.getByRole('radio', { name: 'Purple' }).click(); await p.waitForTimeout(600);
  ok('choosing a colour changes it on the page straight away', (await css(p, '--accent')) === '#6d45b8', await css(p, '--accent'));
  await p.getByRole('radio', { name: 'Large' }).click(); await p.waitForTimeout(600);
  const big = await p.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
  ok('Large makes the text bigger', Number(await css(p, '--tscale')) > 1 && big > 14.6, String(big));
  await p.getByRole('radio', { name: 'Small' }).click(); await p.waitForTimeout(600);
  const small = await p.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
  ok('Small is smaller than Large', small < big, `${small} vs ${big}`);
  await p.getByRole('radio', { name: 'Compact' }).click(); await p.waitForTimeout(600);
  ok('Compact is applied', (await attr(p, 'data-density')) === 'compact');
  await p.getByRole('radio', { name: /^Dark/ }).click(); await p.waitForTimeout(600);
  ok('the dark theme uses the lighter version of the colour', (await css(p, '--accent')) === '#b99cf0', await css(p, '--accent'));
  await p.screenshot({ path: path.join(OUT, 'desktop-dark.png') });
  await p.reload(); await p.waitForSelector('.shell'); await p.waitForTimeout(800);
  ok('it is still there after a reload', (await css(p, '--accent')) === '#b99cf0' && (await attr(p, 'data-density')) === 'compact');
  ok('nothing scrolls sideways', (await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1);
  await gotoLook(p);
  await p.getByRole('button', { name: 'Reset' }).click(); await p.waitForTimeout(800);
  ok('Reset puts everything back', (await css(p, '--accent')) === '#0c7480' && (await attr(p, 'data-density')) === 'comfortable' && Number(await css(p, '--tscale')) === 1, await css(p, '--accent'));
  await ctx.close();
}
console.log('\nAnother device');
{
  await call(cookie, 'PATCH', '/me/preferences', { theme: 'light', appearance: { textSize: 'medium', density: 'comfortable', accent: 'green' } });
  const { ctx, p } = await open('ana.reyes@example.com', { width: 390, height: 800 });
  await p.waitForTimeout(800);
  ok('a second device signs in with the same choices', (await css(p, '--accent')) === '#1b7b4a', await css(p, '--accent'));
  await gotoLook(p);
  await p.screenshot({ path: path.join(OUT, 'phone.png') });
  ok('on a phone nothing scrolls sideways', (await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1);
  await ctx.close();
}
console.log('\nThe company colour');
{
  await call(cookie, 'PATCH', '/me/preferences', { theme: 'light', appearance: DEFAULT });
  await call(admin, 'PUT', '/app-settings', { ...company, brandAccent: 'rose' });
  const m = await open('ana.reyes@example.com', { width: 1280, height: 900 });
  await m.p.waitForTimeout(1000);
  ok('people with no colour of their own get the company colour', (await css(m.p, '--accent')) === '#b5355f', await css(m.p, '--accent'));
  await m.ctx.close();
  const a = await open('admin@example.com', { width: 1280, height: 900 });
  await a.p.goto('/access'); await a.p.getByRole('tab', { name: 'Company' }).click(); await a.p.waitForSelector('#bc-h');
  ok('the Company tab has the colour of the app', (await a.p.getByRole('radio', { name: 'Blue' }).count()) === 1);
  await a.p.getByRole('radio', { name: 'Blue' }).click(); await a.p.waitForTimeout(900);
  ok('choosing one saves it', (await call(admin, 'GET', '/app-settings')).d.settings.brandAccent === 'blue');
  await a.p.screenshot({ path: path.join(OUT, 'company.png') });
  await a.ctx.close();
  await call(admin, 'PUT', '/app-settings', { ...company, brandAccent: company.brandAccent ?? 'teal' });
}
ok('no errors in the browser', errors.length === 0, errors.join(' | '));
await b.close();
await reset();
console.log(failed ? `\n${failed} FAILED` : `\nAll checks passed. Screenshots in ${OUT}`);
process.exit(failed ? 1 : 0);
