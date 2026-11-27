// Drives the two client requests in Chrome: a Med Ref chooses the batch of her receipt (on the receipt page and in the form), the
// draft joins when she submits; and the Receipts search finds a receipt from any words on it. Computer and phone.
// Needs the API (4000) and the web app (5173) running, and the seed applied. Usage: node e2e/search-batch-choice-ui.mjs [screenshot-dir]
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { B, F, H, PNG, call, loginAll, tag, today } from './payment-helpers.mjs';

const OUT = process.argv[2] ?? path.join(os.tmpdir(), 'reimsys-choice-shots');
fs.mkdirSync(OUT, { recursive: true });
const U = await loginAll();
const word = tag.split(' ').pop();
async function draft(payee, extra = {}) {
  const r = (await call(U.ana, 'POST', '/receipts', { payee: `${payee} ${tag}`, receiptDate: today(), amount: 345.6, ...F, ...extra })).d.receipt;
  const f = new FormData();
  f.append('files', new Blob([Buffer.concat([PNG, Buffer.from(payee + tag + Math.random())])], { type: 'image/png' }), 'receipt.png');
  return (await (await fetch(`${B}/receipts/${r.id}/evidence`, { method: 'POST', headers: H(U.ana, false), body: f })).json()).receipt;
}
const batch = (await call(U.rica, 'POST', '/batches', { name: `Pasig week ${word}` })).d.batch;
const D = await draft('Choice UI', { reasonForSpending: `Seminar kit for Pasig ${word}` });

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
const toastSays = async (page, re) => page.waitForFunction((src) => [...document.querySelectorAll('.toast')].some((t) => new RegExp(src).test(t.textContent ?? '')), re.source, { timeout: 15_000 }).then(() => true, () => false);

console.log('The Med Ref chooses the batch on her receipt');
const ana = await open('ana.reyes@example.com');
await ana.goto(`/receipts/${D.id}`);
await ana.waitForSelector('[data-testid=pick-batch]');
ok('her draft offers "Choose batch"', (await ana.locator('[data-testid=pick-batch]').innerText()).includes('Choose batch'));
await ana.click('[data-testid=pick-batch]');
await ana.waitForSelector(`.modal select option[value="${batch.id}"]`, { state: 'attached' });
await ana.selectOption('.modal select[aria-label=Batch]', String(batch.id));
await shot(ana, 'choose-batch');
await ana.click('.modal button:has-text("Save")');
ok('saving says it joins when she submits', await toastSays(ana, new RegExp(`It joins ${batch.code} when you submit`)));
await ana.waitForSelector('[data-testid=want-batch]');
ok('the receipt shows the batch it will join', (await ana.locator('[data-testid=want-batch]').innerText()).includes(batch.code));

console.log('\nThe form shows the same choice');
await ana.goto(`/receipts/${D.id}/edit?step=spend`);
await ana.waitForSelector('select[aria-label=Batch]:not([disabled])');
ok('the batch field shows her choice', (await ana.locator('select[aria-label=Batch]').inputValue()) === String(batch.id));
ok('and says it joins when she submits', await ana.locator('text=It joins the batch when you submit.').isVisible());
await shot(ana, 'form-batch');

console.log('\nSubmitting puts it in the batch');
await ana.goto(`/receipts/${D.id}`);
await ana.click('.actionbar button:has-text("Submit for checking"), button:has-text("Submit for checking")');
const confirm = ana.locator('.modal button:has-text("Submit for checking")');
if (await confirm.count()) await confirm.click();
await ana.waitForSelector(`text=Batch ${batch.code}`, { timeout: 15_000 }).catch(() => {});
await shot(ana, 'after-submit');
const meta = await ana.locator('.dh .meta').innerText();
ok('after submitting, the receipt is in the batch', meta.includes(`Batch ${batch.code}`), meta);
ok('and she can still change it while the batch is open', (await ana.locator('[data-testid=pick-batch]').innerText()).includes('Change batch'));

console.log('\nSearching with any words');
const admin = await open('admin@example.com');
await admin.goto('/receipts');
await admin.fill('input[aria-label="Search receipts"]', `seminar ${word} 345.60`);
await admin.waitForSelector(`text=${D.refNo}`, { timeout: 15_000 }).catch(() => {});
ok('words from the reason plus the amount find it', await admin.locator(`text=${D.refNo}`).first().isVisible());
ok('the box says it searches anything', (await admin.locator('input[aria-label="Search receipts"]').getAttribute('placeholder')).startsWith('Search anything'));
await admin.fill('input[aria-label="Search receipts"]', `seminar ${word} unicorn`);
await admin.waitForFunction((ref) => !document.body.innerText.includes(ref), D.refNo, { timeout: 15_000 }).catch(() => {});
ok('a word that is not on it leaves it out', !(await admin.locator(`text=${D.refNo}`).count()));
await shot(admin, 'search');

console.log('\nOn a phone');
const phone = await open('ana.reyes@example.com', { width: 390, height: 844 });
await phone.goto(`/receipts/${D.id}`);
await phone.waitForSelector('[data-testid=pick-batch]');
ok('the receipt page fits the phone', await noSideScroll(phone));
await phone.click('[data-testid=pick-batch]');
await phone.waitForSelector('.modal select[aria-label=Batch]');
ok('the batch chooser fits the phone', await noSideScroll(phone));
await shot(phone, 'phone-choose-batch');

for (const { email, page } of pages) ok(`no errors in the page for ${email}`, page.errors.length === 0, page.errors.join(' | '));
await browser.close();
console.log(`\nScreenshots: ${OUT}`);
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
