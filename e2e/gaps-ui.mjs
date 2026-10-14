// A Med Ref uses the delete, withdraw and duplicate-warning features in the real UI. Sends no email to anyone real.
// Usage: WEB=http://localhost:4000 node e2e/gaps-ui.mjs <screenshot-dir>
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const img = (tag) => { const f = path.join(OUT, `r-${tag}-${Date.now()}.png`); fs.writeFileSync(f, Buffer.concat([PNG, Buffer.from(tag + Math.random())])); return f; };
let failed = 0;
const ok = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : x); if (!c) failed++; };

const b = await chromium.launch({ channel: 'chrome' });
async function login(email, size = { width: 1280, height: 900 }) {
  const p = await (await b.newContext({ viewport: size, baseURL: process.env.WEB ?? 'http://localhost:5173' })).newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  p.on('console', (m) => m.type() === 'error' && !/40[0-9]/.test(m.text()) && p.errors.push(m.text()));
  await p.goto('/'); await p.fill('input[type=email]', email); await p.fill('input[type=password]', 'Reimsys#2026'); await p.click('button[type=submit]');
  await p.waitForSelector('.shell');
  return p;
}
const tag = 'Gap test ' + Date.now().toString().slice(-6);
async function newReceipt(p, name, { submit = false, amount = '64.50' } = {}) {
  await p.goto('/receipts/new'); await p.waitForSelector('form');
  await p.fill('input[placeholder="Store or provider name"]', name);
  await p.fill('input[placeholder="0.00"]', amount);
  await p.setInputFiles('input[type=file]', img(name.slice(-4)));
  await p.click(submit ? 'button:has-text("Submit for checking")' : 'button:has-text("Save draft")');
  await p.waitForURL(/\/receipts\/\d+$/);
  await p.waitForSelector(submit ? '.pill:has-text("Submitted")' : '.pill:has-text("Draft")');
  return p.url();
}

const ana = await login('ana.reyes@example.com');

console.log('Delete a draft');
const draftUrl = await newReceipt(ana, tag + ' A');
ok('a draft offers Delete draft', await ana.locator('button:has-text("Delete draft")').isVisible());
await ana.click('button:has-text("Delete draft")');
await ana.waitForSelector('.modal:has-text("cannot be undone")');
await ana.click('.modal button:has-text("Keep it")');
ok('Keep it closes the question and nothing is deleted', !(await ana.locator('.modal').count()) && (await ana.locator('.pill:has-text("Draft")').count()) === 1);
await ana.click('button:has-text("Delete draft")'); await ana.click('.modal button:has-text("Delete draft")');
await ana.waitForURL(/\/receipts$/);
await ana.waitForSelector('.toast:has-text("Draft deleted")');
ok('deleting returns to the list with a confirmation', true);
await ana.goto(draftUrl); await ana.waitForTimeout(800);
ok('the deleted draft is gone', /not found/i.test(await ana.locator('body').innerText()));

console.log('Withdraw a submitted receipt');
const subUrl = await newReceipt(ana, tag + ' B', { submit: true });
ok('a submitted receipt offers Withdraw and not Delete', await ana.locator('button:has-text("Withdraw")').isVisible() && !(await ana.locator('button:has-text("Delete draft")').count()));
await ana.click('button:has-text("Withdraw")');
await ana.fill('.modal textarea', 'Wrong photo, will upload the right one');
await ana.click('.modal button:has-text("Withdraw")');
await ana.waitForSelector('.pill:has-text("Draft")');
ok('withdrawing puts it back to Draft with the edit buttons', await ana.locator('a:has-text("Edit")').isVisible() && await ana.locator('button:has-text("Delete draft")').isVisible());
await ana.screenshot({ path: path.join(OUT, 'withdrawn.png'), fullPage: true });

const liza = await login('liza.santos@example.com');
await liza.goto(subUrl); await liza.waitForTimeout(900);
ok('the checker can no longer open the withdrawn receipt', /not found/i.test(await liza.locator('body').innerText()));
await liza.goto('/'); await liza.waitForSelector('.tiles');
ok('the checker was told it was withdrawn', (await liza.evaluate(async () => (await (await fetch('/api/notifications', { headers: { 'x-requested-with': 'reimsys' } })).json()).items.some((n) => /was withdrawn by/.test(n.text)))));

console.log('Duplicate warning');
await newReceipt(ana, tag + ' C', { amount: '123.45' });
const dupUrl = await newReceipt(ana, tag + ' C', { amount: '123.45' });
await ana.waitForSelector('.callout.warn:has-text("Possible duplicate")');
ok('the second identical receipt shows the warning, with a link to the first', (await ana.locator('.callout.warn a').count()) === 1);
await ana.screenshot({ path: path.join(OUT, 'duplicate.png'), fullPage: true });
const dupId = dupUrl.split('/').pop();
await ana.click('.callout.warn a'); await ana.waitForSelector('.callout.warn:has-text("Possible duplicate")');
ok('the first one warns about the second too', true);

console.log('Phone layout of the new buttons');
const m = await login('ana.reyes@example.com', { width: 390, height: 844 });
await m.goto(dupUrl.replace(/^https?:\/\/[^/]+/, '')); await m.waitForSelector('.dh');
ok('no sideways scrolling on a phone', (await m.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1);
await m.screenshot({ path: path.join(OUT, 'dup-phone.png') });

// tidy up the throwaway drafts and submitted receipts this test made
for (const p of [ana]) {
  const items = await p.evaluate(async (t) => (await (await fetch('/api/receipts?pageSize=100&q=' + encodeURIComponent(t), { headers: { 'x-requested-with': 'reimsys' } })).json()).items, tag);
  for (const it of items.filter((x) => x.status === 'draft')) await p.evaluate((id) => fetch('/api/receipts/' + id, { method: 'DELETE', headers: { 'x-requested-with': 'reimsys' } }), it.id);
}
ok('no browser errors', ana.errors.length === 0, JSON.stringify(ana.errors.slice(0, 3)));
await b.close();
console.log(failed ? `\n${failed} FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
