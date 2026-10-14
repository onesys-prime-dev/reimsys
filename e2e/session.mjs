// Sign-in session rules, end to end. Usage: WEB=http://localhost:4000 node e2e/session.mjs <screenshot-dir>
// It works by moving a session's clock in the database, so nothing has to wait an hour.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const WEB = process.env.WEB ?? 'http://localhost:4000';
const API = WEB + '/api';
const out = path.resolve(process.argv[2] ?? 'storage/session');
fs.mkdirSync(out, { recursive: true });
let bad = 0;
const ok = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : x); if (!c) bad++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = (q) => execFileSync('C:/xampp/mysql/bin/mysql.exe', ['-u', 'root', 'reimsys', '-N', '-B', '-e', q], { encoding: 'utf8' }).trim();
const raw = async (m, p, { cookie = '', body, headers = {} } = {}) => { const r = await fetch(API + p, { method: m, headers: { origin: WEB, 'x-requested-with': 'reimsys', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, data: await r.json().catch(() => null), cookie: r.headers.get('set-cookie')?.split(';')[0] }; };
const email = 'mark.dc@example.com';
const sid = (cookie) => sql(`SELECT id FROM Session WHERE userId=(SELECT id FROM User WHERE email='${email}') AND revokedAt IS NULL ORDER BY createdAt DESC LIMIT 1`);
const expiry = (id) => new Date(sql(`SELECT DATE_FORMAT(expiresAt,'%Y-%m-%d %H:%i:%s.%f') FROM Session WHERE id='${id}'`).replace(' ', 'T') + 'Z').getTime();
const setExpiry = (id, secs) => sql(`UPDATE Session SET expiresAt = UTC_TIMESTAMP() + INTERVAL ${secs} SECOND, lastSeenAt = UTC_TIMESTAMP() - INTERVAL 2 MINUTE WHERE id='${id}'`);

console.log('Session rules on the server');
const login = await raw('POST', '/auth/login', { body: { email, password: 'Reimsys#2026' } });
const c = login.cookie, id = sid(c);
ok('signing in returns when the session ends and its overall limit', !!login.data.session && login.data.session.idleMinutes === 60 && Date.parse(login.data.session.maxAt) - Date.now() > 11.5 * 3600_000, JSON.stringify(login.data.session));
const startExp = expiry(id);
ok('a new session ends about an hour from now', Math.abs(startExp - Date.now() - 3600_000) < 90_000, String((startExp - Date.now()) / 60000));

setExpiry(id, 600); // pretend it has 10 minutes left
const e1 = expiry(id);
await raw('GET', '/me', { cookie: c });
await raw('GET', '/dashboard', { cookie: c });
await raw('GET', '/notifications', { cookie: c });
ok('the page quietly refreshing itself does NOT extend the session', expiry(id) === e1, `${e1} -> ${expiry(id)}`);
const me = await raw('GET', '/me', { cookie: c, headers: { 'x-user-activity': '1' } });
ok('a request that says a person is at the keyboard DOES extend it', expiry(id) > e1 + 30 * 60_000, `${(expiry(id) - e1) / 60000} min`);
ok('and the screen is told the new time', Date.parse(me.data.session.expiresAt) > e1);
setExpiry(id, 600); const e2 = expiry(id);
await raw('POST', '/auth/keepalive', { cookie: c, body: {} });
ok('"Stay signed in" extends it', expiry(id) > e2 + 30 * 60_000);
setExpiry(id, 600); const e3 = expiry(id);
await raw('POST', '/notifications/read', { cookie: c, body: {} });
ok('doing something (any change) extends it', expiry(id) > e3 + 30 * 60_000);

sql(`UPDATE Session SET expiresAt = UTC_TIMESTAMP() - INTERVAL 1 SECOND WHERE id='${id}'`);
ok('after the idle time the session is dead', (await raw('GET', '/me', { cookie: c })).status === 401);
ok('and so is every action', (await raw('POST', '/notifications/read', { cookie: c, body: {} })).status === 401);

const c2 = (await raw('POST', '/auth/login', { body: { email, password: 'Reimsys#2026' } })).cookie, id2 = sid(c2);
sql(`UPDATE Session SET createdAt = UTC_TIMESTAMP() - INTERVAL 13 HOUR, expiresAt = UTC_TIMESTAMP() + INTERVAL 50 MINUTE WHERE id='${id2}'`);
ok('a session older than 12 hours is dead even if it was busy a moment ago', (await raw('GET', '/me', { cookie: c2 })).status === 401);
const c3 = (await raw('POST', '/auth/login', { body: { email, password: 'Reimsys#2026' } })).cookie, id3 = sid(c3);
sql(`UPDATE Session SET createdAt = UTC_TIMESTAMP() - INTERVAL 11 HOUR - INTERVAL 59 MINUTE, expiresAt = UTC_TIMESTAMP() + INTERVAL 5 MINUTE, lastSeenAt = UTC_TIMESTAMP() - INTERVAL 5 MINUTE WHERE id='${id3}'`);
await raw('POST', '/auth/keepalive', { cookie: c3, body: {} });
const maxAt = new Date(sql(`SELECT DATE_FORMAT(createdAt + INTERVAL 12 HOUR,'%Y-%m-%d %H:%i:%s.%f') FROM Session WHERE id='${id3}'`).replace(' ', 'T') + 'Z').getTime();
ok('being active can never push a session past the overall limit', expiry(id3) <= maxAt + 1000, `${(expiry(id3) - maxAt) / 1000}s past`);
await raw('POST', '/auth/logout', { cookie: c3, body: {} });

/* ---- the live connection follows the session ---- */
console.log('\nThe live connection follows the session');
const c4 = (await raw('POST', '/auth/login', { body: { email, password: 'Reimsys#2026' } })).cookie, id4 = sid(c4);
const ctrl = new AbortController();
const stream = await fetch(API + '/events', { headers: { cookie: c4 }, signal: ctrl.signal });
let ended = false, told = false;
(async () => { const r = stream.body.getReader(); const d = new TextDecoder(); try { for (;;) { const { value, done } = await r.read(); if (done) break; if (/"scopes":\["me"\]/.test(d.decode(value))) told = true; } } catch { /* aborted */ } ended = true; })();
ok('a signed-in tab can listen', stream.status === 200);
sql(`UPDATE Session SET expiresAt = UTC_TIMESTAMP() - INTERVAL 1 SECOND WHERE id='${id4}'`);
console.log('  (waiting up to 40 seconds for the server\'s regular check…)');
const t0 = Date.now(); while (!ended && Date.now() - t0 < 40_000) await sleep(500);
ok('when the session times out, its live connection is closed', ended);
ok('after telling the screen to check who it is', told);
ctrl.abort();

/* ---- what a person sees ---- */
console.log('\nWhat a person sees');
const b = await chromium.launch({ channel: 'chrome' });
const errs = [];
const ctx = await b.newContext({ viewport: { width: 1180, height: 800 }, baseURL: WEB });
const p = await ctx.newPage();
p.on('pageerror', (e) => errs.push(String(e)));
p.on('console', (m) => m.type() === 'error' && !/40[0-9]/.test(m.text()) && errs.push(m.text()));
await p.goto('/'); await p.fill('input[type=email]', email); await p.fill('input[type=password]', 'Reimsys#2026'); await p.click('button[type=submit]'); await p.waitForSelector('.shell');
const sid5 = sid();
ok('there is no warning for someone who is just working', (await p.locator('text=Are you still there').count()) === 0);

// This person now walks away. After 50 quiet seconds the page no longer counts them as active.
const adminCookie = (await raw('POST', '/auth/login', { body: { email: 'admin@example.com', password: 'Reimsys#2026' } })).cookie;
const userId = sql(`SELECT id FROM User WHERE email='${email}'`);
// Telling the page "something about you changed" makes it re-read its own session time, without any activity from the person.
const nudge = () => raw('PATCH', `/users/${userId}`, { cookie: adminCookie, body: { phone: String(Date.now()).slice(-9) } });
console.log('  (sitting idle for 52 seconds…)');
await sleep(52_000);
setExpiry(sid5, 100);
await nudge();
await p.waitForSelector('text=Are you still there', { timeout: 30_000 });
ok('an idle person is asked "Are you still there?" before being signed out', true);
const cd = await p.locator('[data-testid=countdown]').innerText();
ok('with a countdown under two minutes', /^[01]:[0-9][0-9]$/.test(cd), cd);
await p.screenshot({ path: path.join(out, '1-warning.png') });
const before = expiry(sid5);
await p.click('button:has-text("Stay signed in")');
await p.waitForSelector('text=Are you still there', { state: 'detached', timeout: 10_000 });
ok('"Stay signed in" closes the warning', true);
ok('and really extends the session', expiry(sid5) > before + 30 * 60_000);

// walk away again and really let it run out
console.log('  (sitting idle for 62 seconds…)');
await sleep(62_000);
setExpiry(sid5, 6);
await nudge();
await p.waitForSelector('input[type=password]', { timeout: 60_000 });
ok('when time runs out the person is taken to the sign-in page', true);
ok('which explains why', (await p.locator('.callout:has-text("away for a while")').count()) === 1);
await p.screenshot({ path: path.join(out, '2-signed-out.png') });
await raw('PATCH', `/users/${userId}`, { cookie: adminCookie, body: { phone: null } });
ok('no browser errors', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
await b.close();
sql(`UPDATE Session SET revokedAt = UTC_TIMESTAMP() WHERE userId=(SELECT id FROM User WHERE email='${email}') AND revokedAt IS NULL`);
console.log(bad ? `\n${bad} FAILED` : '\nAll session checks passed');
process.exit(bad ? 1 : 0);
