// Drives cutoffs and late additions in Chrome: the Super Admin sets up a repeating cutoff, sees it in plain words with what it
// would take, runs it early from the batch, and adds a receipt late with a reason; Accounting sees the result on a phone and
// can only choose approved receipts for a cutoff of her own.
// Needs the API (4000) and the web app (5173) running, and the seed applied. Usage: node e2e/batch-cutoff-ui.mjs [screenshot-dir]
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { B, F, H, PNG, call, loginAll, tag, today } from './payment-helpers.mjs';

const OUT = process.argv[2] ?? path.join(os.tmpdir(), 'reimsys-cutoff-shots');
fs.mkdirSync(OUT, { recursive: true });
const U = await loginAll();

const place = (await call(U.admin, 'POST', '/charge-locations', { name: `Cutoff UI ${tag}` })).d.location;
async function approvedAt(owner, name, amount) {
  const c = U[owner];
  let r = (await call(c, 'POST', '/receipts', { payee: `${name} ${tag}`, receiptDate: today(), amount, ...F, chargeLocationId: place.id })).d.receipt;
  const f = new FormData();
  f.append('files', new Blob([Buffer.concat([PNG, Buffer.from(name + tag + Math.random())])], { type: 'image/png' }), 'receipt.png');
  r = (await (await fetch(`${B}/receipts/${r.id}/evidence`, { method: 'POST', headers: H(c, false), body: f })).json()).receipt;
  r = (await call(c, 'POST', `/receipts/${r.id}/submit`, { version: r.version })).d.receipt;
  await fetch(`${B}/receipts/${r.id}/evidence/${r.evidence[0].id}/file?mode=view`, { headers: H(U.liza, false) });
  r = (await call(U.liza, 'POST', `/receipts/${r.id}/check`, { version: r.version })).d.receipt;
  await fetch(`${B}/receipts/${r.id}/evidence/${r.evidence[0].id}/file?mode=view`, { headers: H(U.paolo, false) });
  return (await call(U.paolo, 'POST', `/receipts/${r.id}/approve`, { version: r.version })).d.receipt;
}
await approvedAt('ana', 'Cutoff UI A', 120);
await approvedAt('mark', 'Cutoff UI B', 80);

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
/** Waits for a message matching `re` (earlier ones may still be showing), and says whether it came. */
const toastSays = async (page, re) => page.waitForFunction((src) => [...document.querySelectorAll('.toast')].some((t) => new RegExp(src).test(t.textContent ?? '')), re.source, { timeout: 15_000 }).then(() => true, () => false);
const name = `Weekly UI ${tag}`;

console.log('The Super Admin sets up a repeating cutoff');
const admin = await open('admin@example.com');
await admin.goto('/batches');
await admin.waitForSelector('[role=tab]:has-text("Cutoff schedules")', { timeout: 15_000 }).catch(() => {});
ok('there is a "Cutoff schedules" tab', await admin.locator('[role=tab]:has-text("Cutoff schedules")').isVisible());
await admin.click('[role=tab]:has-text("Cutoff schedules")');
await admin.click('button:has-text("New cutoff schedule")');
await admin.fill('.modal input[placeholder^="For example"]', name);
await admin.locator('.modal [aria-label="Places"] label', { hasText: place.name }).click();
const words = admin.locator('[data-testid=schedule-words]');
await admin.waitForFunction(() => /If it ran now: 2 receipts/.test(document.querySelector('[data-testid=now-preview]')?.textContent ?? ''), null, { timeout: 15_000 }).catch(() => {});
const said = await words.innerText();
ok('the form says it in plain words', said.includes('Every Friday at 5:00 PM (Asia/Manila)') && said.includes(`charged to ${place.name}`), said);
ok('and what it would take now', /If it ran now: 2 receipts, ₱200\.00/.test(said), said);
ok('and when the first cutoff is', /First cutoff: Fri \d+ \w+, 5:00 PM/.test(said), said);
await shot(admin, 'schedule-form');
await admin.click('.modal button:has-text("Save schedule")');
ok('saving says which batch is open until when', await toastSays(admin, /Batch B-\d{4}-\d{6} is open until Fri/));
const card = admin.locator('[data-testid=cutoff-schedule]', { hasText: name });
await card.waitFor();
ok('the schedule card shows it in plain words', (await card.innerText()).includes('Every Friday at 5:00 PM'));

