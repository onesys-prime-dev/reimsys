// Real-size files and printing, in a browser: a 12-megapixel photo, a multi-page PDF, an oversize file, and the Print buttons.
// Usage: WEB=http://localhost:4000 node e2e/real-files.mjs <screenshot-dir>
import { fillQuickForm, toLastStep } from './form-helpers.mjs';
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
// The reimbursement form's answers for a receipt with no BIR invoice: the shortest valid receipt.
const F = { birInvoice: false, vendorAddress: 'Test Street, Test City', reasonForSpending: 'Test receipt', classification: 'fuel', chargeLocationId: 1, newReimbursementCode: true, detailsReviewed: true };

const WEB = process.env.WEB ?? 'http://localhost:4000';
const out = path.resolve(process.argv[2] ?? 'storage/real-files');
fs.mkdirSync(out, { recursive: true });
let bad = 0;
const ok = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : x); if (!c) bad++; };
const stamp = Date.now();

const b = await chromium.launch({ channel: 'chrome' });
const errs = [];
async function as(email, size = { width: 1280, height: 860 }) {
  const ctx = await b.newContext({ viewport: size, baseURL: WEB });
  // Count calls to window.print in every frame, including the hidden one the app opens for printing.
  await ctx.addInitScript(() => { window.print = () => { window.top.__prints = (window.top.__prints || []).concat(location.pathname + location.search); }; });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('console', (m) => m.type() === 'error' && !/40[0-9]|413/.test(m.text()) && errs.push(m.text()));
  await p.goto('/'); await p.fill('input[type=email]', email); await p.fill('input[type=password]', 'Reimsys#2026'); await p.click('button[type=submit]'); await p.waitForSelector('.shell');
  return p;
}

/* ---- make real files: a 4000x3000 noisy photo (like a phone camera) and a 3-page PDF ---- */
const scratch = await b.newPage();
const photoB64 = await scratch.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 4000; c.height = 3000;
  const g = c.getContext('2d');
  g.fillStyle = '#f4efe3'; g.fillRect(0, 0, 4000, 3000);
  for (let i = 0; i < 6000; i++) { g.fillStyle = `hsl(${(i * 37) % 360} 30% ${40 + (i % 40)}%)`; g.fillRect((i * 97) % 4000, (i * 61) % 3000, 20 + (i % 60), 6 + (i % 14)); }
  g.fillStyle = '#111'; g.font = 'bold 140px Arial'; g.fillText('MERCURY DRUG  OFFICIAL RECEIPT', 300, 400); g.fillText('TOTAL  PHP 1,284.50', 300, 700);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.95));
  const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
});
await scratch.close();
const photo = Buffer.from(photoB64, 'base64');
const req = createRequire(path.resolve('apps/api/package.json'));
const PDFDocument = req('pdfkit');
const pdf = await new Promise((resolve) => { const d = new PDFDocument({ size: 'A4' }); const ch = []; d.on('data', (c) => ch.push(c)); d.on('end', () => resolve(Buffer.concat(ch))); for (let i = 1; i <= 3; i++) { if (i > 1) d.addPage(); d.fontSize(26).text(`Prescription page ${i} of 3`, 60, 80); d.fontSize(14).text('Take one tablet twice a day after meals.', 60, 140); } d.end(); });
fs.writeFileSync(path.join(out, 'photo.jpg'), photo); fs.writeFileSync(path.join(out, 'prescription.pdf'), pdf);
console.log(`  photo ${(photo.length / 1048576).toFixed(1)} MB (4000x3000), pdf ${(pdf.length / 1024).toFixed(0)} KB`);
ok('the test photo is a realistic size (over 1 MB, under the 10 MB limit)', photo.length > 1 * 1048576 && photo.length < 10 * 1048576);

