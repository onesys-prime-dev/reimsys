// Exploratory pass: acts like each role, tries awkward things, and reports anything suspicious.
// Needs API (4000) and web (5173) running. Usage: node e2e/explore.mjs [screenshot-dir]
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OUT = process.argv[2] ?? path.join(os.tmpdir(), 'reimsys-explore');
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.WEB ?? 'http://localhost:5173';
const PW = 'Reimsys#2026';
const browser = await chromium.launch({ channel: 'chrome' });
const findings = [];
const flag = (who, where, what) => { findings.push(`[${who}] ${where}: ${what}`); console.log('  FLAG', `[${who}]`, where, '-', what); };

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const file = (name, content) => { const p = path.join(OUT, name); fs.writeFileSync(p, content); return p; };
const png = (tag) => file(`img-${tag}.png`, Buffer.concat([PNG, Buffer.from(tag + Date.now())]));
const stamp = Date.now();

async function session(who, email, size = { width: 1280, height: 860 }, password = PW) {
  const ctx = await browser.newContext({ viewport: size, baseURL: BASE, acceptDownloads: true });
  const page = await ctx.newPage();
  const s = { who, ctx, page, expected: new Set(), step: 'login' };
  page.on('pageerror', (e) => flag(who, s.step, 'uncaught error: ' + String(e).slice(0, 160)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/status of (401|403|404|409|400|423)/.test(m.text())) flag(who, s.step, 'console error: ' + m.text().slice(0, 160));
    if (m.type() === 'warning' && /key|prop|DOM nesting|act\(|controlled|uncontrolled/i.test(m.text())) flag(who, s.step, 'react warning: ' + m.text().slice(0, 160));
  });
  page.on('response', (r) => {
    if (r.status() === 401 && r.url().endsWith('/api/me')) return; // normal: the app asks who is signed in before showing the login page
    const u = r.url();
    if (r.status() >= 500) flag(who, s.step, `server error ${r.status()} ${u.replace(/^https?:\/\/[^/]+/, '')}`);
    else if (r.status() >= 400 && u.includes('/api/') && !s.expected.has(r.status())) flag(who, s.step, `unexpected ${r.status()} ${r.request().method()} ${u.replace(/^https?:\/\/[^/]+/, '')}`);
  });
  if (email) {
    await page.goto('/');
    await page.fill('input[type=email]', email);
    await page.fill('input[type=password]', password);
    s.expected.add(401);
    await page.click('button[type=submit]');
    await page.waitForSelector('.shell, .lcard h1:has-text("Choose a new password")', { timeout: 8000 }).catch(() => flag(who, 'login', 'did not reach the app'));
    s.expected.delete(401);
  }
  return s;
}

async function step(s, name, fn, expect = []) {
  s.step = name;
  expect.forEach((c) => s.expected.add(c));
  try { await fn(s.page); } catch (e) { flag(s.who, name, 'step failed: ' + String(e.message).split('\n')[0].slice(0, 200)); }
  expect.forEach((c) => s.expected.delete(c));
}
const visible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false);
const text = (page) => page.locator('body').innerText();
const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + '.png') });

/* ============================ MED REF ============================ */
console.log('\n== Med Ref (Ana) ==');
const ana = await session('medref', 'ana.reyes@example.com');

await step(ana, 'forbidden pages', async (p) => {
  for (const url of ['/access', '/audit']) {
    await p.goto(url); await p.waitForTimeout(500);
    if (new URL(p.url()).pathname !== '/') flag('medref', url, 'did not redirect away from an admin page');
  }
  await p.goto('/nonsense/path'); await p.waitForTimeout(400);
  if (new URL(p.url()).pathname !== '/') flag('medref', '/nonsense/path', 'unknown URL did not return to dashboard');
});

