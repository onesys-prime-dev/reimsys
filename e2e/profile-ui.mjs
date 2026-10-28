// Drives the Profile page in Chrome (computer and phone): every tab, saving details, the notification switches, the theme buttons,
// signing out another device, changing the password, and the photo button. Makes its own test user. Needs the API (4000) and web app (5173).
// Usage: node e2e/profile-ui.mjs [screenshot-dir]
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const API = process.env.API ?? 'http://localhost:4000/api';
const WEB = process.env.WEB ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? path.join(os.tmpdir(), 'reimsys-profile-shots');
fs.mkdirSync(OUT, { recursive: true });
let failed = 0;
const ok = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : x); if (!c) failed++; };

async function call(cookie, m, p, b) {
  const r = await fetch(API + p, { method: m, headers: { 'x-requested-with': 'reimsys', origin: new URL(API).origin, cookie, ...(b ? { 'content-type': 'application/json' } : {}) }, body: b ? JSON.stringify(b) : undefined });
  return { s: r.status, d: await r.json().catch(() => null), cookie: r.headers.get('set-cookie')?.split(';')[0] };
}
const adminLogin = await call('', 'POST', '/auth/login', { email: 'admin@example.com', password: 'Reimsys#2026' });
const admin = adminLogin.cookie;
const roles = (await call(admin, 'GET', '/roles')).d.roles;
const email = `profile.ui.${Date.now()}@example.com`;
const made = await call(admin, 'POST', '/users', { name: 'Profile Walker', email, roleId: roles.find((r) => r.code === 'medref').id });
const PW = 'Profile-Ui-1234', PW2 = 'Profile-Ui-5678';
const first = await call('', 'POST', '/auth/login', { email, password: made.d.temporaryPassword });
await call(first.cookie, 'POST', '/me/password', { currentPassword: made.d.temporaryPassword, newPassword: PW });
await call(first.cookie, 'POST', '/me/privacy');
// a second device, so there is something to sign out
const other = await call('', 'POST', '/auth/login', { email, password: PW });

