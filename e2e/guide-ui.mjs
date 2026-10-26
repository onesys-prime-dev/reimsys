// Checks the field guides in the receipt form, in Chrome: each question has its own button and its own picture, and the picture opens over the whole
// screen with only the picture and a Close button. Desktop and phone sizes. Needs the API (4000) and web app (5173). Usage: node e2e/guide-ui.mjs
import { chromium } from 'playwright';
import { call, loginAll, today, F } from './payment-helpers.mjs';

const U = await loginAll();
const r = (await call(U.ana, 'POST', '/receipts', { payee: 'Guide shop', receiptDate: today(), amount: 1120, ...F, birInvoice: true, invoiceUnderCompany: true, seenCompany: true, seenTin: true, seenAddress: true, invoiceNo: 'G-' + Date.now(), vendorTin: '123-456-789-00000', transactionType: 'product', vatType: 'vatable', vatableAmount: 1000, vatAmount: 120, withheld: true, whtRate: 2, whtAmount: 20, description: 'g' })).d.receipt;
const browser = await chromium.launch({ channel: 'chrome' });
let failed = 0;
const ok = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : x); if (!c) failed++; };

// the picture each field must open, by the name the button gives it
const EXPECT = {
  invoice: [['invoice date', 'overview'], ['invoice number', 'overview'], ['vendor name', 'overview'], ['vendor address', 'overview'], ['vendor TIN', 'overview'], ['gross amount', 'total']],
  vat: [['vatable amount', 'vatable'], ['VAT amount', 'vat'], ['tax withheld', 'withholding']],
  wht: [['withholding tax rate', 'withholding'], ['withholding tax amount', 'withholding']],
};

for (const [label, size] of [['desktop', { width: 1280, height: 860 }], ['phone', { width: 390, height: 800 }]]) {
  console.log('\n' + label);
  const p = await (await browser.newContext({ viewport: size, baseURL: process.env.WEB ?? 'http://localhost:5173', hasTouch: label === 'phone' })).newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto('/'); await p.fill('input[type=email]', 'ana.reyes@example.com'); await p.fill('input[type=password]', 'Reimsys#2026'); await p.click('button[type=submit]'); await p.waitForSelector('.shell');
  for (const [step, fields] of Object.entries(EXPECT)) {
    await p.goto(`/receipts/${r.id}/edit?step=${step}`); await p.waitForSelector('.steph');
    ok(`${label}: the old one-picture-per-page button is gone on the ${step} page`, (await p.locator('button:has-text("How to read the invoice")').count()) === 0);
    for (const [name, image] of fields) {
      const btn = p.locator(`button[aria-label="Where to find the ${name} on the invoice"]`);
      ok(`${label}: ${step}: "${name}" has its own guide button`, (await btn.count()) === 1);
      await btn.click();
      const dlg = p.locator('.fg-full');
      await dlg.waitFor();
      ok(`${label}: "${name}" opens the ${image} picture`, await p.waitForFunction((i) => { const x = document.querySelector('.fg-full img'); return !!x && x.complete && x.naturalWidth > 0 && x.getAttribute('src').includes(`/guide/${i}.png`); }, image, { timeout: 8000 }).then(() => true).catch(() => false));
      const box = await dlg.boundingBox();
      ok(`${label}: "${name}" covers the whole screen`, Math.abs(box.width - size.width) < 2 && Math.abs(box.height - size.height) < 2, JSON.stringify(box));
      const img = await p.locator('.fg-full img').boundingBox();
      // the picture uses as much of the free space as its shape allows: it touches the width or the height of the space under the Close button
      const stage = await p.locator('.fg-stage').boundingBox();
      ok(`${label}: "${name}" fills the free space`, img.width >= stage.width - 20 || img.height >= stage.height - 20, JSON.stringify({ img, stage }));
      // only the picture and a close button are visible: no text, tabs or zoom buttons
      const visible = await dlg.evaluate((d) => [...d.querySelectorAll('button, a, input, select, p, h1, h2, h3, label')].filter((e) => { const s = getComputedStyle(e), b = e.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && b.width > 0 && b.height > 0; }).map((e) => (e.textContent || '').trim()));
      ok(`${label}: "${name}" shows only the picture and Close`, visible.length === 1 && /Close/.test(visible[0]), JSON.stringify(visible));
      ok(`${label}: the Close button is on the screen and easy to press`, await p.locator('.fg-close').evaluate((b) => { const x = b.getBoundingClientRect(); return x.top >= 0 && x.bottom <= innerHeight && x.height >= 40; }));
      ok(`${label}: nothing scrolls sideways`, (await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1);
      if (name === 'vendor TIN') await p.screenshot({ path: process.env.TEMP + `/field-guide-${label}.png` });
      if (name.includes('rate') || name === 'invoice date') { await p.keyboard.press('Escape'); } else { await p.click('.fg-close'); }
      ok(`${label}: "${name}" closes`, (await p.locator('.fg-full').count()) === 0);
      ok(`${label}: focus returns to the button`, await btn.evaluate((b) => document.activeElement === b));
    }
  }
  ok(`${label}: no errors in the browser`, errors.length === 0, errors.join(' | '));
  await p.context().close();
}
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
