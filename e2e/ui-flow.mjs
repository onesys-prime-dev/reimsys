// Drives the real UI in Chrome through the main journey. Needs the API (4000) and web app (5173) running.
// Usage: node e2e/ui-flow.mjs [screenshot-dir]
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OUT = process.argv[2] ?? path.join(os.tmpdir(), 'reimsis-shots');
fs.mkdirSync(OUT, { recursive: true });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const png = path.join(OUT, `receipt-${Date.now()}.png`);
fs.writeFileSync(png, Buffer.concat([PNG, Buffer.from(String(Date.now()))]));

const browser = await chromium.launch({ channel: 'chrome' });
let failed = 0;
const ok = (name, cond) => { console.log(cond ? '  ok  ' : '  FAIL', name); if (!cond) failed++; };

async function open(email, size = { width: 1280, height: 820 }) {
  const ctx = await browser.newContext({ viewport: size, baseURL: process.env.WEB ?? 'http://localhost:5173', acceptDownloads: true });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/401|403|409/.test(m.text()) && page.errors.push(m.text()));
  await page.goto('/');
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', 'Reimsis#2026');
  await page.click('button[type=submit]');
  await page.waitForSelector('.shell');
  return { ctx, page };
}
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + '.png') });
const toastText = (page) => page.locator('.toast').last().innerText();

const payee = 'UI Flow Pharmacy ' + Date.now();

console.log('Med Ref');
const ana = await open('ana.reyes@example.com');
await shot(ana.page, '1-medref-dashboard');
await ana.page.click('text=New receipt >> nth=0');
await ana.page.waitForSelector('form');
await ana.page.click('button:has-text("Submit for checking")');
ok('validation shows errors without saving', (await ana.page.locator('.err').count()) >= 2);
await ana.page.fill('input[placeholder="Store or provider name"]', payee);
await ana.page.fill('input[placeholder="0.00"]', '2480.75');
await ana.page.fill('input[placeholder="What was this for?"]', 'UI flow test');
await ana.page.setInputFiles('input[type=file]', png);
await shot(ana.page, '2-medref-form');
await ana.page.click('button:has-text("Submit for checking")');
await ana.page.waitForURL(/\/receipts\/\d+$/);
await ana.page.waitForSelector('.pill:has-text("Submitted")');
const receiptUrl = ana.page.url();
ok('submitted and shown on the detail page', true);
await shot(ana.page, '3-medref-submitted');

console.log('Checker');
const liza = await open('liza.santos@example.com');
await liza.page.goto(receiptUrl);
await liza.page.waitForSelector('text=Evidence is protected');
ok('checker sees evidence locked', true);
ok('Mark checked disabled until evidence opened', await liza.page.locator('button:has-text("Mark checked")').isDisabled());
await liza.page.click('button:has-text("Open evidence")');
await liza.page.waitForSelector('img.evimg');
await liza.page.waitForFunction(() => document.querySelector('.tl')?.textContent?.includes('viewed evidence'));
await shot(liza.page, '4-checker-review');
ok('Mark checked enabled after viewing', await liza.page.locator('button:has-text("Mark checked"):not([disabled])').waitFor({ timeout: 5000 }).then(() => true, () => false));
await liza.page.click('button:has-text("Return")');
ok('return needs a note', await liza.page.locator('.modal button:has-text("Return record")').isDisabled());
await liza.page.fill('.modal textarea', 'Please add the doctor name in the description.');
await liza.page.click('.modal button:has-text("Return record")');
await liza.page.waitForSelector('.pill:has-text("Returned")');
ok('returned', true);

console.log('Med Ref fixes and resubmits');
await ana.page.goto(receiptUrl);
await ana.page.waitForSelector('.callout:has-text("doctor name")');
ok('med ref sees the return note', true);
await ana.page.click('a:has-text("Edit")');
await ana.page.fill('input[placeholder="What was this for?"]', 'UI flow test, Dr. Reyes');
await ana.page.click('button:has-text("Resubmit for checking")');
await ana.page.waitForSelector('.pill:has-text("Submitted")');
ok('resubmitted', true);

