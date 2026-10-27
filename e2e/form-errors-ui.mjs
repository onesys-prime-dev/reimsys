// Every error message on the reimbursement form must sit directly under the field it is about, and be on the screen. Walks each step with empty or wrong
// answers, at computer and phone sizes. Needs the API (4000) and web app (5173). Usage: node e2e/form-errors-ui.mjs
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome' });
let failed = 0;
const ok = (name, cond, x = '') => { console.log(cond ? '  ok  ' : '  FAIL', name, cond ? '' : x); if (!cond) failed++; };
const next = (p) => p.click('button:has-text("Next")');
const radio = (p, name) => p.getByRole('radio', { name: new RegExp('^' + name) }).first().click();
const group = (p, g, v) => p.getByRole('radiogroup', { name: g }).getByRole('radio', { name: new RegExp('^' + v) }).click();

/** Each visible error: it has a field in the same block, it starts right under that field (not above it, not far away), and it is inside the window. */
async function audit(p, where) {
  const rows = await p.evaluate(() => [...document.querySelectorAll('.err, .note.bad, .note.warn')].filter((e) => e.offsetParent !== null).map((e) => {
    const block = e.closest('label.f, .tick, div.full, .fwrap') ?? e.parentElement;
    // a tick box: the field is the whole label (the box and its words), not just the small box
    const tickLabel = block.classList.contains('tick') ? block.querySelector('label') : null;
    const controls = [...block.querySelectorAll('input:not([type=file]), select, textarea, [role=radio], .drop')].filter((c) => c.offsetParent !== null || c.type === 'checkbox');
    const er = e.getBoundingClientRect();
    const last = (tickLabel ? [tickLabel] : controls).map((c) => c.getBoundingClientRect()).sort((a, b) => b.bottom - a.bottom)[0];
    return { text: e.textContent.trim(), hasField: !!last, gap: last ? er.top - last.bottom : null, below: last ? er.top >= last.top : false, label: (block.querySelector('span, .q')?.textContent ?? '').trim().slice(0, 40), star: (() => { const heads = [...block.querySelectorAll('.q, label.f > span:first-child, .tick b, div.full > div:first-child')].filter((h) => h.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING); const h = heads[heads.length - 1] ?? block.querySelector('span'); return (tickLabel ?? h)?.textContent.slice(0, 200).includes('*'); })() };
  }));
  ok(`${where}: shows at least one error`, rows.length > 0);
  for (const r of rows) {
    ok(`${where}: "${r.text}" has its field (${r.label})`, r.hasField);
    // a question the form refuses to leave empty is marked with the red *, as in the Google Form (the "warn" notes are not about an empty answer)
    if (!/^Check this/.test(r.text)) ok(`${where}: "${r.text}" is on a question marked with *`, r.star, r.label);
    ok(`${where}: "${r.text}" is right under it`, r.hasField && r.below && r.gap >= -2 && r.gap < 60, JSON.stringify(r));
  }
  return rows.length;
}

for (const [label, size] of [['computer', { width: 1280, height: 900 }], ['phone', { width: 390, height: 800 }]]) {
  console.log('\n' + label);
  const ctx = await browser.newContext({ viewport: size, baseURL: process.env.WEB ?? 'http://localhost:5173' });
  const p = await ctx.newPage();
  await p.goto('/'); await p.fill('input[type=email]', 'ana.reyes@example.com'); await p.fill('input[type=password]', 'Reimsys#2026'); await p.click('button[type=submit]'); await p.waitForSelector('.shell');
  await p.goto('/receipts/new'); await p.waitForSelector('.steps');

  await next(p); await audit(p, 'step 1 (BIR invoice)');
  await radio(p, 'Yes'); await next(p);
  await next(p); await audit(p, 'step 2 (under the company)');
  await radio(p, 'Yes'); await next(p);
  await next(p); await audit(p, 'company check');
  for (const t of await p.locator('.tick input').all()) await t.check();
  await next(p);
  await next(p); await audit(p, 'invoice details (empty)');
  await p.getByLabel('Vendor Tax ID No. (TIN)').fill('123');
  await p.getByLabel(/Invoice gross amount/).fill('-5');
  await next(p); await audit(p, 'invoice details (short TIN, negative amount)');
  await p.getByLabel('Invoice no.').fill('E-' + Date.now()); await p.getByLabel('Vendor complete name').fill('Errors Co'); await p.getByLabel('Vendor complete address').fill('Cebu');
  await p.getByLabel('Vendor Tax ID No. (TIN)').fill('12345678900000'); await p.getByLabel(/Invoice gross amount/).fill('1120'); await radio(p, 'Product');
  await next(p);
  await next(p); await audit(p, 'VAT details (empty)');
  await radio(p, 'Vatable'); await p.getByLabel(/^Vatable amount/).fill('900'); await p.getByLabel(/^VAT amount/).fill('108'); await p.getByLabel(/^VAT-exempt amount/).fill('0'); await p.getByLabel(/^Discount/).fill('0');
  await group(p, 'Tax withheld', 'Yes');
  await next(p); await audit(p, 'VAT details (Yes, total does not match)');
  await p.getByLabel(/^Vatable amount/).fill('1000'); await p.getByLabel(/^VAT amount/).fill('120');
  await next(p);
  await next(p); await audit(p, 'Tax withheld (empty)');
  await p.getByLabel(/^Withholding tax rate/).fill('2'); await p.getByLabel(/^Withholding tax amount/).fill('25');
  await next(p); await audit(p, 'Tax withheld (wrong amount)');
  await p.getByLabel(/^Withholding tax amount/).fill('20');
  await next(p);
  ok(`${label}: reached the last step`, (await p.locator('.steph').innerText()) === 'Proof and review');
  await p.click('button:has-text("Submit for checking")');
  // Submit is blocked while the amounts mismatch, so look at the last page's own errors
  await audit(p, 'last step (nothing answered)');
  // the reason-for-spending step, on the path without tax withheld
  await p.goto('/receipts/new'); await p.waitForSelector('.steps');
  await radio(p, 'No'); await next(p);
  await next(p); await audit(p, 'no-BIR invoice details (empty)');
  await p.getByLabel('Vendor complete name').fill('Errors Corner'); await p.getByLabel('Vendor complete address').fill('Cebu'); await p.getByLabel(/Amount paid to vendor/).fill('350');
  await next(p);
  await next(p); await audit(p, 'reason for spending (empty)');
  await p.getByLabel('Specific reason for spending').fill('Water'); await p.getByRole('radio', { name: /^Other/ }).click();
  await next(p); await audit(p, 'reason for spending ("Other" without words)');
  await p.getByLabel('Other classification').fill('Team'); await next(p);
  await p.getByRole('radiogroup', { name: 'New Reimbursement Code' }).getByRole('radio', { name: /^Other/ }).click();
  await p.click('button:has-text("Submit for checking")'); await audit(p, 'last step ("Other" code left empty)');
  ok(`${label}: nothing scrolls sideways`, (await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1);
  await ctx.close();
}
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
