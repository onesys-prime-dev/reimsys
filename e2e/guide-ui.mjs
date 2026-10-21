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
    ok(`${label}: the picture loads`, await p.waitForFunction(() => { const i = document.querySelector('.guide-img'); return !!i && i.complete && i.naturalWidth > 0; }, null, { timeout: 8000 }).then(() => true).catch(() => false));
    ok(`${label}: the part for this page is the first tab`, (await p.locator('.issue').first().innerText()) === tab);
    const h0 = (await p.locator('.guide-img').boundingBox()).height;
    ok(`${label}: it opens with the whole invoice in view`, await p.locator('.guide-img').evaluate((i) => { const v = i.parentElement.getBoundingClientRect(), r = i.getBoundingClientRect(); return r.height <= v.height + 1 && r.top >= v.top - 1; }));
    const z0 = parseInt(await p.locator('.guide-bar b').innerText());
    await p.click('button[aria-label="Zoom in"]');
    const h1 = (await p.locator('.guide-img').boundingBox()).height;
    ok(`${label}: zoom in makes the picture bigger`, h1 > h0 * 1.3, h0 + ' -> ' + h1);
    ok(`${label}: the zoom is shown`, parseInt(await p.locator('.guide-bar b').innerText()) > z0);
    if (step !== 'invoice') { await p.click('button[aria-label="Zoom in"]'); await p.waitForTimeout(150); const sc = await p.locator('.guide-view').evaluate((v) => v.scrollTop); ok(`${label}: zoomed in, it jumps to the marked place`, sc > 100, String(sc)); }
    await p.click('button:has-text("Fit")');
    await p.click('.guide-img');
    ok(`${label}: tapping the picture opens it at a readable size`, (await p.locator('.guide-img').evaluate((i) => i.clientWidth / i.naturalWidth)) > 0.8, String(await p.locator('.guide-img').evaluate((i) => i.clientWidth / i.naturalWidth)));
    await p.click('button:has-text("Fit")');
    ok(`${label}: Fit puts it back`, Math.abs((await p.locator('.guide-img').boundingBox()).height - h0) < 2);
    const vb = await p.locator('.guide-view').boundingBox(), tb = await p.locator('.guide-text').boundingBox();
    ok(`${label}: the instruction sits under the picture`, tb.y >= vb.y + vb.height - 1, JSON.stringify([vb, tb]));
    await p.click('.issue:has-text("Discount")');
    ok(`${label}: another part can be chosen`, (await p.locator('.issue.on').innerText()) === 'Discount');
    ok(`${label}: nothing scrolls sideways`, (await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1);
    const tx = await p.locator('.guide-text').boundingBox(), cl = await p.locator('.modal .btn:has-text("Close")').boundingBox();
    ok(`${label}: the whole instruction is readable, not hidden behind Close`, tx.y + tx.height <= cl.y + 1, JSON.stringify([tx, cl]));
    ok(`${label}: Close is in view`, await p.locator('.modal .btn:has-text("Close")').evaluate((b) => { const r = b.getBoundingClientRect(); return r.bottom <= innerHeight + 1; }));
    await p.keyboard.press('Escape');
    ok(`${label}: Escape closes it`, (await p.locator('.guide-img').count()) === 0);
  }
}
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