await step(ana, 'receipt of someone else', async (p) => {
  await p.goto('/receipts/1'); await p.waitForTimeout(800);
  const t = await text(p);
  // Receipt 1 may be hers; find one of Mark's through the API instead
  // A receipt that really belongs to someone else, straight from the database.
  const other = Number(execFileSync('C:/xampp/mysql/bin/mysql.exe', ['-u', 'root', 'reimsys', '-N', '-B', '-e', "SELECT id FROM receipt WHERE encoderId <> (SELECT id FROM user WHERE email='ana.reyes@example.com') ORDER BY id DESC LIMIT 1"], { encoding: 'utf8' }).trim());
  await p.goto('/receipts/' + other); await p.waitForTimeout(800);
  if (!/not found/i.test(await text(p))) flag('medref', '/receipts/' + other, 'another user\'s receipt did not show "not found"');
}, [404]);

await step(ana, 'form validation', async (p) => {
  await p.goto('/receipts/new'); await p.waitForSelector('form');
  await p.fill('input[placeholder="Store or provider name"]', 'A');
  await p.fill('input[placeholder="0.00"]', '-5');
  await p.click('button:has-text("Save draft")');
  const errs = await p.locator('.err').allInnerTexts();
  if (errs.length < 2) flag('medref', 'form', 'bad payee and negative amount did not both show errors: ' + JSON.stringify(errs));
  await p.fill('input[placeholder="0.00"]', '99999999');
  await p.fill('input[placeholder="Store or provider name"]', 'Big Amount Store');
  await p.click('button:has-text("Save draft")');
  if (!(await p.locator('.err').allInnerTexts()).join(' ').match(/amount/i)) flag('medref', 'form', 'amount over the limit was accepted by the form');
  await p.fill('input[placeholder="0.00"]', '12.345');
  await p.evaluate(() => { const d = document.querySelector('input[type=date]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(d, '2999-01-01'); d.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.click('button:has-text("Save draft")');
  if (!(await p.locator('.err').allInnerTexts()).join(' ').match(/future/i)) flag('medref', 'form', 'future date was accepted by the form');
});

await step(ana, 'bad uploads', async (p) => {
  await p.goto('/receipts/new'); await p.waitForSelector('form');
  await p.setInputFiles('input[type=file]', file('notes.txt', 'hello'));
  await p.waitForSelector('.toast'); if (!/not a photo or PDF/i.test(await p.locator('.toast').last().innerText())) flag('medref', 'upload', 'text file not rejected clearly');
  await p.setInputFiles('input[type=file]', file('huge.png', Buffer.alloc(11 * 1024 * 1024, 1)));
  await p.waitForTimeout(300); if (!/10 MB/i.test(await p.locator('.toast').last().innerText())) flag('medref', 'upload', 'oversize file not rejected clearly');
  const fake = file('fake.png', 'this is not really an image at all');
  await p.setInputFiles('input[type=file]', fake);
  await p.fill('input[placeholder="Store or provider name"]', 'Fake Image Store ' + stamp);
  await p.fill('input[placeholder="0.00"]', '50');
  await p.click('button:has-text("Save draft")');
  await p.waitForSelector('.toast:has-text("not a JPG")', { timeout: 5000 }).catch(() => flag('medref', 'upload', 'server-rejected fake image gave no clear message'));
}, [400]);

let draftUrl;
await step(ana, 'draft, edit, remove evidence, submit', async (p) => {
  await p.goto('/receipts/new'); await p.waitForSelector('form');
  await p.fill('input[placeholder="Store or provider name"]', 'Explore Pharmacy ' + stamp);
  await p.fill('input[placeholder="0.00"]', '777.77');
  await p.setInputFiles('input[type=file]', [png('one'), png('two')]);
  await p.click('button:has-text("Save draft")');
  await p.waitForURL(/\/receipts\/\d+$/); draftUrl = p.url();
  if (!(await visible(p, '.pill:has-text("Draft")'))) flag('medref', 'draft', 'no Draft pill after saving');
  await p.click('a:has-text("Edit")'); await p.waitForSelector('form');
  if ((await p.locator('.file').count()) !== 2) flag('medref', 'edit', 'saved evidence not listed when editing');
  if ((await p.inputValue('input[placeholder="0.00"]')) !== '777.77') flag('medref', 'edit', 'amount not prefilled');
  await p.click('button[aria-label^="Remove img-one"]'); await p.waitForTimeout(500);
  await p.click('button[aria-label^="Remove img-two"]'); await p.waitForTimeout(500);
  await p.click('button:has-text("Submit for checking")');
  if (!(await p.locator('.err').allInnerTexts()).join(' ').match(/photo or PDF/i)) flag('medref', 'submit', 'submitted with no evidence left, or no clear error');
  await p.setInputFiles('input[type=file]', png('three'));
  await p.click('button:has-text("Submit for checking")');
  await p.waitForSelector('.pill:has-text("Submitted")');
  if (await visible(p, 'a:has-text("Edit")')) flag('medref', 'submitted', 'Edit still offered after submitting');
});

await step(ana, 'list: search, chips, export', async (p) => {
  await p.goto('/receipts'); await p.waitForSelector('a.row');
  await p.fill('input[aria-label="Search receipts"]', 'Explore Pharmacy ' + stamp);
  await p.waitForTimeout(700);
  if ((await p.locator('a.row').count()) !== 1) flag('medref', 'search', 'search did not narrow to the one receipt');
  await p.fill('input[aria-label="Search receipts"]', 'zzzznothing'); await p.waitForTimeout(700);
  if (!(await visible(p, 'text=No receipts here'))) flag('medref', 'search', 'no empty state for a search with no results');
  await p.fill('input[aria-label="Search receipts"]', '');
  await p.click('.chip:has-text("Approved")'); await p.waitForTimeout(500);
  const bad = await p.locator('a.row .pill:not(:has-text("Approved"))').count();
  if (bad) flag('medref', 'chips', 'Approved filter showed other statuses');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('a:has-text("Export")')]);
  const f = path.join(OUT, dl.suggestedFilename()); await dl.saveAs(f);
  if (fs.readFileSync(f).subarray(0, 2).toString() !== 'PK') flag('medref', 'export', 'XLSX export is not a valid xlsx file');
});

await step(ana, 'import with problems', async (p) => {
  await p.goto('/receipts/import'); await p.waitForSelector('.drop');
  await p.setInputFiles('.drop input[type=file]', file('bad.csv', 'payee,receipt_date,amount,category\nOk Store ' + stamp + ',2026-10-10,10.50,Medicine\n,2026-10-10,5,Medicine\nNo Cat,2026-10-10,5,Foo\nBad Date,10/10/2026,5,Medicine\n'));
  await p.waitForSelector('text=rows are ready to import');
  if (!(await visible(p, 'text=3 rows have problems'))) flag('medref', 'import', 'expected 3 problem rows, got: ' + (await p.locator('.callout').first().innerText()).replace(/\n/g, ' '));
  await p.click('button:has-text("Import 1 draft")'); await p.waitForURL(/\/receipts$/);
  await p.setInputFiles('input[type=file]', []).catch(() => {});
  await p.goto('/receipts/import');
  await p.setInputFiles('.drop input[type=file]', file('wrong.csv', 'a,b\n1,2\n'));
  await p.waitForSelector('.toast:has-text("Missing")', { timeout: 5000 }).catch(() => flag('medref', 'import', 'file with wrong columns gave no clear message'));
}, [400]);

await step(ana, 'profile', async (p) => {
  await p.goto('/profile'); await p.waitForSelector('.tabs');
  await p.fill('input[type=text] >> nth=0', 'Ana Reyes');
  await p.setInputFiles('input[accept^="image/jpeg"]', png('avatar'));
  await p.waitForSelector('.toast:has-text("Photo updated")', { timeout: 5000 }).catch(() => flag('medref', 'profile', 'photo upload gave no confirmation'));
  await p.waitForTimeout(800);
  if (!(await p.locator('img.av').count())) flag('medref', 'profile', 'photo not shown after upload');
  await p.click('button[role=tab]:has-text("Security")');
  await p.fill('input[autocomplete="current-password"]', 'wrongwrong1');
  await p.fill('input[autocomplete="new-password"] >> nth=0', 'NewPass12345');
  await p.fill('input[autocomplete="new-password"] >> nth=1', 'NewPass12345');
  await p.click('button:has-text("Update password")');
  await p.waitForSelector('.callout.bad', { timeout: 5000 }).catch(() => flag('medref', 'password', 'wrong current password gave no error'));
  await p.fill('input[autocomplete="new-password"] >> nth=1', 'Different12345');
  await p.click('button:has-text("Update password")');
  if (!/do not match/i.test(await text(p))) flag('medref', 'password', 'mismatched confirmation not caught');
  await p.click('button[role=tab]:has-text("Appearance")'); await p.click('button:has-text("Dark")'); await p.waitForTimeout(400);
  if ((await p.evaluate(() => document.documentElement.dataset.theme)) !== 'dark') flag('medref', 'theme', 'dark theme not applied');
  await shot(p, 'x-dark');
  await p.click('button:has-text("Light")');
  await p.click('button[role=tab]:has-text("My access")');
  if (/Browse the audit log/.test(await text(p))) flag('medref', 'my access', 'lists admin permission the user does not have');
}, [400]);

await step(ana, 'notifications and back button', async (p) => {
  await p.goto('/'); await p.waitForSelector('.shell');
  await p.click('button[aria-label^="Notifications"]'); await p.waitForSelector('.panel');
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  if (await visible(p, '.panel')) flag('medref', 'notifications', 'panel did not close on Escape');
  await p.goto('/receipts'); await p.goBack(); await p.waitForTimeout(300);
  if (new URL(p.url()).pathname !== '/') flag('medref', 'history', 'browser back did not return to previous page');
  await p.goto(draftUrl); await p.reload(); await p.waitForSelector('.dh');
});

/* ============================ CHECKER ============================ */
console.log('\n== Checker (Liza) ==');
const liza = await session('checker', 'liza.santos@example.com');
await step(liza, 'sees only what she should', async (p) => {
  await p.goto('/receipts'); await p.waitForSelector('a.row');
  await p.click('.chip:has-text("Draft")').catch(() => {});
  await p.waitForTimeout(500);
  const drafts = await p.locator('a.row .pill:has-text("Draft")').count();
  if (drafts) flag('checker', '/receipts', `sees ${drafts} draft receipt(s) that other people have not submitted yet`);
});
await step(liza, 'no new receipt / import', async (p) => {
  await p.goto('/receipts/new'); await p.waitForTimeout(500);
  if (new URL(p.url()).pathname === '/receipts/new') flag('checker', '/receipts/new', 'checker can open the new receipt form');
  await p.goto('/receipts/import'); await p.waitForTimeout(500);
  if (new URL(p.url()).pathname === '/receipts/import') flag('checker', '/receipts/import', 'checker can open the import page');
});
await step(liza, 'review the explore receipt', async (p) => {
  await p.goto(draftUrl.replace(BASE, '')); await p.waitForSelector('.dh');
  if (await visible(p, 'button:has-text("Approve")')) flag('checker', 'detail', 'checker is offered Approve');
  await p.click('button:has-text("Open evidence")'); await p.waitForSelector('img.evimg');
  await p.click('button.evtab >> nth=0').catch(() => {});
  await p.waitForTimeout(1500);
  await p.click('button:has-text("Mark checked")');
  await p.press('.modal textarea', 'Escape'); await p.waitForTimeout(200);
  if (await visible(p, '.modal')) flag('checker', 'modal', 'modal did not close on Escape');
  await p.click('button:has-text("Mark checked")'); await p.click('.modal button:has-text("Mark checked")');
  await p.waitForSelector('.pill:has-text("Checked")');
  if (await visible(p, 'button:has-text("Mark checked")')) flag('checker', 'detail', 'Mark checked still offered after checking');
});

/* ============================ APPROVER ============================ */
console.log('\n== Approver (Paolo) ==');
const paolo = await session('approver', 'paolo.v@example.com');
await step(paolo, 'only checked records', async (p) => {
  await p.goto('/receipts'); await p.waitForSelector('a.row');
  const bad = await p.locator('a.row .pill:has-text("Draft"), a.row .pill:has-text("Submitted"), a.row .pill:has-text("Returned")').count();
  if (bad) flag('approver', '/receipts', 'sees draft/submitted/returned receipts');
  if (await visible(p, 'a:has-text("New receipt")')) flag('approver', 'nav', 'sees New receipt');
});
await step(paolo, 'disapprove needs a reason, then approve a different one', async (p) => {
  await p.goto(draftUrl.replace(BASE, '')); await p.waitForSelector('.dh');
  await p.click('button:has-text("Open evidence")');
  await p.click('button:text-is("Disapprove")');
  if (!(await p.locator('.modal button:text-is("Disapprove")').isDisabled())) flag('approver', 'modal', 'Disapprove allowed with an empty reason');
  await p.fill('.modal textarea', 'ab');
  if (!(await p.locator('.modal button:text-is("Disapprove")').isDisabled())) flag('approver', 'modal', 'Disapprove allowed with a 2-character reason');
  await p.keyboard.press('Escape');
  await p.click('button:text-is("Approve")'); await p.click('.modal button:text-is("Approve")');
  await p.waitForSelector('.pill:has-text("Approved")');
  await p.waitForSelector('a:has-text("Download")', { timeout: 15000 }).catch(() => flag('approver', 'document', 'document never became ready'));
});
await step(paolo, 'report view', async (p) => {
  await p.goto('/reports'); await p.waitForSelector('text=approved record');
  await p.click('button:has-text("CSV") >> nth=0'); await p.click('button:has-text("Generate CSV")'); await p.waitForURL(/\/reports\/\d+$/);
  await p.waitForSelector('tbody tr'); await shot(p, 'x-report');
  const total = await p.locator('.tile.alert b').innerText();
  const sum = (await p.locator('tbody tr td:last-child').allInnerTexts()).reduce((s, t) => s + Number(t.replace(/[₱,]/g, '')), 0);
  if (Math.abs(Number(total.replace(/[₱,]/g, '')) - sum) > 0.005) flag('approver', 'report', `total ${total} does not match rows ${sum.toFixed(2)}`);
});
await step(paolo, 'cannot see audit/access', async (p) => {
  for (const u of ['/audit', '/access']) { await p.goto(u); await p.waitForTimeout(400); if (new URL(p.url()).pathname !== '/') flag('approver', u, 'not redirected'); }
});

/* ============================ ADMIN ============================ */
console.log('\n== Super Admin ==');
const admin = await session('admin', 'admin@example.com');
const newEmail = `qa.${stamp}@example.com`;
let temp = '';
await step(admin, 'add user', async (p) => {
  await p.goto('/access'); await p.waitForSelector('.urow');
  await p.click('button:has-text("Add user")');
  await p.fill('.modal input[type=text]', 'QA Tester'); await p.fill('.modal input[type=email]', newEmail);
  await p.click('.modal button:has-text("Create user")');
  await p.waitForSelector('.modal code'); temp = await p.locator('.modal code').innerText();
  if (temp.length < 8) flag('admin', 'add user', 'temporary password looks too short');
  await p.click('.modal button:has-text("Done")');
  await p.click('button:has-text("Add user")');
  await p.fill('.modal input[type=text]', 'Dup'); await p.fill('.modal input[type=email]', newEmail);
  await p.click('.modal button:has-text("Create user")');
  await p.waitForSelector('.modal .callout.bad', { timeout: 4000 }).catch(() => flag('admin', 'add user', 'duplicate email gave no error'));
  await p.keyboard.press('Escape');
}, [409]);
await step(admin, 'cannot lock self out', async (p) => {
  await p.goto('/access'); await p.waitForSelector('.urow');
  const self = p.locator('.urow:has-text("(you)")');
  if (!(await self.locator('select').isDisabled())) flag('admin', 'users', 'own role dropdown is enabled');
  if (!(await self.locator('input[type=checkbox]').isDisabled())) flag('admin', 'users', 'own active switch is enabled');
});
await step(admin, 'permissions matrix', async (p) => {
  await p.click('button[role=tab]:has-text("Roles and permissions")'); await p.waitForSelector('.matrix');
  const locked = await p.locator('.matrix input:disabled').count();
  if (locked < 4) flag('admin', 'matrix', `expected at least 4 locked checkboxes, found ${locked}`);
  const box = p.locator('input[aria-label="Import CSV or XLSX for Checker"]');
  const was = await box.isChecked();
  await box.click();
  if (!(await visible(p, '.savebar'))) flag('admin', 'matrix', 'no save bar after changing a permission');
  await p.click('button:has-text("Discard")');
  if ((await box.isChecked()) !== was) flag('admin', 'matrix', 'Discard did not revert the checkbox');
  await box.click(); await p.click('button:has-text("Save changes")'); await p.waitForSelector('.toast:has-text("Permissions saved")');
  // Liza should now see the Import button
  await liza.page.goto('/receipts'); await liza.page.waitForTimeout(1500);
  if (!(await visible(liza.page, 'a:has-text("Import")'))) flag('checker', 'permission change', 'granted permission did not show up for the checker');
  // revert
  await p.waitForFunction(() => !document.querySelector('.toast'), null, { timeout: 8000 }); await box.click(); await p.click('button:has-text("Save changes")'); await p.waitForSelector('.toast:has-text("Permissions saved")');
  await p.waitForTimeout(500);
  await liza.page.goto('/receipts'); await liza.page.waitForTimeout(1200);
  if (await visible(liza.page, 'a:has-text("Import")')) flag('checker', 'permission change', 'revoked permission is still active');
});
await step(admin, 'categories', async (p) => {
  await p.click('button[role=tab]:has-text("Categories")'); await p.waitForSelector('.cats .urow');
  await p.fill('input[aria-label="New category name"]', 'QA Category ' + stamp); await p.click('button:has-text("Add category")');
  await p.waitForSelector(`text=QA Category ${stamp}`);
  await p.locator(`.cats .urow:has-text("QA Category ${stamp}") label.switch`).click(); await p.waitForTimeout(600);
  await ana.page.goto('/receipts/new'); await ana.page.waitForSelector('form');
  const opts = await ana.page.locator('select option').allInnerTexts();
  if (opts.includes('QA Category ' + stamp)) flag('medref', 'categories', 'deactivated category still offered on the form');
});
await step(admin, 'deactivate user and reset password', async (p) => {
  await p.click('button[role=tab]:has-text("Users")'); await p.waitForSelector('.urow');
  await p.locator(`.urow:has-text("${newEmail}") button:has-text("Manage")`).click();
  await p.click('.modal button:has-text("Reset password")'); await p.waitForSelector('.modal code');
  const t2 = await p.locator('.modal code').innerText(); if (t2 === temp) flag('admin', 'reset', 'reset produced the same temporary password');
  temp = t2; await p.click('.modal button:has-text("Close")');
});
await step(admin, 'audit and emails', async (p) => {
  await p.goto('/audit'); await p.waitForSelector('.aud');
  await p.fill('input[aria-label="Search audit log"]', 'QA Tester'); await p.waitForTimeout(800);
  await p.click('.aud-h >> nth=0'); await p.waitForSelector('.aud-d');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('a:has-text("Export CSV")')]);
  const f = path.join(OUT, dl.suggestedFilename()); await dl.saveAs(f);
  if (!fs.readFileSync(f, 'utf8').includes('Time,Person')) flag('admin', 'audit export', 'CSV header missing');
  await p.click('button[role=tab]:has-text("Emails")'); await p.waitForSelector('.pref');
  await shot(p, 'x-emails');
});

