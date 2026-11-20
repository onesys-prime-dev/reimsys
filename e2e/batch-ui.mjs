// Drives batches in Chrome the way people would: the Super Admin makes a batch and adds receipts, the Checker and Approver
// work on the whole batch, Accounting pays it (two people, one payment each), and a Med Ref only sees the code.
// Needs the API (4000) and the web app (5173) running, and the seed applied. Usage: node e2e/batch-ui.mjs [screenshot-dir]
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { B, H, PNG, call, loginAll, makeDraft, tag } from './payment-helpers.mjs';

const OUT = process.argv[2] ?? path.join(os.tmpdir(), 'reimsys-batch-shots');
fs.mkdirSync(OUT, { recursive: true });
const proofFile = path.join(OUT, `proof-${Date.now()}.png`);
fs.writeFileSync(proofFile, Buffer.concat([PNG, Buffer.from(String(Date.now()))]));

const U = await loginAll();
async function submitted(owner, name, amount) {
  const r = await makeDraft(U, owner, name, amount);
  return (await call(U[owner], 'POST', `/receipts/${r.id}/submit`, { version: r.version })).d.receipt;
}
const view = (c, r) => fetch(`${B}/receipts/${r.id}/evidence/${r.evidence[0].id}/file?mode=view`, { headers: H(c, false) });
const s1 = await submitted('ana', 'UI batch A', 210);
const s2 = await submitted('mark', 'UI batch B', 390);

const browser = await chromium.launch({ channel: 'chrome' });
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(cond ? '  ok  ' : '  FAIL', name, cond ? '' : extra); if (!cond) failed++; };
const pages = [];
async function open(email, size = { width: 1280, height: 820 }) {
  const ctx = await browser.newContext({ viewport: size, baseURL: process.env.WEB ?? 'http://localhost:5173' });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/401|403|404|409/.test(m.text()) && page.errors.push(m.text()));
  await page.goto('/');
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', 'Reimsys#2026');
  await page.click('button[type=submit]');
  await page.waitForSelector('.shell');
  pages.push({ email, page });
  return page;
}
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true });
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const toastText = async (page) => (await page.locator('.toast').last().innerText().catch(() => ''));

console.log('Super Admin makes a batch and adds receipts');
const admin = await open('admin@example.com');
ok('the menu has "Batches"', (await admin.locator('.side .nav >> text=Batches').count()) === 1);
await admin.click('.side .nav >> text=Batches');
await admin.waitForSelector('h1:has-text("Batches")');
await admin.click('button:has-text("New batch")');
await admin.fill('.modal input', `UI run ${tag}`);
await admin.click('.modal button:has-text("Make batch")');
await admin.waitForURL(/\/batches\/\d+$/);
const batchId = Number(admin.url().split('/').pop());
const code = (await admin.locator('.dh h1').innerText()).split(' ')[0];
ok('the new batch opens with its generated code', /^B-\d{4}-\d{6}$/.test(code), code);
ok('an empty batch can be deleted', await admin.locator('button:has-text("Delete batch")').isVisible());
await admin.click('button:has-text("Add receipts")');
await admin.fill('.modal input[aria-label="Search receipts to add"]', tag);
await admin.waitForSelector(`.modal >> text=${s1.refNo}`);
await admin.waitForSelector(`.modal >> text=${s2.refNo}`);
await admin.locator('.modal .row', { hasText: s1.refNo }).locator('input[type=checkbox]').check();
await admin.locator('.modal .row', { hasText: s2.refNo }).locator('input[type=checkbox]').check();
await shot(admin, 'batch-1-add');
await admin.click('.modal button:has-text("Add 2")');
await admin.waitForSelector(`.panel-body >> text=${s1.refNo}`);
ok('both receipts are listed in the batch, by person', await admin.locator('.paygrp', { hasText: 'Ana Reyes' }).locator(`text=${s1.refNo}`).isVisible() && await admin.locator('.paygrp', { hasText: 'Mark Dela Cruz' }).locator(`text=${s2.refNo}`).isVisible());
ok('a batch with receipts cannot be deleted', !(await admin.locator('button:has-text("Delete batch")').isVisible()));
ok('the Super Admin is not offered Check, Approve or Pay', (await admin.locator('.actionbar button', { hasText: /^(Check|Approve|Pay) \d/ }).count()) === 0);
await shot(admin, 'batch-2-admin');

