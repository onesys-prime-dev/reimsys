// The two client requests (choosing a batch, searching with any words) checked as every kind of user, through the API and in
// Chrome: what each role finds, which batch controls each one sees, and what each one is refused.
// Needs the API (4000) and the web app (5173) running, and the seed applied. Usage: node e2e/new-features-roles.mjs [screenshot-dir]
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { B, F, H, PNG, call, login, loginAll, tag, today } from './payment-helpers.mjs';

const OUT = process.argv[2] ?? path.join(os.tmpdir(), 'reimsys-roles-shots');
fs.mkdirSync(OUT, { recursive: true });
const U = await loginAll();
U.manager = await login('manager@example.com');
const word = `roles${tag.split(' ').pop()}`;
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(cond ? '  ok  ' : '  FAIL', name, cond ? '' : extra); if (!cond) failed++; };
const view = (c, r) => fetch(`${B}/receipts/${r.id}/evidence/${r.evidence[0].id}/file?mode=view`, { headers: H(c, false) });
const step = async (c, r, action) => {
  const res = await call(c, 'POST', `/receipts/${r.id}/${action}`, { version: r.version });
  if (res.s !== 200) throw new Error(`${action} failed ${res.s} ${JSON.stringify(res.d)}`);
  return res.d.receipt;
};
async function make(name, stage) {
  let r = (await call(U.ana, 'POST', '/receipts', { payee: `${name} ${word}`, receiptDate: today(), amount: 111, ...F })).d.receipt;
  const f = new FormData();
  f.append('files', new Blob([Buffer.concat([PNG, Buffer.from(name + word + Math.random())])], { type: 'image/png' }), 'receipt.png');
  r = (await (await fetch(`${B}/receipts/${r.id}/evidence`, { method: 'POST', headers: H(U.ana, false), body: f })).json()).receipt;
  if (stage === 'draft') return r;
  r = await step(U.ana, r, 'submit');
  if (stage === 'submitted') return r;
  await view(U.liza, r); r = await step(U.liza, r, 'check');
  if (stage === 'checked') return r;
  await view(U.paolo, r); return step(U.paolo, r, 'approve');
}

// One receipt by Ana at each step, all carrying the run's word, and one open batch from Accounting.
const BX = (await call(U.rica, 'POST', '/batches', { name: `Roles run ${word}` })).d.batch;
const D = await make('Roles draft', 'draft');
const S = await make('Roles submitted', 'submitted');
const C = await make('Roles checked', 'checked');
const A = await make('Roles approved', 'approved');
await call(U.ana, 'PUT', `/receipts/${D.id}/batch`, { batchId: BX.id });
await call(U.ana, 'PUT', `/receipts/${S.id}/batch`, { batchId: BX.id });
const ref = { D: D.refNo, S: S.refNo, C: C.refNo, A: A.refNo };

// What each role should find with the run's word, and what they may do with the batch choice.
const ROLES = [
  { key: 'ana', email: 'ana.reyes@example.com', label: 'Med Ref (owner)', finds: ['D', 'S', 'C', 'A'], chooses: true, batches: false },
  { key: 'mark', email: 'mark.dc@example.com', label: 'another Med Ref', finds: [], chooses: true, batches: false },
  { key: 'liza', email: 'liza.santos@example.com', label: 'Checker', finds: ['S', 'C', 'A'], chooses: false, batches: true },
  { key: 'paolo', email: 'paolo.v@example.com', label: 'Approver', finds: ['C', 'A'], chooses: false, batches: true },
  { key: 'rica', email: 'accounting@example.com', label: 'Accounting', finds: ['A'], chooses: false, batches: true, manages: true },
  { key: 'manager', email: 'manager@example.com', label: 'Admin', finds: ['S', 'C', 'A'], chooses: false, batches: true, manages: true },
  { key: 'admin', email: 'admin@example.com', label: 'Super Admin', finds: ['S', 'C', 'A'], chooses: false, batches: true, manages: true },
];