console.log('\nRunning it early from the batch');
await card.locator('a[href^="/batches/"]').first().click();
await admin.waitForSelector('[data-testid=cutoff-panel]');
const panel = admin.locator('[data-testid=cutoff-panel]');
ok('the batch shows its cutoff and time left', /Cutoff Fri \d+ \w+, 5:00 PM \((in|any)/.test(await panel.innerText()), await panel.innerText());
ok('and what would be added now', /2 receipts \(₱200\.00\) would be added now/.test(await admin.locator('[data-testid=would-add]').innerText()));
await shot(admin, 'batch-before-cutoff');
await panel.locator('button:has-text("Run cutoff now")').click();
await admin.click('.modal button:has-text("Run cutoff now")');
ok('running says what happened', await toastSays(admin, /2 receipts added and the batch is closed\. Next cutoff: Fri/));
await admin.waitForSelector('text=Closed at its cutoff');
ok('the batch is closed at its cutoff with both receipts', (await admin.locator('.dh .pill:has-text("Closed")').count()) === 1 && (await admin.locator('.paygrp').count()) === 2);
const batchUrl = admin.url();

console.log('\nAdding a receipt late');
await approvedAt('ana', 'Cutoff UI late', 45);
await admin.reload();
await admin.waitForSelector('.actionbar button:has-text("Add late")', { timeout: 15_000 }).catch(() => {});
ok('"Add receipts" gives way to "Add late"', (await admin.locator('.actionbar button:has-text("Add receipts")').count()) === 0 && await admin.locator('.actionbar button:has-text("Add late")').isVisible());
await admin.click('.actionbar button:has-text("Add late")');
await admin.fill('.modal input[aria-label="Search receipts to add"]', `Cutoff UI late ${tag}`);
await admin.locator('.modal .row', { hasText: 'Cutoff UI late' }).first().waitFor();
await admin.locator('.modal .row', { hasText: 'Cutoff UI late' }).first().locator('input[type=checkbox]').check();
ok('it cannot be added without a reason', await admin.locator('.modal button:has-text("Add late")').isDisabled());
await admin.fill('.modal textarea[aria-label="Why late"]', 'Approved 20 minutes after the cutoff');
await admin.click('.modal button:has-text("Add late 1")');
ok('it is added late', await toastSays(admin, /1 added late/));
await admin.waitForSelector('button.pill.late');
ok('the receipt carries a Late tag with the reason', (await admin.locator('button.pill.late').getAttribute('title')).includes('Approved 20 minutes after the cutoff'));
ok('the batch counts it', /Added late\s*1/.test(await admin.locator('[data-testid=late-count]').innerText()));
await shot(admin, 'batch-late');

console.log('\nThe schedule moved on');
await admin.goto('/batches?tab=schedules');
const after = admin.locator('[data-testid=cutoff-schedule]', { hasText: name });
await after.waitFor();
ok('the card shows the run and the next open batch', /last run .*2 receipts/.test(await after.innerText()) && /Open batch: B-\d{4}-\d{6}, cutoff Fri/.test(await after.innerText()), await after.innerText());

console.log('\nAccounting on a phone');
const rica = await open('accounting@example.com', { width: 390, height: 844 });
await rica.goto('/batches');
await rica.waitForSelector('h1:has-text("Batches")');
ok('no schedules tab for Accounting', (await rica.locator('[role=tab]:has-text("Cutoff schedules")').count()) === 0);
await rica.goto(new URL(batchUrl).pathname);
await rica.waitForSelector('[data-testid=cutoff-panel]');
ok('she sees it was closed at its cutoff, with the late one tagged', /Closed at its cutoff/.test(await rica.locator('[data-testid=cutoff-panel]').innerText()) && (await rica.locator('button.pill.late').count()) === 1);
ok('no sideways scrolling on the batch', await noSideScroll(rica));
await shot(rica, 'phone-batch');
await rica.goto('/batches');
await rica.click('button:has-text("New batch")');
await rica.locator('.modal label:has-text("Fill and close it automatically")').click();
await rica.waitForSelector('[data-testid=rule-fields]');
ok('she can only take approved receipts for a cutoff', (await rica.locator('.modal [aria-label="Which receipts"] button').count()) === 1);
ok('the cutoff form fits the phone', await noSideScroll(rica));
await shot(rica, 'phone-new-batch-cutoff');
await rica.click('.modal button:has-text("Cancel")');

console.log('\nThe schedule form on a phone');
const adminPhone = await open('admin@example.com', { width: 390, height: 844 });
await adminPhone.goto('/batches?tab=schedules');
await adminPhone.click('button:has-text("New cutoff schedule")');
await adminPhone.click('.modal .seg button:has-text("Monthly")');
ok('monthly offers the days of the month and the last day', await adminPhone.locator('.modal [aria-label="Days"] button:has-text("Last day")').isVisible());
ok('the schedule form fits the phone', await noSideScroll(adminPhone));
await shot(adminPhone, 'phone-schedule-form');
await adminPhone.click('.modal button:has-text("Cancel")');

for (const { email, page } of pages) ok(`no errors in the page for ${email}`, page.errors.length === 0, page.errors.join(' | '));
await browser.close();

// Tidy up: the schedule (its open batch goes with it when empty) and the test place.
for (const s of (await call(U.admin, 'GET', '/batch-schedules')).d.schedules.filter((x) => x.name === name)) await call(U.admin, 'DELETE', `/batch-schedules/${s.id}`);
await call(U.admin, 'PATCH', `/charge-locations/${place.id}`, { isActive: false });
console.log(`\nScreenshots: ${OUT}`);
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