/* ---- Ana uploads both and submits ---- */
const ana = await as('ana.reyes@example.com');
await ana.goto('/receipts/new'); await ana.waitForSelector('form');
await fillQuickForm(ana, { payee: 'Real Files ' + stamp, amount: '1284.50' });
await ana.setInputFiles('input[type=file]', [{ name: 'IMG_2041.jpg', mimeType: 'image/jpeg', buffer: photo }, { name: 'prescription.pdf', mimeType: 'application/pdf', buffer: pdf }]);
await ana.waitForSelector('text=IMG_2041.jpg');
ok('both files are listed before sending', (await ana.locator('.file').count()) === 2);
await ana.click('button:has-text("Submit for checking")'); await ana.waitForSelector('.pill:has-text("Submitted")'); await ana.waitForTimeout(1000);
const url = ana.url();
ok('the big photo and the PDF were both accepted', (await ana.locator('.evtab').count()) === 2);

/* ---- the owner can see the photo straight away ---- */
await ana.waitForSelector('.evimg');
ok('the owner sees the full-size photo', (await ana.$eval('.evimg', (i) => i.naturalWidth)) === 4000);

/* ---- Liza opens both, zooms, and the page copes ---- */
const liza = await as('liza.santos@example.com');
await liza.goto(url); await liza.click('button:has-text("Open evidence")'); await liza.waitForSelector('.evimg');
await liza.waitForFunction(() => { const i = document.querySelector('.evimg'); return i && i.complete && i.naturalWidth > 0; });
ok('the checker sees the photo at full resolution', (await liza.$eval('.evimg', (i) => i.naturalWidth)) === 4000);
const box1 = await liza.locator('.evimg').boundingBox();
ok('it is scaled to fit the panel instead of overflowing', box1.width < 760);
await liza.click('button[aria-label="Zoom in"]'); await liza.click('button[aria-label="Zoom in"]');
const box2 = await liza.locator('.evimg').boundingBox();
ok('zoom makes it larger', box2.width > box1.width * 1.3);
const reach = await liza.evaluate(() => {
  const st = document.querySelector('.stage'), im = document.querySelector('.evimg');
  st.scrollLeft = 0; st.scrollTop = 0;
  const s = st.getBoundingClientRect(), i = im.getBoundingClientRect();
  const topLeftReachable = i.left >= s.left - 1 && i.top >= s.top - 1;
  st.scrollLeft = st.scrollWidth; st.scrollTop = st.scrollHeight;
  const i2 = im.getBoundingClientRect();
  return { topLeftReachable, bottomRightReachable: i2.right <= s.right + 1 || i2.right - s.right <= 1, canScroll: st.scrollWidth > st.clientWidth };
});
ok('when zoomed, the top-left corner of the receipt can be scrolled to', reach.topLeftReachable, JSON.stringify(reach));
ok('and the bottom-right corner too', reach.bottomRightReachable && reach.canScroll, JSON.stringify(reach));
await liza.screenshot({ path: path.join(out, 'photo-viewer.png') });
await liza.click('.evtab:has-text("prescription.pdf")'); await liza.waitForSelector('iframe');
const pdfUrl = await liza.$eval('iframe', (f) => f.src);
const pdfRes = await liza.evaluate(async (u) => { const r = await fetch(u); const t = new Uint8Array(await r.arrayBuffer()); return { type: r.headers.get('content-type'), disp: r.headers.get('content-disposition'), head: String.fromCharCode(...t.slice(0, 5)), n: t.length }; }, pdfUrl);
ok('the PDF is served as a real PDF to show inside the page', pdfRes.type === 'application/pdf' && pdfRes.head === '%PDF-' && /^inline/.test(pdfRes.disp), JSON.stringify(pdfRes));
await liza.screenshot({ path: path.join(out, 'pdf-viewer.png') });

/* ---- Print on evidence ---- */
await liza.click('.evtab:has-text("IMG_2041.jpg")'); await liza.waitForSelector('.evimg');
await liza.click('button:has-text("Print")');
const printed = await liza.waitForFunction(() => (window.__prints || []).length > 0, null, { timeout: 15000 }).then(() => true, () => false);
ok('Print opens the browser print dialog for the evidence', printed, JSON.stringify(await liza.evaluate(() => window.__prints)));
const calls = await liza.evaluate(() => window.__prints);
ok('and what it prints is the evidence file in print mode', calls.some((c) => /evidence\/\d+\/file\?mode=print/.test(c)), JSON.stringify(calls));

