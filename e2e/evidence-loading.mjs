// BL-05 (usability): switching between several pieces of evidence must show a loading sign while the picture comes in, never the old picture
// under the new tab, and say so (with Try again) when a picture cannot be loaded. Needs the API (4000) and web app (5173).
import { chromium } from 'playwright';
import { B, H, PNG, call, loginAll, makeDraft } from './payment-helpers.mjs';
const U = await loginAll();
let r = await makeDraft(U, 'ana', 'Evidence loading', 150);
const f = new FormData();
f.append('files', new Blob([Buffer.concat([PNG, Buffer.from('second' + Math.random())])], { type: 'image/png' }), 'second.png');
r = (await (await fetch(`${B}/receipts/${r.id}/evidence`, { method: 'POST', headers: H(U.ana, false), body: f })).json()).receipt;
let failed = 0;
const ok = (n, c) => { console.log(c ? '  ok  ' : '  FAIL', n); if (!c) failed++; };
const b = await chromium.launch({ channel: 'chrome' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 860 }, baseURL: process.env.WEB ?? 'http://localhost:5173' })).newPage();
await p.goto('/'); await p.fill('input[type=email]', 'ana.reyes@example.com'); await p.fill('input[type=password]', 'Reimsys#2026'); await p.click('button[type=submit]'); await p.waitForSelector('.shell');
await p.goto(`/receipts/${r.id}`);
const tabs = p.locator('.evtab');
await tabs.first().waitFor();
ok('the receipt has two evidence tabs', (await tabs.count()) === 2);
await p.waitForSelector('.evimg');

// slow the second picture down so the loading sign can be seen
let hold; const gate = new Promise((res) => { hold = res; });
await p.route(`**/evidence/${r.evidence[1].id}/file**`, async (rt) => { await gate; await rt.continue(); });
await tabs.nth(1).click();
ok('a loading sign shows while the new picture comes in', await p.locator('.ev-loading').waitFor({ timeout: 3000 }).then(() => true, () => false));
ok('the old picture is not left showing under the new tab', (await p.locator('.stage .evimg').count()) === 0 || (await p.locator('.stage .evimg').first().isHidden()));
hold();
ok('the loading sign goes away when the picture has come in', await p.locator('.ev-loading').waitFor({ state: 'detached', timeout: 5000 }).then(() => true, () => false));
ok('and the picture is shown', await p.locator('.stage .evimg').first().isVisible());
await p.unroute(`**/evidence/${r.evidence[1].id}/file**`);

// a picture that cannot be loaded
await p.route(`**/evidence/${r.evidence[0].id}/file**`, (rt) => rt.fulfill({ status: 500, body: 'x' }));
await tabs.first().click();
ok('a picture that cannot be loaded says so', await p.locator('.ev-loading[role=alert]').waitFor({ timeout: 4000 }).then(() => true, () => false));
await p.unroute(`**/evidence/${r.evidence[0].id}/file**`);
await p.getByRole('button', { name: /Try again/ }).click();
ok('Try again loads it', await p.locator('.stage .evimg').first().waitFor({ timeout: 5000 }).then(() => true, () => false) && (await p.locator('.ev-loading').count()) === 0);
await b.close();
process.exit(failed ? 1 : 0);
