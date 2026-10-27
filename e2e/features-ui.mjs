// Browser check of: comments, bulk check/approve from the list, taking a decision back.
// Usage: WEB=http://localhost:4000 node e2e/features-ui.mjs <screenshot-dir>
import { chromium } from 'playwright';
import fs from 'node:fs';
// The reimbursement form's answers for a receipt with no BIR invoice: the shortest valid receipt.
const F = { birInvoice: false, vendorAddress: 'Test Street, Test City', reasonForSpending: 'Test receipt', classification: 'fuel', chargeLocationId: 1, detailsReviewed: true };
const WEB = process.env.WEB ?? 'http://localhost:4000';
const out = process.argv[2] ?? '.';
fs.mkdirSync(out, { recursive: true });
let bad = 0;
const ok = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : x); if (!c) bad++; };

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const H = (c) => ({ cookie: c, 'x-requested-with': 'reimsys', origin: WEB, 'content-type': 'application/json' });
const login = async (e) => (await fetch(WEB + '/api/auth/login', { method: 'POST', headers: H(''), body: JSON.stringify({ email: e, password: 'Reimsys#2026' }) })).headers.get('set-cookie').split(';')[0];
async function seed(tag) {
  const c = await login('ana.reyes@example.com');
  const cat = (await (await fetch(WEB + '/api/categories', { headers: H(c) })).json()).categories[0].id;
  let r = (await (await fetch(WEB + '/api/receipts', { method: 'POST', headers: H(c), body: JSON.stringify({ payee: tag, receiptDate: '2026-10-11', amount: 321.5, ...F }) })).json()).receipt;
  const f = new FormData(); f.append('files', new Blob([Buffer.concat([PNG, Buffer.from(tag + Math.random())])], { type: 'image/png' }), 'r.png');
  r = (await (await fetch(`${WEB}/api/receipts/${r.id}/evidence`, { method: 'POST', headers: { cookie: c, 'x-requested-with': 'reimsys', origin: WEB }, body: f })).json()).receipt;
  await fetch(`${WEB}/api/receipts/${r.id}/submit`, { method: 'POST', headers: H(c), body: JSON.stringify({ version: r.version }) });
  return r.id;
}

const stamp = Date.now();
const idA = await seed('Feature A ' + stamp), idB = await seed('Feature B ' + stamp), idC = await seed('Feature C ' + stamp);

const b = await chromium.launch({ channel: 'chrome' });
async function as(email, size = { width: 1280, height: 860 }) {
  const ctx = await b.newContext({ viewport: size, baseURL: WEB });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(String(e))); p.on('console', (m) => m.type() === 'error' && !/401/.test(m.text()) && errs.push(m.text()));
  await p.goto('/'); await p.fill('input[type=email]', email); await p.fill('input[type=password]', 'Reimsys#2026'); await p.click('button[type=submit]'); await p.waitForSelector('.shell');
  return { p, errs };
}
const allErrs = [];

/* ---- Liza: open evidence on A and B, then check both from the list in one go ---- */
const liza = await as('liza.santos@example.com'); allErrs.push(liza.errs);
for (const id of [idA, idB]) { await liza.p.goto(`/receipts/${id}`); await liza.p.click('button:has-text("Open evidence")'); await liza.p.waitForSelector('.evimg'); await liza.p.waitForTimeout(1200); }
await liza.p.goto('/receipts'); await liza.p.waitForSelector('a.row');
await liza.p.fill('input[aria-label="Search receipts"]', String(stamp)); await liza.p.waitForTimeout(1200);
ok('three ready receipts show tick boxes', (await liza.p.locator('a.row input[type=checkbox]').count()) === 3);
ok('a "select all" row is offered', (await liza.p.locator('text=Select all 3').count()) === 1);
await liza.p.locator(`a.row:has-text("Feature A ${stamp}") input`).check();
await liza.p.locator(`a.row:has-text("Feature B ${stamp}") input`).check();
await liza.p.locator(`a.row:has-text("Feature C ${stamp}") input`).check();
await liza.p.waitForSelector('text=3 selected');
ok('ticking a box did not open the receipt', liza.p.url().endsWith('/receipts'));
await liza.p.screenshot({ path: `${out}/bulk-select.png` });
await liza.p.click('button:has-text("Mark 3 checked")'); await liza.p.waitForSelector('.modal');
await liza.p.click('.modal button:text-is("Mark checked")');
await liza.p.waitForSelector('text=2 of 3 done');
ok('the receipt whose evidence was not opened is skipped and explained', (await liza.p.locator(`.modal:has-text("Feature C ${stamp}")`).count()) === 0 && (await liza.p.locator('.modal:has-text("evidence")').count()) === 1);
await liza.p.screenshot({ path: `${out}/bulk-result.png` });
await liza.p.click('.modal button:has-text("Close")');

