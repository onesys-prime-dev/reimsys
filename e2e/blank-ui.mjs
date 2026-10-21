// BL-08 in the browser: the Approver's Disapprove window must stay disabled for a reason of only blank characters. Needs API (4000) and web (5173).
import { chromium } from 'playwright';
import { B, H, call, loginAll, makeDraft } from './payment-helpers.mjs';
const U = await loginAll();
let r = await makeDraft(U, 'ana', 'Blank UI', 250);
r = (await call(U.ana, 'POST', `/receipts/${r.id}/submit`, { version: r.version })).d.receipt;
await fetch(`${B}/receipts/${r.id}/evidence/${r.evidence[0].id}/file?mode=view`, { headers: H(U.liza, false) });
r = (await call(U.liza, 'POST', `/receipts/${r.id}/check`, { version: r.version })).d.receipt;
await fetch(`${B}/receipts/${r.id}/evidence/${r.evidence[0].id}/file?mode=view`, { headers: H(U.paolo, false) });
let failed = 0;
const ok = (n, c) => { console.log(c ? '  ok  ' : '  FAIL', n); if (!c) failed++; };
const b = await chromium.launch({ channel: 'chrome' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 860 }, baseURL: process.env.WEB ?? 'http://localhost:5173' })).newPage();
await p.goto('/'); await p.fill('input[type=email]', 'paolo.v@example.com'); await p.fill('input[type=password]', 'Reimsys#2026'); await p.click('button[type=submit]'); await p.waitForSelector('.shell');
await p.goto(`/receipts/${r.id}`);
await p.getByRole('button', { name: /^Disapprove$/ }).first().click();
const dlg = p.locator('.modal');
const btn = dlg.locator('.btns button').last();
for (const t of ['ㅤㅤㅤㅤㅤ', '⠀⠀⠀⠀⠀', '​​​​​', '      ', '     ']) {
  await dlg.locator('textarea').fill(t);
  ok(`Disapprove stays disabled for ${[...t][0].codePointAt(0).toString(16)}`, await btn.isDisabled());
}
await dlg.locator('textarea').fill('Wrong vendor');
ok('a real reason enables it', await btn.isEnabled());
await b.close();
process.exit(failed ? 1 : 0);