/* ---- finish the approval, then Print the reimbursement document ---- */
await liza.click('button:has-text("Mark checked")'); await liza.waitForSelector('.modal'); await liza.click('.modal button:has-text("Mark checked")'); await liza.waitForSelector('.pill:has-text("Checked")');
const paolo = await as('paolo.v@example.com');
await paolo.goto(url); await paolo.click('button:has-text("Open evidence")'); await paolo.waitForSelector('.evimg'); await paolo.waitForTimeout(1300);
await paolo.click('button:text-is("Approve")'); await paolo.click('.modal button:text-is("Approve")'); await paolo.waitForSelector('.pill:has-text("Approved")');
await ana.goto(url); await ana.waitForSelector('a:has-text("Download")', { timeout: 20000 });
await ana.click('.card:has-text("Reimbursement document") button:has-text("Print")');
const docPrinted = await ana.waitForFunction(() => (window.__prints || []).some((c) => /documents\/\d+\/file\?mode=print/.test(c)), null, { timeout: 15000 }).then(() => true, () => false);
ok('Print on the reimbursement document opens the print dialog', docPrinted, JSON.stringify(await ana.evaluate(() => window.__prints)));

/* ---- a file that is too big ---- */
await ana.goto('/receipts/new'); await ana.waitForSelector('form');
await fillQuickForm(ana, { payee: 'Too Big ' + stamp });
await ana.setInputFiles('input[type=file]', [{ name: 'huge.jpg', mimeType: 'image/jpeg', buffer: Buffer.concat([photo, Buffer.alloc(11 * 1048576, 1)]) }]);
await ana.waitForSelector('.toast');
ok('an over-10-MB file is refused in the form with a clear message', /10 MB/.test(await ana.locator('.toast').first().innerText()) && (await ana.locator('.file').count()) === 0);
const cookies = await ana.context().cookies();
const cookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
const big = new FormData(); big.append('files', new Blob([Buffer.concat([photo, Buffer.alloc(11 * 1048576, 1)])], { type: 'image/jpeg' }), 'huge.jpg');
const me = await (await fetch(WEB + '/api/receipts?pageSize=1', { headers: { cookie, 'x-requested-with': 'reimsys' } })).json();
const draft = await (await fetch(WEB + '/api/receipts', { method: 'POST', headers: { cookie, 'x-requested-with': 'reimsys', origin: WEB, 'content-type': 'application/json' }, body: JSON.stringify({ payee: 'Too Big ' + stamp, receiptDate: '2026-10-11', amount: 5, ...F }) })).json();
const rBig = await fetch(`${WEB}/api/receipts/${draft.receipt.id}/evidence`, { method: 'POST', headers: { cookie, 'x-requested-with': 'reimsys', origin: WEB }, body: big });
const jBig = await rBig.json().catch(() => null);
ok('the server refuses it too, with a plain message instead of a crash', rBig.status >= 400 && rBig.status < 500 && !!jBig?.error?.message, `${rBig.status} ${JSON.stringify(jBig)}`);
void me;

/* ---- phone ---- */
const ph = await as('liza.santos@example.com', { width: 390, height: 800 });
await ph.goto(url); await ph.click('button:has-text("Open evidence")'); await ph.waitForSelector('.evimg');
ok('no sideways scrolling on a phone with the big photo open', (await ph.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1);
await ph.screenshot({ path: path.join(out, 'photo-phone.png') });

ok('no browser errors', errs.length === 0, JSON.stringify(errs));
await b.close();
sql_cleanup();
console.log(bad ? `\n${bad} FAILED` : '\nAll real-file checks passed');
process.exit(bad ? 1 : 0);

function sql_cleanup() {
  // remove only what this run created
  execFileSync('C:/xampp/mysql/bin/mysql.exe', ['-u', 'root', 'reimsys', '-e', `DELETE FROM receipt WHERE payee IN ('Real Files ${stamp}','Too Big ${stamp}')`]);
}