/* ============================ NEW USER FIRST LOGIN ============================ */
console.log('\n== New user first sign-in ==');
const qa = await session('newuser', newEmail, undefined, temp);
await step(qa, 'forced password change', async (p) => {
  await p.waitForSelector('h1:has-text("Choose a new password")', { timeout: 5000 });
  await p.fill('input[autocomplete="current-password"]', temp);
  await p.fill('input[autocomplete="new-password"] >> nth=0', 'short');
  await p.fill('input[autocomplete="new-password"] >> nth=1', 'short');
  await p.click('button:has-text("Update password")');
  if (!(await visible(p, '.callout.bad'))) flag('newuser', 'password', 'weak password accepted without error');
  await p.fill('input[autocomplete="new-password"] >> nth=0', 'QaTester2026');
  await p.fill('input[autocomplete="new-password"] >> nth=1', 'QaTester2026');
  await p.click('button:has-text("Update password")');
  await p.waitForSelector('.shell', { timeout: 8000 });
  await p.goto('/receipts/new'); await p.waitForSelector('form');
}, [400]);

await step(admin, 'sign a user out everywhere', async (p) => {
  await p.goto('/access'); await p.waitForSelector('.urow');
  await p.locator(`.urow:has-text("${newEmail}") button:has-text("Manage")`).click();
  await p.click('.modal button:has-text("Sign out of all devices")'); await p.waitForSelector('.toast:has-text("Signed out")');
});
await step(qa, 'session revoked', async (p) => {
  await p.goto('/'); await p.waitForTimeout(1200);
  if (!(await visible(p, '.lcard'))) flag('newuser', 'session', 'still signed in after an administrator signed them out');
}, [401]);
await step(admin, 'deactivate the QA user', async (p) => {
  await p.goto('/access'); await p.waitForSelector('.urow');
  await p.locator(`.urow:has-text("${newEmail}") label.switch`).click(); await p.waitForSelector('.toast:has-text("User updated")');
});
const qa2 = await session('deactivated', null);
await step(qa2, 'deactivated user cannot sign in', async (p) => {
  await p.goto('/'); await p.fill('input[type=email]', newEmail); await p.fill('input[type=password]', 'QaTester2026');
  await p.click('button[type=submit]'); await p.waitForSelector('.callout.bad', { timeout: 5000 }).catch(() => flag('deactivated', 'login', 'no error shown'));
  if (await visible(p, '.shell')) flag('deactivated', 'login', 'a deactivated user signed in');
}, [401]);

