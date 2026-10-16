// Drives sending a receipt back with ticked problems and the Med Ref's Fix shortcuts, in Chrome.
// Needs the API (4000) and web app (5173), and the seed applied. Usage: node e2e/return-ui.mjs [screenshot-dir]
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { B, H, call, loginAll, makeDraft } from './payment-helpers.mjs';

const OUT = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'reimsys-return-shots'));
fs.mkdirSync(OUT, { recursive: true });
const U = await loginAll();
const submitted = async (name) => {
  const r = await makeDraft(U, 'ana', name, 275);
  return (await call(U.ana, 'POST', `/receipts/${r.id}/submit`, { version: r.version })).d.receipt;
};
const r1 = await submitted('Return UI one');
const r2 = await submitted('Return UI two');

const browser = await chromium.launch({ channel: 'chrome' });
let failed = 0;
const ok = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : x); if (!c) failed++; };
const sessions = [];
async function open(email, size = { width: 1280, height: 860 }) {
  const ctx = await browser.newContext({ viewport: size, baseURL: process.env.WEB ?? 'http://localhost:5173' });
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  p.on('console', (m) => m.type() === 'error' && !/40[0-9]/.test(m.text()) && p.errors.push(m.text()));
  await p.goto('/'); await p.fill('input[type=email]', email); await p.fill('input[type=password]', 'Reimsys#2026'); await p.click('button[type=submit]');
  await p.waitForSelector('.shell');
  sessions.push({ email, p });
  return p;
}
const shot = (p, n) => p.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true });

console.log('The Checker sends it back');
const liza = await open('liza.santos@example.com');
await liza.goto(`/receipts/${r1.id}`);
await liza.waitForSelector('.dh');
await liza.click('button:has-text("Open evidence")');
await liza.waitForFunction(() => [...document.querySelectorAll('.tl li')].some((l) => l.textContent.includes('viewed evidence')));
await liza.click('.actionbar button:has-text("Return")');
const dlg = liza.locator('.modal');
await dlg.waitFor();
const send = dlg.locator('button:has-text("Return record")');
ok('the Return window offers the problems as buttons', (await dlg.locator('.issue').count()) === 9 && await dlg.getByRole('button', { name: 'Photo is blurry, cut off or hard to read' }).isVisible());
ok('it cannot be sent with nothing picked and nothing written', await send.isDisabled());
await dlg.getByRole('button', { name: 'Photo is blurry, cut off or hard to read' }).click();
ok('picking a problem turns it on and lets it be sent without typing', (await dlg.getByRole('button', { name: 'Photo is blurry, cut off or hard to read' }).getAttribute('aria-pressed')) === 'true' && await send.isEnabled());
await dlg.getByRole('button', { name: 'Photo is blurry, cut off or hard to read' }).click();
ok('picking it again turns it off', await send.isDisabled());
await dlg.getByRole('button', { name: 'Something else (write it below)' }).click();
ok('"Something else" needs words', await send.isDisabled());
await dlg.locator('textarea').fill('The vendor is not on the list.');
ok('and then it can be sent', await send.isEnabled());
await dlg.getByRole('button', { name: 'Something else (write it below)' }).click();
await dlg.locator('textarea').fill('');
await dlg.getByRole('button', { name: 'Photo is blurry, cut off or hard to read' }).click();
await dlg.getByRole('button', { name: 'Amount does not match the receipt' }).click();
await dlg.locator('textarea').fill('The total on the photo is 275.00.');
await shot(liza, 'return-1-dialog');
const modalBox = await dlg.boundingBox(), sendBox = await send.boundingBox();
ok('on a normal laptop screen the whole Return window fits without scrolling', await dlg.evaluate((el) => el.scrollHeight <= el.clientHeight + 1), 'it needs scrolling');
ok('the Cancel and Return buttons stay in view inside the window, however many problems it lists', !!modalBox && !!sendBox && sendBox.y >= modalBox.y && sendBox.y + sendBox.height <= modalBox.y + modalBox.height + 1, JSON.stringify([modalBox, sendBox]));
await send.click();
await liza.waitForSelector('.toast');
ok('it is sent with two problems and a note', /returned/i.test(await liza.locator('.toast').last().innerText()));

