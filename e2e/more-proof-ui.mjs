// An approver is not satisfied with the proof and asks the Med Ref for more. Browser check from both sides.
// Usage: WEB=http://localhost:4000 node e2e/more-proof-ui.mjs <screenshot-dir>
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const WEB = process.env.WEB ?? 'http://localhost:4000';
const out = path.resolve(process.argv[2] ?? 'storage/more-proof');
fs.mkdirSync(out, { recursive: true });
let bad = 0;
const ok = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : x); if (!c) bad++; };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const stamp = Date.now();
const tag = 'More Proof ' + stamp;

const b = await chromium.launch({ channel: 'chrome' });
const errs = [];
async function as(email, size = { width: 1280, height: 860 }) {
  const p = await (await b.newContext({ viewport: size, baseURL: WEB })).newPage();
  p.on('pageerror', (e) => errs.push(String(e))); p.on('console', (m) => m.type() === 'error' && !/40[0-9]/.test(m.text()) && errs.push(m.text()));
  await p.goto('/'); await p.fill('input[type=email]', email); await p.fill('input[type=password]', 'Reimsis#2026'); await p.click('button[type=submit]'); await p.waitForSelector('.shell');
  return p;
}

try {
  /* Ana sends a receipt with a thin photo */
  const ana = await as('ana.reyes@example.com');
  await ana.goto('/receipts/new'); await ana.waitForSelector('form');
  await ana.fill('input[placeholder="Store or provider name"]', tag); await ana.fill('input[placeholder="0.00"]', '2480.75');
  await ana.setInputFiles('input[type=file]', { name: 'receipt.png', mimeType: 'image/png', buffer: Buffer.concat([PNG, Buffer.from('p1' + stamp)]) });
  await ana.click('button:has-text("Submit for checking")'); await ana.waitForSelector('.pill:has-text("Submitted")');
  const url = ana.url();

  /* Liza checks it */
  const liza = await as('liza.santos@example.com');
  await liza.goto(url); await liza.click('button:has-text("Open evidence")'); await liza.waitForSelector('.evimg'); await liza.waitForTimeout(1300);
  await liza.click('button:has-text("Mark checked")'); await liza.click('.modal button:has-text("Mark checked")'); await liza.waitForSelector('.pill:has-text("Checked")');

  /* Paolo is not satisfied */
  const paolo = await as('paolo.v@example.com');
  await paolo.goto(url); await paolo.waitForSelector('button:has-text("Ask for more proof")');
  ok('the approver has an "Ask for more proof" button next to the decisions', (await paolo.locator('button:has-text("Disapprove")').count()) === 1);
  await paolo.screenshot({ path: path.join(out, '1-approver.png') });
  await paolo.click('button:has-text("Ask for more proof")'); await paolo.waitForSelector('.modal');
  ok('a note is required, so the Med Ref knows what is missing', await paolo.locator('.modal button:has-text("Ask for more proof")').isDisabled());
  await paolo.screenshot({ path: path.join(out, '2-dialog.png') });
  await paolo.fill('.modal textarea', 'Please add the doctor prescription that goes with this purchase.');
  await paolo.click('.modal button:has-text("Ask for more proof")');
  await paolo.waitForURL(/\/receipts$/);
  ok('the approver lands on the list, not on a "not found" page', (await paolo.locator('text=Receipt not found').count()) === 0);
  await paolo.waitForSelector('.toast:has-text("Sent back")');
  ok('and is told it was sent back', true);

  /* Ana sees why, adds the proof, and resubmits */
  await ana.goto(url);
  await ana.waitForSelector('.callout:has-text("prescription")');
  ok('the Med Ref sees the approver\'s request, in plain words, at the top', /Returned for correction/.test(await ana.locator('.callout').first().innerText()));
  await ana.screenshot({ path: path.join(out, '3-medref.png') });
  await ana.click('a:has-text("Edit")'); await ana.waitForSelector('form');
  await ana.setInputFiles('input[type=file]', { name: 'prescription.png', mimeType: 'image/png', buffer: Buffer.concat([PNG, Buffer.from('rx' + stamp)]) });
  await ana.click('button:has-text("Resubmit for checking")'); await ana.waitForSelector('.pill:has-text("Submitted")');
  ok('the Med Ref adds the prescription and sends it again', (await ana.locator('.evtab').count()) === 2);

  /* it needs checking again from the start */
  await liza.goto(url); await liza.waitForSelector('button:has-text("Mark checked")');
  ok('the checker has to open the evidence again before checking', await liza.locator('button:has-text("Mark checked")').isDisabled());
  const list = await as('paolo.v@example.com');
  await list.goto('/receipts'); await list.fill('input[aria-label="Search receipts"]', String(stamp)); await list.waitForTimeout(1200);
  ok('the approver does not see it again until it has been checked', (await list.locator('a.row').count()) === 0);

  /* phone */
  const ph = await as('paolo.v@example.com', { width: 390, height: 800 });
  ok('no sideways scrolling for the approver on a phone', (await ph.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1);
  ok('no browser errors', errs.length === 0, JSON.stringify(errs));
} finally {
  await b.close();
  execFileSync('C:/xampp/mysql/bin/mysql.exe', ['-u', 'root', 'reimsis', '-e', `DELETE FROM Receipt WHERE payee='${tag}'`]);
}
console.log(bad ? `\n${bad} FAILED` : '\nAll more-proof checks passed');
process.exit(bad ? 1 : 0);
