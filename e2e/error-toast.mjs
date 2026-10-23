// Every failed action tells the person: here the "Mark all read" button has no handler of its own, so the app-wide safety net must show a toast.
// Covers a server message, a proxy HTML page, a crash and an unreachable server. Needs API (4000) and web (5173).
import { chromium } from 'playwright';
import { call, loginAll, makeDraft } from './payment-helpers.mjs';
const U = await loginAll();
const r = await makeDraft(U, 'ana', 'Error toast', 120);
await call(U.ana, 'POST', `/receipts/${r.id}/submit`, { version: r.version });
let failed = 0;
const ok = (n, c) => { console.log(c ? '  ok  ' : '  FAIL', n); if (!c) failed++; };
const b = await chromium.launch({ channel: 'chrome' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 860 }, baseURL: process.env.WEB ?? 'http://localhost:5173' })).newPage();
await p.goto('/'); await p.fill('input[type=email]', 'liza.santos@example.com'); await p.fill('input[type=password]', 'Reimsys#2026'); await p.click('button[type=submit]'); await p.waitForSelector('.shell');
const cases = [
  ['a refusal with a message shows that message', (rt) => rt.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { code: 'X', message: 'That is not allowed right now.' } }) }), /That is not allowed right now\./],
  ['a proxy error page (HTML, 502) says the server is unavailable', (rt) => rt.fulfill({ status: 502, contentType: 'text/html', body: '<html>Bad gateway</html>' }), /server is not available/i],
  ['a crash (500, no message) says the server had a problem', (rt) => rt.fulfill({ status: 500, contentType: 'text/html', body: 'oops' }), /server had a problem/i],
  ['an unreachable server says so', (rt) => rt.abort('failed'), /Cannot reach the server/i],
];
for (const [name, handler, re] of cases) {
  await p.route('**/api/notifications/read', handler);
  await p.getByRole('button', { name: /^Notifications/ }).click();
  const all = p.getByRole('button', { name: /Mark all read/ });
  if (await all.isDisabled()) { ok(`${name} (no unread to click)`, false); await p.unroute('**/api/notifications/read'); continue; }
  await all.click();
  ok(name, await p.locator('.toast').filter({ hasText: re }).first().waitFor({ timeout: 4000 }).then(() => true, () => false));
  await p.unroute('**/api/notifications/read');
  await p.keyboard.press('Escape'); await p.waitForTimeout(3800);
}
await b.close();
process.exit(failed ? 1 : 0);
