// What is typed on the reimbursement form is saved on the server as it goes, even half filled, so leaving by mistake loses nothing and the form can be
// continued from another device. Needs the API (4000) and web app (5173). Usage: node e2e/form-draft-ui.mjs
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome' });
let failed = 0;
const ok = (name, cond, x = '') => { console.log(cond ? '  ok  ' : '  FAIL', name, cond ? '' : x); if (!cond) failed++; };
const errors = [];
const BASE = process.env.WEB ?? 'http://localhost:5173';

async function signIn() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, baseURL: BASE });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto('/');
  await p.fill('input[type=email]', 'ana.reyes@example.com');
  await p.fill('input[type=password]', 'Reimsys#2026');
  await p.click('button[type=submit]');
  await p.waitForSelector('.shell');
  return { ctx, p };
}
const server = (p, method, path, body) => p.evaluate(async ([m, u, b]) => {
  const r = await fetch('/api' + u, { method: m, headers: { 'content-type': 'application/json', 'x-requested-with': 'reimsys' }, body: b ? JSON.stringify(b) : undefined });
  return { s: r.status, d: await r.json().catch(() => null) };
}, [method, path, body]);

const { ctx, p } = await signIn();
const stamp = Date.now();
const next = () => p.click('button:has-text("Next")');
const title = () => p.locator('.steph').innerText();
const saved = () => p.waitForFunction(() => /All changes saved/.test(document.querySelector('[data-testid=draft-status]')?.textContent ?? ''), null, { timeout: 8000 });
const drafts = async () => (await server(p, 'GET', '/form-drafts')).d.drafts;
const open = async (path) => { await p.goto(path); await p.waitForSelector(/^\/receipts\/(new|\d+\/edit)/.test(path) ? '.steps' : '.shell'); };
/** Waits until the server has a draft that satisfies the check (a save runs a moment after the last change). */
const until = async (check) => { for (let i = 0; i < 40; i++) { if (check(await drafts())) return true; await p.waitForTimeout(200); } return false; };

// start clean
for (const d of await drafts()) await server(p, 'DELETE', '/form-drafts/' + d.id);

console.log('Half filling a new form');
await open('/receipts/new');
ok('an empty form has no saved copy and no notice', (await drafts()).length === 0 && (await p.getByTestId('draft-restored').count()) === 0);
await p.getByRole('radio', { name: /^No/ }).first().click(); await next();
await p.getByLabel('Vendor complete name').fill('Draft Corner ' + stamp);
await saved();
const list1 = await drafts();
ok('it is saved on the server, though nothing else is filled in', list1.length === 1 && list1[0].vendor === 'Draft Corner ' + stamp && list1[0].amount === null);
ok('the address now names the draft', /[?&]draft=\d+/.test(p.url()));
ok('the page says it is saved', /All changes saved/.test(await p.getByTestId('draft-status').innerText()));
await p.getByLabel(/Amount paid to vendor/).fill('350');
ok('later changes go into the same draft', await until((l) => l.length === 1 && l[0].amount === 350));
const draftUrl = p.url();

console.log('Refreshing or closing the page by mistake');
await p.reload(); await p.waitForSelector('.steps');
ok('the same form is back, on the same step, with the notice', (await title()) === 'Invoice details' && (await p.getByLabel('Vendor complete name').inputValue()) === 'Draft Corner ' + stamp && (await p.getByTestId('draft-restored').count()) === 1);
ok('and the amount', (await p.getByLabel(/Amount paid to vendor/).inputValue()) === '350');

console.log('Typing and leaving at once');
await p.getByLabel('Vendor complete address').fill('Mandaue City');
await open('/receipts');   // leaves before the short wait is over
await p.waitForTimeout(600);
const afterLeave = (await server(p, 'GET', '/form-drafts/' + list1[0].id)).d.draft.data;
ok('the last thing typed was kept', afterLeave.vendorAddress === 'Mandaue City', JSON.stringify(afterLeave));

console.log('Finding it again from the lists');
ok('the receipts page tells about the unfinished form', (await p.getByTestId('unfinished-forms').count()) === 1 && /Draft Corner/.test(await p.getByTestId('unfinished-forms').innerText()));
await open('/receipts/new');
ok('a new form offers the unfinished one', (await p.getByTestId('draft-list').count()) === 1 && /Draft Corner/.test(await p.getByTestId('draft-list').innerText()));
await p.getByRole('link', { name: 'Continue' }).click(); await p.waitForSelector('.steps');
await p.waitForFunction(() => document.querySelector('.steph')?.textContent === 'Invoice details');
ok('Continue opens it with the address in it', (await p.getByLabel('Vendor complete address').inputValue()) === 'Mandaue City');

