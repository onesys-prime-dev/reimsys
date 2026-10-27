// The field guide pictures are large, and slow on a phone connection: while one is coming in the screen must say so, must not show it half-way, and must say
// so (with a way to retry) when it does not arrive. The pictures are slowed down on purpose here. Needs the API (4000) and web app (5173). Usage: node e2e/guide-loading.mjs
import { chromium } from 'playwright';
import { call, loginAll, today, F } from './payment-helpers.mjs';

const U = await loginAll();
const r = (await call(U.ana, 'POST', '/receipts', { payee: 'Guide loading shop', receiptDate: today(), amount: 1120, ...F, birInvoice: true, invoiceUnderCompany: true, seenCompany: true, seenTin: true, seenAddress: true, invoiceNo: 'GL-' + Date.now(), vendorTin: '123-456-789-00000', transactionType: 'product', vatType: 'vatable', vatableAmount: 1000, vatAmount: 120, withheld: false, description: 'g' })).d.receipt;
let failed = 0;
const ok = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : x); if (!c) failed++; };
const b = await chromium.launch({ channel: 'chrome' });

for (const [label, size] of [['computer', { width: 1280, height: 860 }], ['phone', { width: 390, height: 800 }]]) {
  console.log('\n' + label);
  const p = await (await b.newContext({ viewport: size, baseURL: process.env.WEB ?? 'http://localhost:5173' })).newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  let mode = 'slow'; // slow | broken | normal
  await p.route('**/guide/*.webp*', async (route) => {
    if (mode === 'broken') return route.abort('failed');
    if (mode === 'slow') await new Promise((x) => setTimeout(x, 1800));
    return route.continue();
  });
  await p.goto('/'); await p.fill('input[type=email]', 'ana.reyes@example.com'); await p.fill('input[type=password]', 'Reimsys#2026'); await p.click('button[type=submit]'); await p.waitForSelector('.shell');
  await p.goto(`/receipts/${r.id}/edit?step=vat`); await p.waitForSelector('.steph');
  const btn = p.locator('button[aria-label="Where to find the VAT amount on the invoice"]');
  await btn.click();

  ok('a loading sign shows while the picture comes in', await p.locator('.fg-msg[role=status]:has-text("Loading")').isVisible());
  await p.waitForSelector('.fg-msg', { state: 'detached', timeout: 10000 });
  ok('when it has loaded the sign goes and the picture shows', await p.locator('.fg-full img').evaluate((i) => i.naturalWidth > 0));
  await p.click('.fg-close');

  mode = 'broken';
  await p.locator('button[aria-label="Where to find the vatable amount on the invoice"]').click();
  await p.waitForSelector('.fg-msg[role=alert]', { timeout: 10000 });
  ok('a picture that does not arrive says so, in words', /could not be loaded/i.test(await p.locator('.fg-msg[role=alert]').innerText()));
  ok('and offers Try again', await p.locator('.fg-msg button:has-text("Try again")').isVisible());
  ok('Close still works', await p.locator('.fg-close').isVisible());
  mode = 'normal';
  await p.click('.fg-msg button:has-text("Try again")');
  await p.waitForSelector('.fg-msg', { state: 'detached', timeout: 10000 });
  ok('Try again brings the picture in', await p.locator('.fg-full img').evaluate((i) => i.naturalWidth > 0));
  await p.click('.fg-close');
  ok('the guide closes', (await p.locator('.fg-full').count()) === 0);
  ok('no errors in the browser', errors.length === 0, errors.join(' | '));
  await p.context().close();
}
await b.close();
console.log(failed ? `\n${failed} FAILED` : '\nThe guide tells you when a picture is loading.');
process.exit(failed ? 1 : 0);
