// The Help page shows which version the page and the server are, and warns when the server is older (not restarted after an update).
// The public health check must still reveal nothing but "ok". Needs the API (4000) and web app (5173).
import { chromium } from 'playwright';
import { B, call, login } from './payment-helpers.mjs';
const WEB = process.env.WEB ?? 'http://localhost:5173';
let failed = 0;
const ok = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : x); if (!c) failed++; };

console.log('The API');
const anon = await fetch(B + '/build', { headers: { 'x-requested-with': 'reimsys' } });
ok('signed out, the build is not shown (401)', anon.status === 401);
ok('the public health check still reveals nothing but "ok"', (await (await fetch(B + '/health')).text()) === '{"ok":true}');
const c = await login('ana.reyes@example.com');
const bi = await call(c, 'GET', '/build');
ok('signed in, it gives the commit and the start time', bi.s === 200 && typeof bi.d.commit === 'string' && bi.d.commit.length > 0 && !Number.isNaN(Date.parse(bi.d.startedAt)), JSON.stringify(bi.d));

console.log('The Help page');
const b = await chromium.launch({ channel: 'chrome' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 860 }, baseURL: WEB })).newPage();
await p.goto('/'); await p.fill('input[type=email]', 'ana.reyes@example.com'); await p.fill('input[type=password]', 'Reimsys#2026'); await p.click('button[type=submit]'); await p.waitForSelector('.shell');
await p.goto('/help'); await p.waitForSelector('#version');
const text = async () => (await p.locator('#version').innerText());
await p.waitForFunction(() => !document.querySelector('#version')?.textContent?.includes('checking'));
let t = await text();
ok('it shows the page version and the server version', /Page:\s*\S+/.test(t) && t.includes(bi.d.commit), t.replace(/\n/g, ' | '));
const pageCommit = (t.match(/Page:\s*(\S+?),/) ?? [])[1];
const same = pageCommit === bi.d.commit && pageCommit !== 'unknown';
const warned = t.includes('not the same version');
const unknown = pageCommit === 'unknown' || bi.d.commit === 'unknown';
ok(same ? 'with matching versions there is no warning' : 'different versions show the warning', same ? !warned : warned || unknown, t);

await p.route('**/api/build', (rt) => rt.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found.' } }) }));
await p.goto('/help'); await p.waitForSelector('#version'); await p.waitForFunction(() => !document.querySelector('#version')?.textContent?.includes('checking'));
t = await text();
ok('an old server (no build route) is reported as older, with what to do', t.includes('older than this page') && t.includes('update and restart'), t.replace(/\n/g, ' | '));
await p.unroute('**/api/build');

await p.route('**/api/build', (rt) => rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ commit: 'abc1234', startedAt: new Date().toISOString() }) }));
await p.goto('/help'); await p.waitForSelector('#version'); await p.waitForFunction(() => !document.querySelector('#version')?.textContent?.includes('checking'));
t = await text();
const webCommit = await p.evaluate(() => document.querySelector('#version li')?.textContent ?? '');
ok('a server on a different version shows the warning', webCommit.includes('unknown') || t.includes('not the same version'), t.replace(/\n/g, ' | '));
await b.close();
process.exit(failed ? 1 : 0);
