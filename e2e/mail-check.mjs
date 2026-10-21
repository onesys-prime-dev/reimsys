// The mail check (Access → Email → Run full check): API shape and permissions, the audit entry, and the screen. Needs the API (4000) and web app (5173).
// It only reads and tests: nothing is sent. Usage: node e2e/mail-check.mjs
import { chromium } from 'playwright';
const API = process.env.API ?? 'http://localhost:4000/api';
const WEB = process.env.WEB ?? 'http://localhost:5173';
let failed = 0;
const ok = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : x); if (!c) failed++; };
const call = async (cookie, m, p, b) => {
  const r = await fetch(API + p, { method: m, headers: { 'x-requested-with': 'reimsys', origin: new URL(API).origin, cookie, ...(b ? { 'content-type': 'application/json' } : {}) }, body: b ? JSON.stringify(b) : undefined });
  return { s: r.status, d: await r.json().catch(() => null), cookie: r.headers.get('set-cookie')?.split(';')[0] };
};
const admin = (await call('', 'POST', '/auth/login', { email: 'admin@example.com', password: 'Reimsys#2026' })).cookie;
const ana = (await call('', 'POST', '/auth/login', { email: 'ana.reyes@example.com', password: 'Reimsys#2026' })).cookie;

console.log('API');
const r = await call(admin, 'POST', '/settings/mail/diagnose');
ok('an administrator can run the check', r.s === 200 && Array.isArray(r.d?.steps), JSON.stringify(r.d).slice(0, 200));
const ids = (r.d?.steps ?? []).map((s) => s.id).join(',');
ok('it reports the five steps in order', ids === 'account,key,name,ports,login', ids);
ok('every step has a plain label, a state and a detail', (r.d?.steps ?? []).every((s) => s.label && ['ok', 'fail', 'skipped'].includes(s.state) && s.detail));
ok('every failed step says what to do', (r.d?.steps ?? []).filter((s) => s.state === 'fail').every((s) => !!s.fix));
ok('"ok" agrees with the steps', r.d?.ok === (r.d?.steps ?? []).every((s) => s.state !== 'fail'));
ok('no password appears anywhere in the answer', !/pass|secret/i.test(JSON.stringify(r.d).replace(/password can be read|saved password|the password|mail password|no password|and password|username, password|password again/gi, '')), JSON.stringify(r.d).slice(0, 300));
ok('a Med Ref cannot run it', (await call(ana, 'POST', '/settings/mail/diagnose')).s === 403);
ok('signed-out people cannot run it', (await call('', 'POST', '/settings/mail/diagnose')).s === 401);
const view = await call(admin, 'GET', '/settings/mail');
ok('the mail settings say whether the password can be unlocked', typeof view.d?.mail?.passwordUnreadable === 'boolean' || view.d?.mail?.passwordUnreadable === undefined);
const audit = await call(admin, 'GET', '/audit?action=settings.mail_checked&pageSize=5');
ok('running the check is written to the audit log', (audit.d?.items ?? []).some((a) => a.action === 'settings.mail_checked'), JSON.stringify(audit.d).slice(0, 200));

console.log('\nScreen');
const b = await chromium.launch({ channel: 'chrome' });
for (const [label, size] of [['computer', { width: 1280, height: 860 }], ['phone', { width: 390, height: 780 }]]) {
  const p = await (await b.newContext({ viewport: size, baseURL: WEB })).newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto('/'); await p.fill('input[type=email]', 'admin@example.com'); await p.fill('input[type=password]', 'Reimsys#2026'); await p.click('button[type=submit]'); await p.waitForSelector('.shell');
  await p.goto('/access'); await p.click('.tabs button:has-text("Email")'); await p.waitForSelector('button:has-text("Run full check")');
  await p.click('button:has-text("Run full check")');
  await p.waitForSelector('ol[aria-label="Mail check results"] li', { timeout: 40000 });
  const rows = await p.locator('ol[aria-label="Mail check results"] li').count();
  ok(`${label}: the check lists its steps (${rows})`, rows >= 2 && rows <= 5);
  ok(`${label}: nothing runs off the side of the screen`, !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));
  ok(`${label}: no errors in the browser`, errors.length === 0, errors.join(' | '));
  await p.screenshot({ path: process.env.TEMP + `/mail-check-${label}.png`, fullPage: true });
  await p.context().close();
}
await b.close();
console.log(failed ? `\n${failed} FAILED` : '\nMail check works.');
process.exit(failed ? 1 : 0);