/* ============================ LOCKOUT ============================ */
await step(qa2, 'lockout after repeated failures', async (p) => {
  await p.goto('/');
  for (let i = 0; i < 6; i++) { await p.fill('input[type=email]', 'mark.dc@example.com'); await p.fill('input[type=password]', 'wrong' + i); await p.click('button[type=submit]'); await p.waitForTimeout(350); }
  if (!/locked/i.test(await text(p))) flag('deactivated', 'lockout', 'no lock message after 6 bad attempts: ' + (await p.locator('.callout').innerText().catch(() => '')));
  await admin.page.goto('/access'); await admin.page.waitForSelector('.urow');
  await admin.page.locator('.urow:has-text("Mark Dela Cruz") button:has-text("Manage")').click();
  await admin.page.click('.modal button:has-text("Unlock account")'); await admin.page.waitForSelector('.toast:has-text("unlocked")');
}, [401, 423, 429]);

/* ============================ RESPONSIVE SWEEP ============================ */
console.log('\n== Responsive sweep ==');
for (const [who, email, pages] of [
  ['medref', 'ana.reyes@example.com', ['/', '/receipts', '/receipts/new', '/receipts/import', '/reports', '/profile']],
  ['checker', 'liza.santos@example.com', ['/', '/receipts', '/reports']],
  ['approver', 'paolo.v@example.com', ['/', '/receipts', '/reports']],
  ['admin', 'admin@example.com', ['/', '/receipts', '/reports', '/access', '/audit', '/profile']],
]) {
  for (const size of [{ width: 390, height: 800 }, { width: 768, height: 900 }]) {
    const s = await session(who + '@' + size.width, email, size);
    for (const u of pages) {
      await step(s, 'layout ' + u, async (p) => {
        await p.goto(u); await p.waitForSelector('.page'); await p.waitForTimeout(700);
        const o = await overflowX(p);
        if (o > 1) flag(who, `${u} @${size.width}px`, `page scrolls sideways by ${o}px`);
        const clipped = await p.evaluate(() => [...document.querySelectorAll('.page *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth + 2 && !e.closest('.matrix, .scroll, .tabs, .evtabs, .stage'); }).length);
        if (clipped) flag(who, `${u} @${size.width}px`, `${clipped} element(s) extend past the screen edge`);
        if (size.width === 390 && u === '/access') await shot(p, `x-${who}-access-phone`);
      });
    }
    await s.ctx.close();
  }
}

await browser.close();
console.log(`\n${findings.length} finding(s)`);
fs.writeFileSync(path.join(OUT, 'findings.txt'), findings.join('\n'));