console.log('Checker checks, Approver decides');
await liza.page.goto(receiptUrl);
await liza.page.click('button:has-text("Open evidence")');
await liza.page.waitForFunction(() => document.querySelectorAll('.tl li').length > 0 && [...document.querySelectorAll('.tl li')].some((l) => l.textContent.includes('viewed evidence')));
await liza.page.waitForSelector('button:has-text("Mark checked"):not([disabled])');
await liza.page.click('button:has-text("Mark checked")');
await liza.page.click('.modal button:has-text("Mark checked")');
await liza.page.waitForSelector('.pill:has-text("Checked")');
ok('checked', true);

const paolo = await open('paolo.v@example.com');
await paolo.page.goto('/');
await paolo.page.waitForSelector(`text=${payee}`);
ok('approver queue shows it', true);
await shot(paolo.page, '5-approver-dashboard');
await paolo.page.goto(receiptUrl);
await paolo.page.click('button:has-text("Open evidence")');
await paolo.page.click('button:has-text("Reserve")');
await paolo.page.fill('.modal textarea', 'Hold for budget confirmation.');
await paolo.page.click('.modal button:has-text("Reserve")');
await paolo.page.waitForSelector('.callout:has-text("On hold")');
ok('reserved with a note', true);
await paolo.page.click('button:has-text("Release to queue")');
await paolo.page.click('.modal button:has-text("Release to queue")');
await paolo.page.waitForSelector('button:text-is("Approve")');
await paolo.page.click('button:text-is("Approve")');
await paolo.page.click('.modal button:text-is("Approve")');
await paolo.page.waitForSelector('.pill:has-text("Approved")');
ok('approved', true);

console.log('Document, notifications, reports');
await ana.page.goto(receiptUrl);
const docLink = ana.page.locator('.card:has-text("Reimbursement document") a:has-text("Download")'); await docLink.waitFor({ timeout: 20000 });
const [dl] = await Promise.all([ana.page.waitForEvent('download'), docLink.click()]);
const file = path.join(OUT, dl.suggestedFilename());
await dl.saveAs(file);
ok('reimbursement document downloads as a PDF', fs.readFileSync(file).subarray(0, 5).toString() === '%PDF-');
await shot(ana.page, '6-medref-approved');
await ana.page.click('button[aria-label^="Notifications"]');
await ana.page.waitForSelector('.panel .note');
ok('notification bell lists updates', (await ana.page.locator('.panel .note').count()) >= 2);
await shot(ana.page, '7-notifications');
await ana.page.keyboard.press('Escape');

await ana.page.goto('/reports');
await ana.page.waitForSelector('text=approved record');
await ana.page.click('button:has-text("Generate PDF")');
await ana.page.waitForSelector('.rep-row a[aria-label^="Download report"]', { timeout: 20000 });
ok('report generated and downloadable', true);
await shot(ana.page, '8-reports');

console.log('Admin');
const admin = await open('admin@example.com');
await admin.page.goto('/audit');
await admin.page.fill('input[aria-label="Search audit log"]', payee.slice(0, 12) === '' ? 'receipt' : 'approved the record');
await admin.page.waitForSelector('.aud');
ok('audit log lists the approval', (await admin.page.locator('.aud').count()) > 0);
await shot(admin.page, '9-admin-audit');
await admin.page.goto('/access');
await admin.page.click('button[role=tab]:has-text("Categories")');
await admin.page.waitForSelector('.cats .urow');
ok('categories tab lists categories', (await admin.page.locator('.cats .urow').count()) >= 5);

console.log('Phone layout');
const m = await open('ana.reyes@example.com', { width: 390, height: 800 });
await m.page.goto('/receipts');
await m.page.waitForSelector('a.row');
await shot(m.page, '10-phone-list');
await m.page.goto(receiptUrl);
await m.page.waitForSelector('.dh');
await shot(m.page, '11-phone-detail');
const overflow = await m.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
ok('no horizontal scrolling on a phone', overflow <= 1);

for (const [n, c] of [['ana', ana], ['liza', liza], ['paolo', paolo], ['admin', admin], ['phone', m]]) {
  if (c.page.errors.length) { console.log('  console errors for', n, c.page.errors.slice(0, 3)); }
}
await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nAll UI checks passed');
process.exit(failed ? 1 : 0);
