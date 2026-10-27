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

console.log('The receipt page');
await acc.page.goto(`/receipts/${r2.id}`);
const card = acc.page.locator('section.card', { has: acc.page.locator('h3', { hasText: 'Payment' }) });
await card.waitFor({ timeout: 8000 });
const cardText = await card.innerText();
ok('the payment card shows the number, method, amount and reason', /PAY-\d{4}-\d{6}/.test(cardText) && cardText.includes('Bank transfer') && cardText.includes('300.00') && cardText.includes('Parking fee not covered'));
const proofTab = acc.page.waitForEvent('popup');
await card.locator('text=View proof').click();
const proofPage = await proofTab;
await proofPage.waitForLoadState();
ok('"View proof" opens the proof', proofPage.url().includes('/proof?mode=view'));
await proofPage.close();
await acc.page.click('.actionbar >> text=Reverse payment');
const rm = acc.page.locator('.modal');
ok('reversing needs a reason', await rm.locator('button', { hasText: 'Reverse payment' }).isDisabled());
await rm.locator('textarea').fill('Wrong amount, paying again');
await rm.locator('button', { hasText: 'Reverse payment' }).click();
await acc.page.waitForSelector('.dh .pill.s-app');
ok('the receipt is Approved again and the payment card is gone', (await card.count()) === 0);
const reversedItem = acc.page.locator('.tl li', { has: acc.page.locator('.pill', { hasText: 'Reversed' }) }).first();
ok('the history shows the earlier payment as Reversed with its proof', await reversedItem.waitFor({ timeout: 8000 }).then(() => true, () => false) && await reversedItem.locator('a:has-text("View proof")').isVisible());
await acc.page.click('.actionbar >> text=Mark as paid');
const one = acc.page.locator('.modal');
await one.getByLabel('Proof of payment').setInputFiles(proofFile);
await one.locator('button.ok', { hasText: 'Mark as paid' }).click();
await acc.page.waitForSelector('.dh .pill.s-paid');
ok('it can be paid again from the receipt page', await card.isVisible());
await shot(acc.page, 'pay-3-receipt');

console.log('Med Ref');
const ana = await open('ana.reyes@example.com');
await ana.page.goto(`/receipts/${r1.id}`);
await ana.page.waitForSelector('.dh .pill.s-paid');
const anaCard = ana.page.locator('section.card', { has: ana.page.locator('h3', { hasText: 'Payment' }) });
ok('the Med Ref sees the payment and the proof buttons', /PAY-/.test(await anaCard.innerText()) && await anaCard.locator('text=Download').isVisible());
ok('the Med Ref has no payment buttons', (await ana.page.locator('.actionbar >> text=Reverse payment').count()) === 0 && (await ana.page.locator('.actionbar >> text=Mark as paid').count()) === 0);
await ana.page.goto('/receipts');
ok('the receipts list has a Paid filter', await ana.page.locator('.chip', { hasText: 'Paid' }).first().waitFor({ timeout: 8000 }).then(() => true, () => false));

console.log('Dashboards, reports, settings');
await acc.page.goto('/');
await acc.page.waitForSelector('.tiles');
await acc.page.waitForFunction(() => !document.querySelector('.tiles')?.textContent?.includes('–'), null, { timeout: 8000 }).catch(() => undefined);
const tiles = await acc.page.locator('.tiles').innerText();
ok('the accounting dashboard shows what is left to pay and what was paid this month', tiles.includes('To pay') && tiles.includes('Paid this month'));
ok('its queue is "Ready to pay"', await acc.page.locator('h2', { hasText: 'Ready to pay' }).isVisible());
const appr = await open('paolo.v@example.com');
await appr.page.waitForSelector('.tiles');
const apTiles = await appr.page.locator('.tiles').innerText();
ok('the approver sees approved-not-paid and paid', apTiles.includes('Approved, not paid') && apTiles.includes('Paid'));
ok('a long invoice number stays inside its column in the lists, and does not make the row tall (it is cut short, with the full text on hover)', await appr.page.evaluate(() => [...document.querySelectorAll('.row')].every((row) => { const c = row.querySelector('.c-cat'); return !c || (c.getBoundingClientRect().right <= row.getBoundingClientRect().right + 1 && row.getBoundingClientRect().height < 110); })));
await acc.page.goto('/reports');
const payField = acc.page.getByLabel('Payment');
const hasPayField = await payField.waitFor({ timeout: 5000 }).then(() => true, () => false);
if (hasPayField) await payField.selectOption('paid');
const previewOk = hasPayField && await acc.page.locator('.callout', { hasText: /\d+ paid record/ }).waitFor({ timeout: 8000 }).then(() => true, () => false);
ok('the report preview counts paid records', previewOk);
if (previewOk) {
  await acc.page.click('button:has-text("Generate")');
  await acc.page.waitForURL(/\/reports\/\d+/);
  await acc.page.waitForSelector('th:has-text("Paid")');
  const view = await acc.page.locator('.tiles').innerText();
  ok('the report view shows paid and not yet paid totals', view.includes('Paid') && view.includes('Not yet paid'));
  await shot(acc.page, 'pay-6-report');
}
const admin = await open('admin@example.com');
await admin.page.goto('/access');
await admin.page.click('[role=tab] >> text=Settings');
ok('the Super Admin can edit the payment methods', await admin.page.locator('h2:has-text("Payment methods")').waitFor({ timeout: 8000 }).then(() => true, () => false) && await admin.page.getByLabel('Payment method 1', { exact: true }).waitFor({ timeout: 8000 }).then(() => true, () => false));
await shot(admin.page, 'pay-7-settings');