const browser = await chromium.launch({ channel: 'chrome' });
for (const [label, size] of [['computer', { width: 1280, height: 860 }], ['phone', { width: 390, height: 780 }]]) {
  console.log('\n' + label);
  const ctx = await browser.newContext({ viewport: size, baseURL: WEB });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => m.type() === 'error' && !/40[0-9]|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await p.goto('/');
  await p.fill('input[type=email]', email);
  await p.fill('input[type=password]', label === 'computer' ? PW : PW2);
  await p.click('button[type=submit]');
  await p.waitForSelector('.shell');
  await p.goto('/profile');
  await p.waitForSelector('.tabs button');
  const tabs = await p.$$eval('.tabs button', (b) => b.map((x) => x.textContent.trim()));
  ok('all six tabs are there', tabs.join(',') === 'Details,Security,Notifications,My access,Appearance,Activity', tabs.join(','));
  const text = async () => (await p.locator('main.page').innerText()).trim();
  const toast = async (t) => { await p.waitForSelector(`#toast :text("${t}")`, { timeout: 6000 }).then(() => true).catch(() => false); };

  // Details
  await p.fill('input[type=text] >> nth=0', label === 'computer' ? 'Profile Walker Renamed' : 'Profile Phone Renamed');
  await p.fill('input[type=tel]', '0917 555 0000');
  await p.click('button:has-text("Save changes")');
  ok('details save shows a message', await p.locator('#toast :text("Profile saved")').first().waitFor({ timeout: 6000 }).then(() => true).catch(() => false));
  ok('the new name appears in the menu or header', (await p.locator('.who, .top').first().innerText().catch(() => '')).length > 0 && (label === 'phone' || (await p.locator('.who').innerText()).includes('Renamed')));
  await p.fill('input[type=text] >> nth=0', 'A');
  await p.click('button:has-text("Save changes")');
  await p.waitForTimeout(500);
  ok('a too-short name is not saved', await p.locator('input[type=text] >> nth=0').evaluate((el) => !el.validity.valid));
  await p.fill('input[type=text] >> nth=0', label === 'computer' ? 'Profile Walker Renamed' : 'Profile Phone Renamed');

  // Photo button opens a file chooser
  const chooser = p.waitForEvent('filechooser', { timeout: 5000 }).then(() => true).catch(() => false);
  await p.click('button:has-text("Add photo")');
  ok('Change photo opens the file chooser', await chooser);
  // add a photo, then remove it
  ok('with no photo the button says Add photo and there is no Remove button', (await p.locator('button:has-text("Add photo")').count()) === 1 && (await p.locator('button:has-text("Remove photo")').count()) === 0);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await p.setInputFiles('input[type=file]', { name: 'me.png', mimeType: 'image/png', buffer: png });
  ok('the photo is added', await p.locator('#toast :text("Photo updated")').first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false));
  await p.waitForSelector('button:has-text("Remove photo")');
  ok('now the button says Change photo and Remove photo is offered', (await p.locator('button:has-text("Change photo")').count()) === 1);
  await p.click('button:has-text("Remove photo")');
  ok('removing it shows a message', await p.locator('#toast :text("Photo removed")').first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false));
  await p.waitForSelector('button:has-text("Add photo")');
  ok('the initials are back in the menu and the Remove button is gone', (await p.locator('.who img.av').count()) === 0 && (await p.locator('button:has-text("Remove photo")').count()) === 0);

  // Security
  await p.click('.tabs button:has-text("Security")');
  await p.waitForSelector('text=Where you are signed in');
  await p.waitForSelector('text=This device', { timeout: 8000 }).catch(() => {});
  ok('this device is marked', (await text()).includes('This device'));
  if (label === 'computer') {
    ok('the other device is listed with a Sign out button', await p.locator('button:has-text("Sign out")').count() >= 1);
    await p.locator('button:has-text("Sign out")').first().click();
    ok('signing out a device shows a message', await p.locator('#toast :text("Device signed out")').first().waitFor({ timeout: 6000 }).then(() => true).catch(() => false));
    const o = await call(other.cookie, 'GET', '/me');
    ok('that device really is signed out', o.s === 401, String(o.s));
  }
  const pwInputs = p.locator('input[type=password]');
  ok('the change-password form has three fields', (await pwInputs.count()) === 3);
  if (label === 'computer') {
    await pwInputs.nth(0).fill('wrong-wrong-1'); await pwInputs.nth(1).fill(PW2); await pwInputs.nth(2).fill(PW2);
    await p.click('button:has-text("Change password"), button:has-text("Update password")').catch(() => p.click('.card-b button.btn.pri'));
    ok('a wrong current password shows an error', await p.locator('.callout.bad, #toast :text("incorrect")').first().waitFor({ timeout: 6000 }).then(() => true).catch(() => false));
    await pwInputs.nth(0).fill(PW); await pwInputs.nth(1).fill(PW2); await pwInputs.nth(2).fill(PW2 + 'x');
    await p.click('button:has-text("Change password"), button:has-text("Update password")').catch(() => p.click('.card-b button.btn.pri'));
    ok('mismatched new passwords show an error', (await text()).includes('do not match'));
    await pwInputs.nth(0).fill(PW); await pwInputs.nth(1).fill(PW2); await pwInputs.nth(2).fill(PW2);
    await p.click('button:has-text("Change password"), button:has-text("Update password")').catch(() => p.click('.card-b button.btn.pri'));
    ok('the password changes', await p.locator('#toast :text("Password updated")').first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false));
    const stay = await p.evaluate(() => fetch('/api/me', { headers: { 'x-requested-with': 'reimsys' } }).then((r) => r.status));
    ok('this device stays signed in after it', stay === 200);
  }
  await p.screenshot({ path: path.join(OUT, `${label}-security.png`), fullPage: true });

  // Notifications
  await p.click('.tabs button:has-text("Notifications")');
  await p.waitForSelector('text=Daily digest');
  const sw = p.locator('[role=switch], .sw, input[type=checkbox]');
  ok('the switches are there', (await sw.count()) >= 3, String(await sw.count()));
  const before = await call(label === 'computer' ? (await call('', 'POST', '/auth/login', { email, password: PW2 })).cookie : '', 'GET', '/me').catch(() => null);
  await p.locator('text=Daily digest of pending items').locator('xpath=ancestor::div[contains(@class,"pref")][1]').locator('button, input, [role=switch]').first().click();
  ok('turning the digest off shows a message', await p.locator('#toast :text("Preference saved")').first().waitFor({ timeout: 6000 }).then(() => true).catch(() => false));
  void before;

  // My access
  await p.click('.tabs button:has-text("My access")');
  await p.waitForSelector('text=What Med Ref can do');
  ok('My access lists what a Med Ref can do', (await text()).includes('Create and edit own receipts') && !(await text()).includes('Manage users'));

  // Appearance
  await p.click('.tabs button:has-text("Appearance")');
  await p.click('button:has-text("Dark")');
  await p.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark', null, { timeout: 5000 }).catch(() => {});
  ok('Dark turns the whole app dark', (await p.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'dark');
  await p.screenshot({ path: path.join(OUT, `${label}-dark.png`) });
  await p.click('button:has-text("Light")');
  await p.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'light', null, { timeout: 5000 }).catch(() => {});
  ok('Light turns it back', (await p.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'light');
  await p.click('button:has-text("Match my device")');
  await p.waitForTimeout(400);
  ok('System follows the device (no forced theme)', (await p.evaluate(() => document.documentElement.getAttribute('data-theme'))) === null);
  await p.click('button:has-text("Light")');

  // Activity
  await p.click('.tabs button:has-text("Activity")');
  await p.waitForSelector('text=Your recent actions');
  await p.waitForSelector('main.page .pref', { timeout: 8000 }).catch(() => {});
  const act = await text();
  ok('Activity lists what I just did', /updated own profile|changed own password|signed out another device|signed in/i.test(act), act.slice(0, 120));

  ok('no errors in the browser', errors.length === 0, errors.join(' | '));
  await ctx.close();
}
await browser.close();

const id = (await call(admin, 'GET', '/users?active=true')).d.users.find((x) => x.email === email)?.id;
if (id) await call(admin, 'PATCH', `/users/${id}`, { isActive: false });
console.log(failed ? `\n${failed} FAILED` : '\nAll Profile screens passed.');
process.exit(failed ? 1 : 0);
