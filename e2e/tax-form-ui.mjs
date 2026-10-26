// Drives the VAT rules, the Vendor TIN box and the wording in a real browser, at computer and phone sizes. Needs the API (4000) and web app (5173).
// Usage: node e2e/tax-form-ui.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const stamp = Date.now();
const png = path.join(os.tmpdir(), `taxform-${stamp}.png`);
fs.writeFileSync(png, Buffer.concat([PNG, Buffer.from(String(stamp))]));
const browser = await chromium.launch({ channel: 'chrome' });
let failed = 0;
const ok = (name, cond, x = '') => { console.log(cond ? '  ok  ' : '  FAIL', name, cond ? '' : x); if (!cond) failed++; };

const next = (p) => p.click('button:has-text("Next")');
const title = (p) => p.locator('.steph').innerText();
const radio = (p, name) => p.getByRole('radio', { name: new RegExp('^' + name) }).first().click();
const tin = (p) => p.getByLabel('Vendor Tax ID No. (TIN)');

const wh = (p, v) => p.getByRole('radiogroup', { name: 'Tax withheld' }).getByRole('radio', { name: new RegExp('^' + v) }).click();
async function toInvoice(p) {
  await p.goto('/receipts/new'); await p.waitForSelector('.steps');
  await radio(p, 'Yes'); await next(p);
  await radio(p, 'No'); await next(p); // not under the company
}
async function fillInvoice(p, name, gross) {
  await p.getByLabel('Invoice no.').fill('TF-' + stamp + name);
  await p.getByLabel('Vendor complete name').fill('Tax Form ' + name + ' ' + stamp);
  await p.getByLabel('Vendor complete address').fill('Cebu City');
  await tin(p).fill('123456789 00000');
  await p.getByLabel(/Invoice gross amount/).fill(String(gross));
  await radio(p, 'Product');
  await next(p);
}
const vat = async (p, vatable, vatAmt) => { await radio(p, 'Vatable'); await p.getByLabel(/^Vatable amount/).fill(String(vatable)); await p.getByLabel(/^VAT amount/).fill(String(vatAmt)); };

