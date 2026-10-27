// What is typed on the reimbursement form is kept in the browser, so leaving by mistake does not lose it. Needs the API (4000) and web app (5173).
// Usage: node e2e/form-draft-ui.mjs
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome' });
let failed = 0;
const ok = (name, cond) => { console.log(cond ? '  ok  ' : '  FAIL', name); if (!cond) failed++; };
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, baseURL: process.env.WEB ?? 'http://localhost:5173' });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
await p.goto('/');
await p.fill('input[type=email]', 'ana.reyes@example.com');
await p.fill('input[type=password]', 'Reimsys#2026');
await p.click('button[type=submit]');
await p.waitForSelector('.shell');

const stamp = Date.now();
const next = () => p.click('button:has-text("Next")');
const title = () => p.locator('.steph').innerText();
const settle = () => p.waitForTimeout(700);

console.log('A new receipt');
await p.goto('/receipts/new'); await p.waitForSelector('.steps');
ok('an empty form shows no restored notice', (await p.getByTestId('draft-restored').count()) === 0);
await p.getByRole('radio', { name: /^No/ }).first().click(); await next();
await p.getByLabel('Vendor complete name').fill('Draft Corner ' + stamp);
await p.getByLabel('Vendor complete address').fill('Mandaue City, Cebu');
await p.getByLabel(/Amount paid to vendor/).fill('350');
await next();
ok('on the reason page', (await title()) === 'Reason for spending');
await p.getByLabel('Specific reason for spending').fill('Water refills');
await settle();

console.log('Closing the page by mistake and coming back');
await p.goto('/receipts/new'); await p.waitForSelector('.steps');
ok('the notice says the form is back', (await p.getByTestId('draft-restored').count()) === 1);
ok('the person is on the page they were on', (await title()) === 'Reason for spending');
ok('the reason they typed is there', (await p.getByLabel('Specific reason for spending').inputValue()) === 'Water refills');
await p.getByRole('button', { name: 'Back' }).click();
ok('and the earlier answers are there', (await p.getByLabel('Vendor complete name').inputValue()) === 'Draft Corner ' + stamp && (await p.getByLabel(/Amount paid to vendor/).inputValue()) === '350');

console.log('Another person on the same browser');
await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('reimsys:form:')) { const v = localStorage.getItem(k); localStorage.removeItem(k); localStorage.setItem(k.replace(/form:\d+:/, 'form:99999:'), v); } });
await p.goto('/receipts/new'); await p.waitForSelector('.steps');
ok("someone else's saved form is not shown", (await p.getByTestId('draft-restored').count()) === 0 && (await title()) === 'Reimbursement details');
await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('reimsys:form:')) localStorage.removeItem(k); });

console.log('Start over');
await p.goto('/receipts/new'); await p.waitForSelector('.steps');
await p.getByRole('radio', { name: /^No/ }).first().click(); await next();
await p.getByLabel('Vendor complete name').fill('Second Draft'); await settle();
await p.goto('/receipts/new'); await p.waitForSelector('.steps');
ok('it comes back again', (await p.getByTestId('draft-restored').count()) === 1);
await p.getByRole('button', { name: 'Start over' }).click();
ok('"Start over" empties the form and hides the notice', (await p.getByTestId('draft-restored').count()) === 0 && (await title()) === 'Reimbursement details');
await settle();
await p.goto('/receipts/new'); await p.waitForSelector('.steps');
ok('and it is not brought back after that', (await p.getByTestId('draft-restored').count()) === 0);

console.log('Saving removes it');
await p.getByRole('radio', { name: /^No/ }).first().click(); await next();
await p.getByLabel('Vendor complete name').fill('Saved Corner ' + stamp);
await p.getByLabel('Vendor complete address').fill('Cebu');
await p.getByLabel(/Amount paid to vendor/).fill('120'); await next();
await p.getByLabel('Specific reason for spending').fill('Water');
await p.getByRole('radio', { name: /^Fuel/ }).first().click();
await p.getByLabel('Choose where to charge').selectOption({ index: 1 }); await next();
await p.click('button:has-text("Save draft")');
await p.waitForURL(/\/receipts\/\d+$/);
const savedId = p.url().match(/(\d+)$/)[1];
ok('no saved form is left on the device', (await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('reimsys:form:')).length)) === 0);
await p.goto('/receipts/new'); await p.waitForSelector('.steps');
ok('a new receipt starts empty', (await p.getByTestId('draft-restored').count()) === 0);

console.log('Editing a saved receipt');
await p.goto(`/receipts/${savedId}/edit`); await p.waitForSelector('.steps');
ok('nothing is restored when nothing changed', (await p.getByTestId('draft-restored').count()) === 0);
await p.getByRole('radio', { name: /^No/ }).first().click().catch(() => undefined);
await next();
await p.getByLabel('Vendor complete name').fill('Edited Name ' + stamp); await settle();
await p.goto(`/receipts/${savedId}/edit`); await p.waitForSelector('.steps');
ok('the unsaved change comes back', (await p.getByTestId('draft-restored').count()) === 1);
await p.getByRole('button', { name: 'Start over' }).click();
await next();
ok('"Start over" goes back to what was saved', (await p.getByLabel('Vendor complete name').inputValue()) === 'Saved Corner ' + stamp);

console.log('Signing out');
await p.goto('/receipts/new'); await p.waitForSelector('.steps');
await p.getByRole('radio', { name: /^No/ }).first().click(); await settle();
ok('a form is kept while signed in', (await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('reimsys:form:')).length)) === 1);
await p.getByRole('button', { name: 'Sign out' }).click(); await p.waitForSelector('input[type=email]');
ok('signing out clears it from the device', (await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('reimsys:form:')).length)) === 0);
ok('no errors in the browser', errors.length === 0);
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nAll draft checks passed');
process.exit(failed ? 1 : 0);