console.log('\nChecker works on the whole batch');
await view(U.liza, s1);
await view(U.liza, s2);
const liza = await open('liza.santos@example.com');
await liza.waitForSelector('[data-testid=batches-waiting]');
ok('the dashboard says a batch is waiting, with the code', (await liza.locator('[data-testid=batches-waiting]').innerText()).includes(code));
await liza.click('.side .nav >> text=Batches');
await liza.fill('input[aria-label="Batch code"]', code.toLowerCase());
await liza.click('button:has-text("Open")');
await liza.waitForURL(`**/batches/${batchId}`);
await liza.waitForSelector('.dh h1');
ok('typing the code opens the batch', (await liza.locator('.dh h1').innerText()).startsWith(code));
await liza.waitForSelector('.panel-body .pill:has-text("to check")');
ok('"Check 2" is offered', await liza.locator('button:has-text("Check 2")').isVisible());
ok('each receipt is marked as waiting for this person', (await liza.locator('.pill', { hasText: 'to check' }).count()) === 2);
await liza.click('button:has-text("Check 2")');
await liza.click('.modal button.pri:has-text("Check")');
await liza.waitForSelector('.toast');
ok('both are checked', /2 receipts checked/.test(await toastText(liza)), await toastText(liza));
await liza.waitForSelector('text=Nothing in this batch is waiting for you');
ok('the page says nothing is waiting any more', true);

console.log('\nApprover arrives from the notification');
await view(U.paolo, s1);
await view(U.paolo, s2);
const paolo = await open('paolo.v@example.com');
await paolo.click('button[aria-label^="Notifications"]');
await paolo.locator('.note', { hasText: code }).first().click();
await paolo.waitForURL(`**/batches/${batchId}`);
ok('the summary notice opens the batch', true);
await paolo.click('button:has-text("Approve 2")');
await paolo.click('.modal button.pri:has-text("Approve")');
await paolo.waitForSelector('.toast');
ok('both are approved', /2 receipts approved/.test(await toastText(paolo)), await toastText(paolo));

console.log('\nAccounting pays the batch');
const rica = await open('accounting@example.com');
await rica.click('.side .nav >> text=Ready to pay');
await rica.waitForSelector(`section[aria-label="Batches to pay"] >> text=${code}`);
ok('Ready to pay lists the batch with two people', (await rica.locator('section[aria-label="Batches to pay"] .rep-row', { hasText: code }).innerText()).includes('2 people'));
await rica.locator('section[aria-label="Batches to pay"] .rep-row', { hasText: code }).click();
await rica.waitForURL(`**/batches/${batchId}`);
await rica.click('button:has-text("Pay 2")');
await rica.waitForSelector('.modal');
ok('the payment form groups the receipts by person', await rica.locator('.modal h3', { hasText: 'Ana Reyes' }).isVisible() && await rica.locator('.modal h3', { hasText: 'Mark Dela Cruz' }).isVisible());
ok('it says each person gets their own payment', (await rica.locator('.modal').innerText()).includes('One payment for each of the 2 people'));
await rica.setInputFiles('.modal input[type=file]', proofFile);
await shot(rica, 'batch-3-pay');
await rica.click('.modal button:has-text("Mark as paid")');
await rica.waitForSelector('.toast');
ok('two payments are recorded', /Payments PAY-\d{4}-\d+, PAY-\d{4}-\d+/.test(await toastText(rica)), await toastText(rica));
await rica.waitForSelector('.chip:has-text("Paid")');
ok('the batch shows both as Paid', (await rica.locator('.chip', { hasText: 'Paid' }).innerText()).includes('2'));
await shot(rica, 'batch-4-paid');

console.log('\nA Med Ref sees only the code');
const ana = await open('ana.reyes@example.com');
ok('there is no Batches menu', (await ana.locator('.side .nav >> text=Batches').count()) === 0);
await ana.goto(`/receipts/${s1.id}`);
await ana.waitForSelector('.dh');
ok('the receipt shows the batch code, without a link', (await ana.locator('.dh .meta').innerText()).includes(code) && (await ana.locator('.dh .meta a').count()) === 0);
await ana.goto(`/batches/${batchId}`);
await ana.waitForSelector('.shell');
ok('opening a batch page sends a Med Ref back to the dashboard', !ana.url().includes('/batches'));

console.log('\nClosing, and on a phone');
await admin.reload();
await admin.click('.panel-foot button:has-text("Close")');
await admin.waitForSelector('.dh .pill:has-text("Closed")');
ok('a closed batch offers no "Add receipts"', !(await admin.locator('button:has-text("Add receipts")').isVisible()));
await admin.click('.panel-foot button:has-text("Reopen")');
await admin.waitForSelector('button:has-text("Add receipts")');
ok('it can be reopened', true);
for (const [email, label] of [['accounting@example.com', 'accounting'], ['admin@example.com', 'admin']]) {
  const phone = await open(email, { width: 390, height: 800 });
  await phone.goto(`/batches/${batchId}`);
  await phone.waitForSelector('.dh');
  ok(`${label}: the batch page fits a phone`, await noSideScroll(phone));
  await phone.goto('/batches');
  await phone.waitForSelector('[data-testid=batch-row]');
  ok(`${label}: the batch list fits a phone`, await noSideScroll(phone));
  ok(`${label}: the bottom menu has Batches`, (await phone.locator('.bnav >> text=Batches').count()) === 1);
  await shot(phone, `batch-5-phone-${label}`);
}

for (const { email, page } of pages) ok(`no browser errors for ${email}`, page.errors.length === 0, page.errors.join(' | '));
await browser.close();
console.log(`\nScreenshots in ${OUT}`);
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
