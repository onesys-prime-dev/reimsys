// Checks the "How to read the invoice" help in the receipt form, in Chrome. Needs the API (4000) and web app (5173). Usage: node e2e/guide-ui.mjs
import { chromium } from 'playwright';
import { call, loginAll, today, F } from './payment-helpers.mjs';

const U = await loginAll();
const r = (await call(U.ana, 'POST', '/receipts', { payee: 'Guide shop', receiptDate: today(), amount: 1000, ...F, birInvoice: true, invoiceUnderCompany: true, seenCompany: true, seenTin: true, seenAddress: true, invoiceNo: 'G-' + Date.now(), vendorTin: '123-456-789-000', transactionType: 'product', vatType: 'vatable', vatableAmount: 892.86, vatAmount: 107.14, withheld: true, whtRate: 2, whtAmount: 17.86, description: 'g' })).d.receipt;
const browser = await chromium.launch({ channel: 'chrome' });
let failed = 0;
const ok = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : x); if (!c) failed++; };
for (const [label, size] of [['desktop', { width: 1280, height: 860 }], ['phone', { width: 390, height: 800 }]]) {
  const p = await (await browser.newContext({ viewport: size, baseURL: process.env.WEB ?? 'http://localhost:5173' })).newPage();
  await p.goto('/'); await p.fill('input[type=email]', 'ana.reyes@example.com'); await p.fill('input[type=password]', 'Reimsys#2026'); await p.click('button[type=submit]'); await p.waitForSelector('.shell');
  for (const [step, tab] of [['invoice', 'The invoice'], ['vat', 'Vatable amount'], ['wht', 'Withholding tax']]) {
    await p.goto(`/receipts/${r.id}/edit?step=${step}`); await p.waitForSelector('.steph');
    await p.click('button:has-text("How to read the invoice")');
    await p.waitForSelector('.guide-img');
    ok(`${label}: the ${step} step opens the guide on "${tab}"`, (await p.locator('.issue.on').innerText()) === tab);
    ok(`${label}: the picture loads`, await p.locator('.guide-img').evaluate((i) => i.complete && i.naturalWidth > 0));
    await p.click('.issue:has-text("Discount")');
    ok(`${label}: another part can be chosen`, (await p.locator('.issue.on').innerText()) === 'Discount');
    ok(`${label}: nothing scrolls sideways`, (await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1);
    ok(`${label}: Close is in view`, await p.locator('.modal .btn:has-text("Close")').evaluate((b) => { const r = b.getBoundingClientRect(); return r.bottom <= innerHeight + 1; }));
    await p.keyboard.press('Escape');
    ok(`${label}: Escape closes it`, (await p.locator('.guide-img').count()) === 0);
  }
}
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
