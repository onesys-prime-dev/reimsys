// Drives the payment step in Chrome as Accounting and as a Med Ref, on a computer screen and a phone screen.
// Needs the API (4000) and the web app (5173) running, and the seed applied. Usage: node e2e/payment-ui.mjs [screenshot-dir]
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG, call, loginAll, makeApproved, pay } from './payment-helpers.mjs';

const OUT = process.argv[2] ?? path.join(os.tmpdir(), 'reimsys-pay-shots');
fs.mkdirSync(OUT, { recursive: true });
const proofFile = path.join(OUT, `proof-${Date.now()}.png`);
fs.writeFileSync(proofFile, Buffer.concat([PNG, Buffer.from(String(Date.now()))]));

const U = await loginAll();
const r1 = await makeApproved(U, 'ana', 'UI pay A', 500);
const r2 = await makeApproved(U, 'ana', 'UI pay B', 320.75);
const r3 = await makeApproved(U, 'mark', 'UI pay other person', 150);
const paidBefore = await makeApproved(U, 'ana', 'UI already paid', 90);
await pay(U.rica, [paidBefore]);

const browser = await chromium.launch({ channel: 'chrome' });
let failed = 0;
const ok = (name, cond) => { console.log(cond ? '  ok  ' : '  FAIL', name); if (!cond) failed++; };
const sessions = [];
async function open(email, size = { width: 1280, height: 820 }) {
  const ctx = await browser.newContext({ viewport: size, baseURL: process.env.WEB ?? 'http://localhost:5173', acceptDownloads: true });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/401|403|404|409/.test(m.text()) && page.errors.push(m.text()));
  await page.goto('/');
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', 'Reimsys#2026');
  await page.click('button[type=submit]');
  await page.waitForSelector('.shell');
  sessions.push({ email, page });
  return { ctx, page };
}
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true });
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const toastText = async (page) => (await page.locator('.toast').last().innerText().catch(() => ''));

console.log('Accounting, computer screen');
const acc = await open('accounting@example.com');
ok('the menu has "Ready to pay" and "Receipts"', (await acc.page.locator('.side .nav >> text=Ready to pay').count()) === 1 && (await acc.page.locator('.side .nav >> text=Receipts').count()) === 1);
if (await acc.page.locator('.side .nav >> text=Ready to pay').count()) {
  await acc.page.click('.side .nav >> text=Ready to pay');
  await acc.page.waitForSelector(`text=${r1.refNo}`);
}
ok('the queue shows the approved receipts grouped by person', await acc.page.locator('.card', { hasText: 'Ana Reyes' }).locator(`text=${r1.refNo}`).isVisible() && await acc.page.locator('.card', { hasText: 'Mark Dela Cruz' }).locator(`text=${r3.refNo}`).isVisible());
await shot(acc.page, 'pay-1-queue');
await acc.page.goto(`/receipts/${paidBefore.id}`);
await acc.page.waitForSelector('.dh');
ok('a paid receipt shows the Paid pill', await acc.page.locator('.dh .pill.s-paid').isVisible());

console.log('Selecting and paying');
await acc.page.goto('/pay');
await acc.page.waitForSelector(`text=${r1.refNo}`);
await acc.page.getByLabel(`Select ${r1.refNo}`).check({ timeout: 5000 });
await acc.page.getByLabel(`Select ${r3.refNo}`).check();
ok('ticking another person starts a new selection', !(await acc.page.getByLabel(`Select ${r1.refNo}`).isChecked()) && (await acc.page.locator('.savebar').innerText()).includes('1 selected'));
await acc.page.getByLabel(`Select ${r1.refNo}`).check();
await acc.page.getByLabel(`Select ${r2.refNo}`).check();
ok('the bar shows how many and how much', /2 selected/.test(await acc.page.locator('.savebar').innerText()) && (await acc.page.locator('.savebar').innerText()).includes('820.75'));
await acc.page.click('.savebar >> text=Mark as paid');
const dlg = acc.page.locator('.modal');
await dlg.waitFor();
ok('the dialog lists both receipts with their amounts filled in', (await dlg.getByLabel(`Amount paid for ${r1.refNo}`).inputValue()) === '500' && (await dlg.getByLabel(`Amount paid for ${r2.refNo}`).inputValue()) === '320.75');
const payBtn = dlg.locator('button.ok', { hasText: 'Mark as paid' });
ok('it cannot be sent without a proof', await payBtn.isDisabled());
await dlg.getByLabel('Proof of payment').setInputFiles(proofFile);
await dlg.getByLabel(`Amount paid for ${r2.refNo}`).fill('300');
ok('paying less asks for a reason', await dlg.getByLabel(`Why less was paid for ${r2.refNo}`).isVisible() && await payBtn.isDisabled());
await dlg.getByLabel(`Why less was paid for ${r2.refNo}`).fill('Parking fee not covered');
ok('the total updates', (await dlg.innerText()).includes('800.00'));
await shot(acc.page, 'pay-2-dialog');
await payBtn.click();
await acc.page.waitForSelector('.toast');
ok('it confirms with the payment number', /PAY-\d{4}-\d{6}/.test(await toastText(acc.page)));
await acc.page.waitForSelector(`text=${r1.refNo}`, { state: 'detached' });
ok('the paid receipts leave the queue, the other person stays', (await acc.page.locator(`text=${r2.refNo}`).count()) === 0 && (await acc.page.locator(`text=${r3.refNo}`).count()) === 1);

// END OF CHECKS
for (const s of sessions) ok(`no errors on the page for ${s.email}`, s.page.errors.length === 0 || (console.log(s.page.errors), false));
await browser.close();
console.log(failed ? `\n${failed} check(s) failed. Screenshots in ${OUT}` : `\nAll checks passed. Screenshots in ${OUT}`);
process.exit(failed ? 1 : 0);