console.log('The Med Ref fixes it');
const ana = await open('ana.reyes@example.com');
await ana.goto(`/receipts/${r1.id}`);
await ana.waitForSelector('.callout.warn');
const banner = ana.locator('.callout.warn', { hasText: 'Returned for correction' });
ok('the Med Ref sees each problem on its own row, and the note', (await banner.locator('.fixrow').count()) === 2 && (await banner.innerText()).includes('The total on the photo is 275.00.'));
ok('each problem has a Fix button', (await banner.locator('.fixrow a:has-text("Fix")').count()) === 2 && await banner.locator('a:has-text("Start fixing")').isVisible());
const noteBox = await banner.locator('span', { hasText: 'The total on the photo is 275.00.' }).last().boundingBox();
const startBox = await banner.locator('a:has-text("Start fixing")').boundingBox();
ok('"Start fixing" sits on its own line below the note', !!noteBox && !!startBox && startBox.y >= noteBox.y + noteBox.height - 1, JSON.stringify([noteBox, startBox]));
await shot(ana, 'return-2-banner');
await banner.locator('.fixrow', { hasText: 'Photo is blurry' }).locator('a:has-text("Fix")').click();
await ana.waitForSelector('.steph');
ok('Fix for a photo problem opens the form on the proof step', (await ana.locator('.steph').innerText()) === 'Proof and review' && ana.url().includes('?step=evidence'));
const formSpans = ana.locator('.callout.warn div span');
const s1 = await formSpans.nth(0).boundingBox(), s2 = await formSpans.nth(1).boundingBox();
ok('in the form the problems and the note are on separate lines', !!s1 && !!s2 && s2.y >= s1.y + s1.height - 1, JSON.stringify([s1, s2]));
ok('the form reminds them what was wrong', (await ana.locator('.callout.warn').innerText()).includes('Photo is blurry') && (await ana.locator('.callout.warn').innerText()).includes('The total on the photo is 275.00.'));
await ana.goBack();
await ana.waitForSelector('.callout.warn');
await ana.locator('.callout.warn .fixrow', { hasText: 'Amount does not match' }).locator('a:has-text("Fix")').click();
await ana.waitForSelector('.steph');
ok('Fix for an amount problem opens the invoice details step', (await ana.locator('.steph').innerText()) === 'Invoice details');
await ana.goto(`/receipts/${r1.id}`);
await ana.locator('a:has-text("Start fixing")').click();
await ana.waitForSelector('.steph');
ok('"Start fixing" opens the first problem', (await ana.locator('.steph').innerText()) === 'Proof and review');

console.log('Steps that do not exist for this receipt, and bad addresses');
await ana.goto(`/receipts/${r1.id}/edit?step=vat`);
await ana.waitForSelector('.steph');
ok('a VAT problem on a receipt with no BIR invoice lands on the invoice details', (await ana.locator('.steph').innerText()) === 'Invoice details');
await ana.goto(`/receipts/${r1.id}/edit?step=nonsense`);
await ana.waitForSelector('.steph');
ok('an unknown step is ignored and the form starts at the beginning', (await ana.locator('.steph').innerText()) === 'Reimbursement details');
await ana.goto('/receipts/new?step=evidence');
await ana.waitForSelector('.steph');
ok('a step in the address of a NEW receipt is ignored too', (await ana.locator('.steph').innerText()) === 'Reimbursement details');

console.log('Who sees Fix');
const checker = await open('liza.santos@example.com');
await checker.goto(`/receipts/${r1.id}`);
await checker.waitForSelector('.dh');
ok('the Checker sees the problems but no Fix buttons', (await checker.locator('.callout.warn .fixrow').count()) === 2 && (await checker.locator('.callout.warn a:has-text("Fix")').count()) === 0 && (await checker.locator('a:has-text("Start fixing")').count()) === 0);

console.log('Resubmitting');
await ana.goto(`/receipts/${r1.id}`);
await ana.click('.actionbar button:has-text("Resubmit")');
await ana.waitForSelector('.pill:has-text("Submitted")');
ok('after resubmitting the problems are gone', (await ana.locator('.callout.warn:has-text("Returned for correction")').count()) === 0);

console.log('An old return that only has a note');
await fetch(`${B}/receipts/${r2.id}/evidence/${r2.evidence[0].id}/file?mode=view`, { headers: H(U.liza, false) });
await call(U.liza, 'POST', `/receipts/${r2.id}/return`, { version: r2.version, note: 'Please retake the photo.' });
await ana.goto(`/receipts/${r2.id}`);
await ana.waitForSelector('.callout.warn');
const plain = ana.locator('.callout.warn', { hasText: 'Returned for correction' });
ok('a return with only a note shows the note, with no problem rows and no broken Fix', (await plain.innerText()).includes('Please retake the photo.') && (await plain.locator('.fixrow').count()) === 0);
await ana.goto(`/receipts/${r2.id}/edit`);
await ana.waitForSelector('.steph');
ok('and the form callout shows the note', (await ana.locator('.callout.warn').innerText()).includes('Please retake the photo.'));

console.log('Phone screen');
const phone = await open('ana.reyes@example.com', { width: 390, height: 800 });
const r3 = await submitted('Return UI three');
await fetch(`${B}/receipts/${r3.id}/evidence/${r3.evidence[0].id}/file?mode=view`, { headers: H(U.liza, false) });
await call(U.liza, 'POST', `/receipts/${r3.id}/return`, { version: r3.version, issues: ['photo_unclear', 'vat_wrong', 'reason_unclear'], note: 'See the VAT line.' });
await phone.goto(`/receipts/${r3.id}`);
await phone.waitForSelector('.callout.warn .fixrow');
ok('on a phone nothing scrolls sideways and every Fix is reachable', (await phone.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1 && (await phone.locator('.callout.warn .fixrow a:has-text("Fix")').count()) === 3);
await shot(phone, 'return-3-phone');

// END OF CHECKS
for (const s of sessions) ok(`no errors on the page for ${s.email}`, s.p.errors.length === 0 || (console.log(s.p.errors), false));
await browser.close();
console.log(failed ? `\n${failed} check(s) failed. Screenshots in ${OUT}` : `\nAll checks passed. Screenshots in ${OUT}`);
process.exit(failed ? 1 : 0);