/* ---- Liza comments on A ---- */
await liza.p.goto(`/receipts/${idA}`); await liza.p.waitForSelector('textarea[aria-label="Write a comment"]');
await liza.p.fill('textarea[aria-label="Write a comment"]', 'Is the amount the full total?');
await liza.p.click('button:text-is("Post")'); await liza.p.waitForSelector('.cmt:has-text("Is the amount the full total?")');
ok('the comment appears straight away', true);
ok('Post is disabled when the box is empty', await liza.p.locator('button:text-is("Post")').isDisabled());

/* ---- Ana sees the notice and answers ---- */
const ana = await as('ana.reyes@example.com'); allErrs.push(ana.errs);
await ana.p.goto('/'); await ana.p.click('button[aria-label^="Notifications"]'); await ana.p.waitForSelector('text=commented on');
ok('the Med Ref gets a bell notice about the comment', true);
await ana.p.screenshot({ path: `${out}/comment-notice.png` });
await ana.p.keyboard.press('Escape');
await ana.p.goto(`/receipts/${idA}`); await ana.p.waitForSelector('.cmt:has-text("Is the amount the full total?")');
await ana.p.fill('textarea[aria-label="Write a comment"]', 'Yes, it is the full total.'); await ana.p.click('button:text-is("Post")'); await ana.p.waitForSelector('.cmt:has-text("Yes, it is the full total.")');
await ana.p.screenshot({ path: `${out}/comments.png`, fullPage: true });

/* ---- Paolo: bulk approve from the list ---- */
const paolo = await as('paolo.v@example.com'); allErrs.push(paolo.errs);
await paolo.p.goto(`/receipts/${idA}`); await paolo.p.click('button:has-text("Open evidence")'); await paolo.p.waitForSelector('.evimg'); await paolo.p.waitForTimeout(1200);
await paolo.p.goto('/receipts'); await paolo.p.fill('input[aria-label="Search receipts"]', String(stamp)); await paolo.p.waitForTimeout(1200);
await paolo.p.locator(`a.row:has-text("Feature A ${stamp}") input`).check();
await paolo.p.locator(`a.row:has-text("Feature B ${stamp}") input`).check();
await paolo.p.click('button:has-text("Approve 2")'); await paolo.p.waitForSelector('.modal');
await paolo.p.click('.modal button:text-is("Approve")');
await paolo.p.waitForSelector('text=1 of 2 done');
ok('bulk approve does the one he opened and skips the other', true);
await paolo.p.click('.modal button:has-text("Close")');

/* ---- Paolo takes the approval back ---- */
await paolo.p.goto(`/receipts/${idA}`); await paolo.p.waitForSelector('button:has-text("Take back decision")');
ok('the Take back button is there after approving', true);
await paolo.p.screenshot({ path: `${out}/undo-button.png` });
await paolo.p.click('button:has-text("Take back decision")'); await paolo.p.waitForSelector('.modal');
ok('a reason is required before taking it back', await paolo.p.locator('.modal button:has-text("Take back decision")').isDisabled());
await paolo.p.screenshot({ path: `${out}/undo-dialog.png` });
await paolo.p.fill('.modal textarea', 'Approved the wrong receipt.');
await paolo.p.click('.modal button:has-text("Take back decision")');
await paolo.p.waitForSelector('.pill:has-text("Checked")');
ok('the receipt is back to Checked', true);
ok('the reimbursement document is gone', (await paolo.p.locator('text=Reimbursement document').count()) === 0);
ok('and it can be approved again', (await paolo.p.locator('button:text-is("Approve")').count()) === 1);

/* ---- phone layout ---- */
const ph = await as('liza.santos@example.com', { width: 390, height: 800 }); allErrs.push(ph.errs);
await ph.p.goto('/receipts'); await ph.p.waitForSelector('a.row');
await ph.p.fill('input[aria-label="Search receipts"]', String(stamp)); await ph.p.waitForTimeout(1200);
const boxes = ph.p.locator('a.row input[type=checkbox]');
if (await boxes.count()) { await boxes.first().check(); await ph.p.waitForSelector('text=1 selected'); }
await ph.p.screenshot({ path: `${out}/bulk-phone.png` });
ok('no sideways scrolling on the phone list', (await ph.p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1);
const bar = await ph.p.locator('[aria-label="Selected receipts"]').boundingBox();
const nav = await ph.p.locator('.bnav').boundingBox();
ok('the selection bar is not hidden behind the bottom menu', !bar || !nav || bar.y + bar.height <= nav.y + 1, JSON.stringify({ bar, nav }));
await ph.p.goto(`/receipts/${idB}`); await ph.p.waitForSelector('textarea[aria-label="Write a comment"]');
ok('no sideways scrolling on the phone receipt page', (await ph.p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1);
await ph.p.screenshot({ path: `${out}/comments-phone.png`, fullPage: true });

ok('no browser errors', allErrs.flat().length === 0, JSON.stringify(allErrs.flat()));
await b.close();
console.log(bad ? `\n${bad} FAILED` : '\nAll feature checks passed');
process.exit(bad ? 1 : 0);