console.log('Through the API');
for (const r of ROLES) {
  const c = U[r.key];
  const items = (await call(c, 'GET', `/receipts?pageSize=100&q=${encodeURIComponent(word)}`)).d.items.map((x) => x.refNo);
  const found = Object.keys(ref).filter((k) => items.includes(ref[k]));
  ok(`${r.label}: the search finds exactly ${r.finds.join(', ') || 'nothing'}`, JSON.stringify(found) === JSON.stringify(r.finds), JSON.stringify(found));
  const two = (await call(c, 'GET', `/receipts?pageSize=100&q=${encodeURIComponent(`approved ${word}`)}`)).d.items.map((x) => x.refNo);
  ok(`${r.label}: "approved ${word}" narrows it to the approved one`, JSON.stringify(two) === JSON.stringify(r.finds.includes('A') ? [ref.A] : []), JSON.stringify(two));
  const choices = await call(c, 'GET', '/receipts/batch-choices');
  ok(`${r.label}: ${r.chooses ? 'gets' : 'does not get'} the list of batches to choose from`, r.chooses ? choices.s === 200 && choices.d.batches.some((b) => b.id === BX.id) : choices.s === 403);
  const put = await call(c, 'PUT', `/receipts/${S.id}/batch`, { batchId: null });
  ok(`${r.label}: ${r.key === 'ana' ? 'can' : 'cannot'} change the batch of Ana's receipt`, r.key === 'ana' ? put.s === 200 : [403, 404].includes(put.s), `${put.s} ${JSON.stringify(put.d?.error)}`);
  if (r.key === 'ana') await call(c, 'PUT', `/receipts/${S.id}/batch`, { batchId: BX.id });
  const bp = await call(c, 'GET', `/batches/${BX.id}`);
  if (!r.batches) ok(`${r.label}: cannot open batch pages`, bp.s === 403);
  else ok(`${r.label}: ${r.manages ? 'sees the 1 draft waiting to join' : 'is not shown the drafts waiting'}`, bp.s === 200 && bp.d.batch.waitingDrafts === (r.manages ? 1 : 0), JSON.stringify(bp.d?.batch?.waitingDrafts));
}
const anaS = (await call(U.ana, 'GET', `/receipts/${S.id}`)).d.receipt;
ok('the owner\'s change was put back (S is in the batch again)', anaS.batch?.id === BX.id);

console.log('\nIn Chrome');
const browser = await chromium.launch({ channel: 'chrome' });
const pages = [];
async function open(email, size = { width: 1280, height: 820 }) {
  const ctx = await browser.newContext({ viewport: size, baseURL: process.env.WEB ?? 'http://localhost:5173' });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/401|403|404|409/.test(m.text()) && page.errors.push(m.text()));
  await page.goto('/');
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', 'Reimsys#2026');
  await page.click('button[type=submit]');
  await page.waitForSelector('.shell');
  pages.push({ email, page });
  return page;
}
const settle = (page) => page.waitForLoadState('networkidle').catch(() => {});
for (const r of ROLES) {
  const phone = r.key === 'ana' || r.key === 'rica';
  const page = await open(r.email, phone ? { width: 390, height: 844 } : undefined);
  // The search box on the receipts list.
  await page.goto('/receipts');
  await page.waitForSelector('input[aria-label="Search receipts"]');
  await page.fill('input[aria-label="Search receipts"]', word);
  await settle(page); await page.waitForTimeout(600); await settle(page);
  const text = await page.locator('main').innerText();
  const seen = Object.keys(ref).filter((k) => text.includes(ref[k]));
  ok(`${r.label}${phone ? ' (phone)' : ''}: the list search shows ${r.finds.join(', ') || 'nothing'}`, JSON.stringify(seen) === JSON.stringify(r.finds), JSON.stringify(seen));
  // The batch control on a receipt this role can open.
  const target = r.finds.includes('S') ? S : r.finds.includes('A') ? A : null;
  if (target) {
    await page.goto(`/receipts/${target.id}`);
    await page.waitForSelector('.dh .meta');
    await settle(page);
    const hasPick = await page.locator('[data-testid=pick-batch]').count();
    ok(`${r.label}: ${r.key === 'ana' ? 'has' : 'has no'} "Change batch" on the receipt`, r.key === 'ana' ? hasPick === 1 : hasPick === 0);
    if (target === S) {
      const link = await page.locator(`.dh .meta a[href="/batches/${BX.id}"]`).count();
      ok(`${r.label}: the batch code ${r.batches ? 'opens the batch' : 'is shown as plain text'}`, r.batches ? link === 1 : link === 0 && (await page.locator('.dh .meta').innerText()).includes(BX.code));
    }
  }
  if (r.key === 'ana') {
    await page.goto(`/receipts/${D.id}`);
    await page.waitForSelector('[data-testid=want-batch]');
    ok('Med Ref: her draft says which batch it joins', (await page.locator('[data-testid=want-batch]').innerText()).includes(BX.code));
    await page.goto(`/receipts/${D.id}/edit?step=spend`);
    await page.waitForSelector('select[aria-label=Batch]:not([disabled])');
    ok('Med Ref: the form has the Batch field with her choice', (await page.locator('select[aria-label=Batch]').inputValue()) === String(BX.id));
    ok('Med Ref: the batch menu is not in her navigation', (await page.locator('.side .nav >> text=Batches, .tabbar >> text=Batches').count()) === 0);
  }
  if (r.batches) {
    await page.goto(`/batches/${BX.id}`);
    await page.waitForSelector('.dh h1');
    await settle(page);
    const callout = await page.locator('[data-testid=waiting-drafts]').count();
    ok(`${r.label}: the batch page ${r.manages ? 'shows' : 'does not show'} the draft waiting to join`, r.manages ? callout === 1 : callout === 0);
  }
  ok(`${r.label}: nothing spills sideways`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.screenshot({ path: path.join(OUT, `${r.key}.png`), fullPage: false });
}
for (const { email, page } of pages) ok(`no errors in the page for ${email}`, page.errors.length === 0, page.errors.join(' | '));
await browser.close();
console.log(`\nScreenshots: ${OUT}`);
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