console.log('From another device');
const other = await signIn();
await other.p.goto('/receipts/new'); await other.p.waitForSelector('.steps');
ok('the same person sees it on another browser', (await other.p.getByTestId('draft-list').count()) === 1);
await other.p.getByRole('link', { name: 'Continue' }).click();
await other.p.waitForFunction((v) => document.querySelector('input[value="' + v + '"]'), 'Draft Corner ' + stamp, { timeout: 8000 }).catch(() => undefined);
ok('and can continue it', (await other.p.getByLabel('Vendor complete name').inputValue()) === 'Draft Corner ' + stamp);
await other.ctx.close();

console.log('"New receipt" while a draft is open');
await p.getByRole('link', { name: 'New receipt' }).first().click().catch(async () => { await open('/receipts/new'); });
await p.waitForTimeout(400);
ok('starts a fresh form, and the draft is kept', (await title()) === 'Reimbursement details' && (await drafts()).length === 1);

console.log('Starting over');
await open('/receipts/new' + draftUrl.slice(draftUrl.indexOf('?')));
await p.getByRole('button', { name: 'Start over' }).click();
await p.waitForTimeout(500);
ok('"Start over" empties the form and removes it from the server', (await title()) === 'Reimbursement details' && (await drafts()).length === 0 && (await p.getByTestId('draft-restored').count()) === 0);
await open('/receipts/new' + draftUrl.slice(draftUrl.indexOf('?')));
ok('an old link to a discarded draft is explained, not broken', (await p.locator('.toast').count()) >= 1 && (await title()) === 'Reimbursement details');

console.log('Going back to empty');
await open('/receipts/new');
await p.getByRole('radio', { name: /^No/ }).first().click(); await saved();
ok('a form that has an answer is saved', (await drafts()).length === 1);
await p.getByRole('radio', { name: /^Yes/ }).first().click(); await p.getByRole('radio', { name: /^No/ }).first().click();
await p.getByRole('button', { name: 'Back' }).click().catch(() => undefined);
await server(p, 'DELETE', '/form-drafts/' + (await drafts())[0].id);

console.log('Saving the receipt removes the draft');
await open('/receipts/new');
await p.getByRole('radio', { name: /^No/ }).first().click(); await next();
await p.getByLabel('Vendor complete name').fill('Saved Corner ' + stamp);
await p.getByLabel('Vendor complete address').fill('Cebu');
await p.getByLabel(/Amount paid to vendor/).fill('120'); await next();
await p.getByLabel('Specific reason for spending').fill('Water');
await p.getByRole('radio', { name: /^Fuel/ }).first().click();
await p.getByLabel('Choose where to charge').selectOption({ index: 1 }); await saved(); await next();
ok('one draft while filling in', (await drafts()).length === 1);
await p.click('button:has-text("Save draft")');
await p.waitForURL(/\/receipts\/\d+$/);
const savedId = p.url().match(/(\d+)$/)[1];
ok('no unfinished form is left once the receipt is saved', (await drafts()).length === 0);

console.log('Editing a saved receipt');
await open(`/receipts/${savedId}/edit`);
ok('nothing is restored when nothing changed', (await p.getByTestId('draft-restored').count()) === 0 && (await drafts()).length === 0);
await next();
await p.getByLabel('Vendor complete name').fill('Edited Name ' + stamp);
ok('the change is saved for that receipt', await until((l) => l.some((d) => d.receiptId === Number(savedId) && d.vendor === 'Edited Name ' + stamp)));
await open(`/receipts/${savedId}/edit`);
ok('it comes back when the edit screen is opened again', (await p.getByTestId('draft-restored').count()) === 1);
await p.getByRole('button', { name: 'Start over' }).click();
await p.waitForTimeout(400);
await next();
ok('"Start over" goes back to what was saved', (await p.getByLabel('Vendor complete name').inputValue()) === 'Saved Corner ' + stamp && (await drafts()).length === 0);

ok('no errors in the browser', errors.length === 0, errors.join(' | '));
await server(p, 'DELETE', '/receipts/' + savedId);
await ctx.close();
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nAll draft checks passed');
process.exit(failed ? 1 : 0);
