// "How to read the invoice": while a picture is coming in (they are large, and slow on a phone connection) the window must say so, must not leave the
// previous picture up under the new tab's text, and must say so (with a way to retry) when the picture does not arrive. The pictures are slowed down on
// purpose here. Needs the API (4000) and web app (5173). Usage: node e2e/guide-loading.mjs
import { chromium } from 'playwright';
import { call, loginAll, today, F } from './payment-helpers.mjs';

const U = await loginAll();
const r = (await call(U.ana, 'POST', '/receipts', { payee: 'Guide loading shop', receiptDate: today(), amount: 1000, ...F, birInvoice: true, invoiceUnderCompany: true, seenCompany: true, seenTin: true, seenAddress: true, invoiceNo: 'GL-' + Date.now(), vendorTin: '123-456-789-000', transactionType: 'product', vatType: 'vatable', vatableAmount: 892.86, vatAmount: 107.14, withheld: true, whtRate: 2, whtAmount: 17.86, description: 'g' })).d.receipt;
let failed = 0;
const ok = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : x); if (!c) failed++; };
const b = await chromium.launch({ channel: 'chrome' });

for (const [label, size] of [['computer', { width: 1280, height: 860 }], ['phone', { width: 390, height: 800 }]]) {
  console.log('\n' + label);
  const p = await (await b.newContext({ viewport: size, baseURL: process.env.WEB ?? 'http://localhost:5173' })).newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  let mode = 'slow'; // slow | broken | normal
  const hits = [];
  await p.route('**/guide/*.png*', async (route) => {
    hits.push(new URL(route.request().url()).pathname);
    if (mode === 'broken') return route.abort('failed');
    if (mode === 'slow') await new Promise((x) => setTimeout(x, 1800));
    return route.continue();
  });
  await p.goto('/'); await p.fill('input[type=email]', 'ana.reyes@example.com'); await p.fill('input[type=password]', 'Reimsys#2026'); await p.click('button[type=submit]'); await p.waitForSelector('.shell');
  await p.goto(`/receipts/${r.id}/edit?step=vat`); await p.waitForSelector('.steph');
  await p.click('button:has-text("How to read the invoice")');

  // 1. the first picture: a loading sign, then the picture
  ok('a loading sign shows while the first picture comes in', await p.locator('.guide-loading[role=status]:has-text("Loading")').isVisible());
  ok('the picture is not shown half-way (hidden until it has loaded)', (await p.locator('.guide-img').evaluate((i) => getComputedStyle(i).visibility)) === 'hidden');
  await p.waitForSelector('.guide-loading', { state: 'detached', timeout: 10000 });
  ok('when it has loaded the sign goes and the picture shows', (await p.locator('.guide-img').evaluate((i) => i.naturalWidth > 0 && getComputedStyle(i).visibility === 'visible')));
  await p.screenshot({ path: process.env.TEMP + `/guide-loaded-${label}.png` });

  // 2. switching to a tab of this page of the form: its picture was fetched quietly in the background, so it is already there (no wait, no sign)
  const before = await p.locator('.guide-img').getAttribute('src');
  await p.waitForTimeout(2500); // let the background fetches finish
  mode = 'slow';
  await p.click('button[role=tab]:has-text("VAT-exempt")');
  await p.waitForTimeout(250);
  const quick = await p.evaluate(() => ({ loadingShown: !!document.querySelector('.guide-loading'), src: document.querySelector('.guide-img')?.getAttribute('src'), vis: document.querySelector('.guide-img') ? getComputedStyle(document.querySelector('.guide-img')).visibility : null, text: document.querySelector('.guide-text')?.textContent ?? '' }));
  ok('a tab of this page of the form shows its picture at once, because it was fetched in the background', !quick.loadingShown && quick.vis === 'visible' && quick.src.includes('exempt.png') && /VAT-Exempt/.test(quick.text), JSON.stringify(quick));

  // 3. a tab that was not fetched ahead: the text changes at once, the old picture goes, a loading sign shows, then the new picture arrives
  await p.click('button[role=tab]:has-text("Withholding tax")');
  const during = await p.evaluate(() => ({ loadingShown: !!document.querySelector('.guide-loading[role=status]'), img: (() => { const i = document.querySelector('.guide-img'); return i ? { src: i.getAttribute('src'), visible: getComputedStyle(i).visibility } : null; })(), text: document.querySelector('.guide-text')?.textContent ?? '' }));
  ok('the text under the picture changes at once, with the tab', /withholding/i.test(during.text), during.text);
  ok('the old picture is not left showing under the new text', !during.img || during.img.visible === 'hidden' || during.img.src !== before, JSON.stringify(during));
  ok('a loading sign shows while the new picture comes in', during.loadingShown, JSON.stringify(during));
  await p.waitForSelector('.guide-loading', { state: 'detached', timeout: 10000 });
  ok('then the new picture shows', (await p.locator('.guide-img').getAttribute('src')).includes('withholding.png') && await p.locator('.guide-img').evaluate((i) => i.naturalWidth > 0 && getComputedStyle(i).visibility === 'visible'));

  // 4. a picture that does not arrive
  mode = 'broken';
  await p.click('button[role=tab]:has-text("The invoice")');
  await p.waitForSelector('.guide-loading[role=alert]', { timeout: 10000 });
  ok('a picture that does not arrive says so, in words', /could not be loaded/i.test(await p.locator('.guide-loading[role=alert]').innerText()));
  ok('and offers Try again', await p.locator('.guide-loading button:has-text("Try again")').isVisible());
  mode = 'normal';
  await p.click('.guide-loading button:has-text("Try again")');
  await p.waitForSelector('.guide-loading', { state: 'detached', timeout: 10000 });
  ok('Try again brings the picture in', await p.locator('.guide-img').evaluate((i) => i.naturalWidth > 0 && getComputedStyle(i).visibility === 'visible'));
  ok('the other tabs still work afterwards', await (async () => { await p.click('button[role=tab]:has-text("Discount")'); await p.waitForFunction(() => { const i = document.querySelector('.guide-img'); return !document.querySelector('.guide-loading') && i && i.naturalWidth > 0; }, null, { timeout: 10000 }); return true; })());
  ok('the window still closes', await (async () => { await p.click('.modal .btns button:has-text("Close")'); return (await p.locator('.guide-modal').count()) === 0; })());
  ok('no errors in the browser', errors.length === 0, errors.join(' | '));
  await p.context().close();
}
await b.close();
console.log(failed ? `\n${failed} FAILED` : '\nThe guide tells you when a picture is loading.');
process.exit(failed ? 1 : 0);