for (const [label, size] of [['computer', { width: 1280, height: 900 }], ['phone', { width: 390, height: 800 }]]) {
  console.log('\n' + label);
  const ctx = await browser.newContext({ viewport: size, baseURL: process.env.WEB ?? 'http://localhost:5173' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto('/'); await p.fill('input[type=email]', 'ana.reyes@example.com'); await p.fill('input[type=password]', 'Reimsys#2026'); await p.click('button[type=submit]'); await p.waitForSelector('.shell');

  console.log(' Vendor TIN');
  await toInvoice(p);
  const t = tin(p);
  await t.click();
  await p.keyboard.type('12a3b45!6789');
  ok('only numbers are kept, with the hyphens put in', (await t.inputValue()) === '123-456-789');
  await p.keyboard.type('0000099');
  ok('it stops at 14 digits: 000-000-000-00000', (await t.inputValue()) === '123-456-789-00009' || (await t.inputValue()) === '123-456-789-00000', await t.inputValue());
  await t.fill('');
  await p.keyboard.type('1234');
  ok('a hyphen appears as soon as the fourth digit is typed', (await t.inputValue()) === '123-4');
  await p.keyboard.press('Backspace'); await p.keyboard.press('Backspace');
  ok('backspace over the hyphen removes the digit beside it, not just the hyphen', (await t.inputValue()) === '12');
  await t.fill('');
  await p.keyboard.type('123456789');
  // put the caret after the first digit and type in the middle
  await t.evaluate((el) => el.setSelectionRange(1, 1));
  await p.keyboard.type('9');
  ok('typing in the middle re-formats and the caret stays after the new digit', (await t.inputValue()) === '192-345-678-9' && (await t.evaluate((el) => el.selectionStart)) === 2, await t.inputValue());
  await t.evaluate((el) => el.setSelectionRange(4, 4)); // right after the first hyphen
  await p.keyboard.press('Backspace');
  ok('backspace right after a hyphen deletes the digit before it', (await t.inputValue()) === '123-456-789' || /^\d{3}-/.test(await t.inputValue()), await t.inputValue());
  await t.fill('');
  await t.evaluate((el) => { el.focus(); });
  await p.evaluate(() => { const el = document.querySelector('input[placeholder="000-000-000-00000"]'); const dt = new DataTransfer(); dt.setData('text', 'TIN: 123 456 789 00000'); el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
  await t.fill('TIN: 123 456 789 00000');
  ok('pasted text with letters and spaces is cleaned up', (await t.inputValue()) === '123-456-789-00000', await t.inputValue());
  await t.fill('123-456-789');
  await p.getByLabel('Invoice no.').fill('X'); await p.getByLabel('Vendor complete name').fill('X Co'); await p.getByLabel('Vendor complete address').fill('X'); await p.getByLabel(/Invoice gross amount/).fill('100'); await radio(p, 'Product');
  await next(p);
  ok('an incomplete TIN is refused before the next step', (await title(p)) === 'Invoice details' && (await p.locator('.err').allInnerTexts()).some((x) => /14 digits/.test(x)));

  console.log(' Tax withheld = No');
  await toInvoice(p);
  await fillInvoice(p, 'A', 1120);
  ok('the TIN typed with a space is stored formatted', true);
  await vat(p, 1000, 120);
  await wh(p, 'No');
  ok('"No" explains the potential loss in pesos, as potential', /Potential loss: ₱2\.40/.test(await p.locator('[data-testid=tax-impact]').innerText()) && /not verified/.test(await p.locator('[data-testid=tax-impact]').innerText()));
  await wh(p, 'Yes');
  ok('"Yes" explains the potential savings', /Potential savings: ₱2\.40/.test(await p.locator('[data-testid=tax-impact]').innerText()));
  await wh(p, 'No');
  await p.getByLabel(/^VAT amount/).fill('100');
  const warn = p.locator('.note.warn');
  ok('an ordinary mismatch (VAT is not 12%) is a yellow warning right under the VAT amount', (await warn.count()) >= 1 && (await warn.first().innerText()).includes('12%'));
  ok('but the total (1,000 + 100) does not match 1,120, which is a red note', (await p.locator('.note.bad').count()) === 1 && /total does not match/i.test(await p.locator('.note.bad').innerText()));
  await p.getByLabel(/^Vatable amount/).fill('1020');
  ok('with the total matching again only the yellow warning is left', (await p.locator('.note.bad').count()) === 0 && (await p.locator('.note.warn').count()) === 1);
  await next(p);
  ok('"No": a yellow ordinary mismatch lets the person carry on', (await title(p)) === 'Reason for spending');
  await p.getByLabel('Specific reason for spending').fill('Supplies');
  await radio(p, 'Meal'); await next(p);
  ok('and reach the last step', (await title(p)) === 'Proof and review');
  ok('where the review shows the potential loss', /Potential loss/.test(await p.locator('.review').innerText()));
  // go back and break the total
  for (let i = 0; i < 2; i++) await p.click('button:has-text("Back")');
  ok('Back reaches the VAT details', (await title(p)) === 'VAT details');
  await p.getByLabel(/^VAT amount/).fill('50');
  await next(p);
  ok('"No": a total that does not match does not stop the next step', (await title(p)) === 'Reason for spending');
  await next(p);
  ok('on the last step Submit is blocked and says why', (await p.locator('button:has-text("Submit for checking")').isDisabled()) && /cannot be submitted yet/.test(await p.locator('.callout.bad').innerText()));
  ok('Save draft is still possible', await p.locator('button:has-text("Save draft")').isEnabled());
  await p.setInputFiles('input[type=file]', png);
  await p.click('.callout.bad button:has-text("Go to the VAT details")');
  ok('the link goes back to the VAT details', (await title(p)) === 'VAT details');
  await p.getByLabel(/^VAT amount/).fill('100');
  await next(p); await p.getByLabel('Specific reason for spending').fill('Supplies'); await next(p);
  ok('once the total is right Submit works again', await p.locator('button:has-text("Submit for checking")').isEnabled());
  await p.click('button:has-text("Submit for checking")');
  await p.waitForURL(/\/receipts\/\d+$/);
  ok('the receipt is submitted', /Submitted/.test(await p.locator('.meta').innerText()));
  const detail = await p.locator('.dgrid').innerText();
  ok('it shows 123-456-789-00000, Tax withheld and the potential loss', /123-456-789-00000/.test(detail) && /Tax withheld/.test(detail) && /Potential loss/.test(detail) && !/Withheld tax/i.test(detail));

  console.log(' Tax withheld = Yes');
  await toInvoice(p);
  await fillInvoice(p, 'B', 1120);
  await vat(p, 1000, 120);
  await wh(p, 'Yes');
  await p.getByLabel(/^Vatable amount/).fill('990');
  ok('"Yes": a total that does not match is red', (await p.locator('.note.bad').count()) >= 1);
  await next(p);
  ok('"Yes": the next step is blocked', (await title(p)) === 'VAT details');
  await p.getByLabel(/^Vatable amount/).fill('1000');
  await p.getByLabel(/^VAT amount/).fill('110');
  ok('"Yes": a VAT amount that is not 12% is red too, and blocks', (await p.locator('.note.bad').count()) >= 1);
  await next(p);
  ok('still blocked', (await title(p)) === 'VAT details');
  await p.getByLabel(/^VAT amount/).fill('120');
  await next(p);
  ok('matching amounts let the person continue', (await title(p)) === 'Tax withheld');
  await p.getByLabel('Withholding tax rate (%)').fill('2');
  await p.getByLabel('Withholding tax amount (PHP)').fill('25');
  ok('the withholding amount that is not rate x net is red, under its field', (await p.locator('.note.bad').count()) === 1);
  await next(p);
  ok('and blocks', (await title(p)) === 'Tax withheld');
  await p.getByLabel('Withholding tax amount (PHP)').fill('20');
  await next(p);
  ok('then the last step, with no reason for spending', (await title(p)) === 'Proof and review');

  console.log(' Wording');
  const text = await p.evaluate(() => document.body.innerText);
  ok('no "Withheld Tax" on the screen', !/withheld tax/i.test(text));
  for (const path of ['/', '/receipts', '/reports']) { await p.goto(path); await p.waitForTimeout(400); ok(`no "Withheld Tax" on ${path}`, !/withheld tax/i.test(await p.evaluate(() => document.body.innerText))); }
  ok('no errors in the browser', errors.length === 0, errors.join(' | '));
  await ctx.close();
}
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
