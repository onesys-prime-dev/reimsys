// Checks the Med Ref is warned about a possible duplicate while encoding, in Chrome. Needs the API (4000) and the web app (5173).
// Usage: node e2e/duplicate-ui.mjs
import { chromium } from 'playwright';
import { call, loginAll, makeDraft, F, today, tag } from './payment-helpers.mjs';

const U = await loginAll();
const first = await makeDraft(U, 'ana', 'Dupe shop', 880);
// Same vendor, amount and date as the first one.
const second = (await call(U.ana, 'POST', '/receipts', { payee: `Dupe shop ${tag}`, receiptDate: today(), amount: 880, ...F, description: 'second' })).d.receipt;
const lone = await makeDraft(U, 'ana', 'Lone shop', 881);

const browser = await chromium.launch({ channel: 'chrome' });
let failed = 0;
const ok = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : x); if (!c) failed++; };
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, baseURL: process.env.WEB ?? 'http://localhost:5173' });
const p = await ctx.newPage();
await p.goto('/'); await p.fill('input[type=email]', 'ana.reyes@example.com'); await p.fill('input[type=password]', 'Reimsys#2026'); await p.click('button[type=submit]');
await p.waitForSelector('.shell');

await p.goto(`/receipts/${second.id}/edit?step=evidence`);
await p.waitForSelector('.steph');
const dupBox = p.locator('.callout.warn', { hasText: 'Possible duplicate' });
await dupBox.waitFor({ timeout: 8000 }).catch(() => {});
ok('the review step warns about a possible duplicate', (await dupBox.count()) === 1);
ok('the warning names the other receipt and links to it', (await dupBox.count()) === 1 && (await dupBox.innerText()).includes(first.refNo) && (await dupBox.locator(`a[href="/receipts/${first.id}"]`).count()) === 1);

await p.goto(`/receipts/${lone.id}/edit?step=evidence`);
await p.waitForSelector('.steph');
await p.waitForTimeout(800);
ok('a receipt with no look-alike shows no warning', (await p.locator('.callout.warn', { hasText: 'Possible duplicate' }).count()) === 0);

await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