const anaDash = ana.page;
await anaDash.goto('/');
await anaDash.waitForSelector('.tiles');
const anaTiles = await anaDash.locator('.tiles').innerText();
ok('the Med Ref dashboard shows approved-not-paid and paid', anaTiles.includes('Approved, not paid') && /\nPaid\n/.test('\n' + anaTiles + '\n'));
const lizaS = await open('liza.santos@example.com');
await lizaS.page.waitForSelector('.tiles');
const lizaTiles = await lizaS.page.locator('.tiles').innerText();
ok('the Checker dashboard shows approved-not-paid and paid', lizaTiles.includes('Approved, not paid') && /\nPaid\n/.test('\n' + lizaTiles + '\n'));
await admin.page.goto('/');
await admin.page.waitForSelector('.tiles');
// The dashboard follows the permissions: by default the Super Admin has the admin one, but anyone granted review, encode or payment
// rights on the Access page gets that role's dashboard instead. Each of those shows the paid figures.
const adminPerms = (await call(U.admin, 'GET', '/me')).d.permissions;
const custom = ['review.check', 'review.decide', 'receipt.create', 'payment.mark'].some((p) => adminPerms.includes(p));
const adminTiles = await admin.page.locator('.tiles').innerText();
ok(custom ? 'a Super Admin who was granted extra rights sees the matching dashboard, with the paid figures' : 'the admin "Approved total" counts paid receipts too', custom ? /Paid/.test(adminTiles) : adminTiles.includes('Approved total (incl. paid)'));

console.log('Phone screen');
const phone = await open('accounting@example.com', { width: 390, height: 800 });
await phone.page.goto('/pay');
await phone.page.waitForSelector(`text=${r3.refNo}`);
await phone.page.getByLabel(`Select ${r3.refNo}`).check();
const bar = await phone.page.locator('.savebar').boundingBox();
ok('on a phone the "Mark as paid" bar sits at the bottom, above the menu', !!bar && bar.y > 500);
ok('on a phone nothing scrolls sideways', await noSideScroll(phone.page));
ok('on a phone a long vendor name does not run into the amount', await phone.page.evaluate(() => [...document.querySelectorAll('.row')].slice(0, 20).every((row) => {
  const b = row.querySelector('.c-main b')?.getBoundingClientRect();
  const amt = row.querySelector('.c-amt')?.getBoundingClientRect();
  return !b || !amt || b.right <= amt.left + 1;
})));
await phone.page.screenshot({ path: path.join(OUT, 'pay-4-phone.png') });
await phone.page.click('.savebar >> text=Mark as paid');
await phone.page.locator('.modal').waitFor();
ok('on a phone the dialog fits the width', await noSideScroll(phone.page));
await phone.page.screenshot({ path: path.join(OUT, 'pay-5-phone-dialog.png') });

// END OF CHECKS
for (const s of sessions) ok(`no errors on the page for ${s.email}`, s.page.errors.length === 0 || (console.log(s.page.errors), false));
await browser.close();
console.log(failed ? `\n${failed} check(s) failed. Screenshots in ${OUT}` : `\nAll checks passed. Screenshots in ${OUT}`);
process.exit(failed ? 1 : 0);
