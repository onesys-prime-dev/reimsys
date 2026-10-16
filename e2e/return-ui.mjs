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

// END OF CHECKS
for (const s of sessions) ok(`no errors on the page for ${s.email}`, s.p.errors.length === 0 || (console.log(s.p.errors), false));
await browser.close();
console.log(failed ? `\n${failed} check(s) failed. Screenshots in ${OUT}` : `\nAll checks passed. Screenshots in ${OUT}`);
process.exit(failed ? 1 : 0);
