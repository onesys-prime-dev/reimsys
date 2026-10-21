// Keeping records, phase 1: the preview must match the database exactly, list only FINISHED receipts older than the period, be limited to the people
// who manage settings, be written to the audit log, and change NOTHING. Needs the API (4000) and the MySQL tools of XAMPP.
// It backdates a few receipts for the test and puts every date and the setting back afterwards. Usage: node e2e/retention.mjs
import { execFileSync } from 'node:child_process';
const API = process.env.API ?? 'http://localhost:4000/api';
const MYSQL = process.env.MYSQL ?? 'C:/xampp/mysql/bin/mysql.exe';
let failed = 0, passed = 0;
const check = (n, c, x = '') => { if (c) { passed++; console.log('  ok  ', n); } else { failed++; console.log('  FAIL', n, x); } };
const sql = (q) => execFileSync(MYSQL, ['-uroot', '-N', '-B', 'reimsys', '-e', q], { encoding: 'utf8' }).trim();
const rows = (q) => sql(q).split('\n').filter(Boolean).map((l) => l.split('\t'));
const call = async (cookie, m, p, b, raw) => {
  const r = await fetch(API + p, { method: m, headers: { 'x-requested-with': 'reimsys', cookie, ...(b ? { 'content-type': 'application/json' } : {}) }, body: b ? JSON.stringify(b) : undefined });
  if (raw) return r;
  return { s: r.status, d: await r.json().catch(() => null), cookie: r.headers.get('set-cookie')?.split(';')[0] };
};
const login = async (email) => (await call('', 'POST', '/auth/login', { email, password: 'Reimsys#2026' })).cookie;
const admin = await login('admin@example.com');
const ana = await login('ana.reyes@example.com');
const cur = (await call(admin, 'GET', '/app-settings')).d.settings;

// ---- set up: a few finished receipts far in the past, one recent paid, and one approved-but-unpaid that is old too
const paid = rows("select id, paidAt from receipt where status='paid' order by id limit 4");
const dis = rows("select id, decidedAt from receipt where status='disapproved' order by id limit 2");
const approved = rows("select id, decidedAt from receipt where status='approved' order by id limit 1");
if (paid.length < 3 || dis.length < 1 || approved.length < 1) { console.log('Not enough receipts to test with (needs paid, disapproved and approved ones). Run node e2e/sample-data.mjs first.'); process.exit(2); }
const originals = { paid, dis, approved };
const undo = () => {
  for (const [id, v] of paid) sql(`update receipt set paidAt=${v === 'NULL' ? 'NULL' : `'${v}'`} where id=${id}`);
  for (const [id, v] of [...dis, ...approved]) sql(`update receipt set decidedAt=${v === 'NULL' ? 'NULL' : `'${v}'`} where id=${id}`);
};
const fingerprint = () => sql("select count(*), sum(id), sum(amount), group_concat(status order by id) from receipt");
try {
  sql(`update receipt set paidAt = now() - interval 20 month where id in (${paid.slice(0, 2).map((r) => r[0]).join(',')})`); // 2 old paid
  sql(`update receipt set paidAt = now() - interval 2 month where id = ${paid[2][0]}`); // 1 recent paid (not old enough)
  sql(`update receipt set decidedAt = now() - interval 30 month where id in (${dis.map((r) => r[0]).join(',')})`); // old disapproved
  sql(`update receipt set decidedAt = now() - interval 40 month where id = ${approved[0][0]}`); // old but NOT finished (approved, unpaid)

  console.log('Off by default');
  await call(admin, 'PUT', '/app-settings', { ...cur, retentionMonths: 0 });
  const off = await call(admin, 'GET', '/retention/preview');
  check('with the period at 0 the preview says it is off and lists nothing', off.s === 200 && off.d.enabled === false);

  console.log('\nThe preview matches the database');
  const before = fingerprint();
  const put = await call(admin, 'PUT', '/app-settings', { ...cur, retentionMonths: 12 });
  check('an administrator can set the keeping period', put.s === 200 && put.d.settings.retentionMonths === 12, JSON.stringify(put.d).slice(0, 120));
  const pv = await call(admin, 'GET', '/retention/preview');
  const expectPaid = Number(sql("select count(*) from receipt where status='paid' and paidAt < now() - interval 12 month"));
  const expectDis = Number(sql("select count(*) from receipt where status='disapproved' and decidedAt < now() - interval 12 month"));
  check(`the paid count matches the database (${expectPaid})`, pv.d.byStatus?.paid?.count === expectPaid, JSON.stringify(pv.d.byStatus));
  check(`the disapproved count matches the database (${expectDis})`, (pv.d.byStatus?.disapproved?.count ?? 0) === expectDis, JSON.stringify(pv.d.byStatus));
  check('the total is the two added together', pv.d.total === expectPaid + expectDis, String(pv.d.total));
  const expectAmount = Number(sql("select coalesce(sum(amount),0) from receipt where (status='paid' and paidAt < now() - interval 12 month) or (status='disapproved' and decidedAt < now() - interval 12 month)"));
  check(`the amount matches the database (${expectAmount})`, Math.abs(pv.d.totalAmount - expectAmount) < 0.005, String(pv.d.totalAmount));
  check('the months add up to the total', pv.d.byMonth.reduce((n, m) => n + m.count, 0) === pv.d.total);
  check('the months are in order, oldest first', pv.d.byMonth.every((m, i, a) => i === 0 || a[i - 1].month <= m.month));
  check('an old approved-but-unpaid receipt is NOT listed', !(pv.d.byStatus?.approved), JSON.stringify(pv.d.byStatus));
  check('the recent paid receipt is not listed', pv.d.total === expectPaid + expectDis);
  const expectFiles = Number(sql("select count(*) from receiptevidence where receiptId in (select id from receipt where (status='paid' and paidAt < now() - interval 12 month) or (status='disapproved' and decidedAt < now() - interval 12 month))"));
  check(`the file count matches the database (${expectFiles})`, pv.d.files.count === expectFiles, JSON.stringify(pv.d.files));
  check('it says plainly that nothing is deleted', /nothing is deleted/i.test(pv.d.note));

  console.log('\nThe list');
  const csv = await call(admin, 'GET', '/retention/preview.csv', undefined, true);
  const text = await csv.text();
  const lines = text.trim().split(/\r?\n/);
  check('the CSV has a header and one line per listed receipt', csv.status === 200 && lines.length === 1 + pv.d.total, `${lines.length} lines`);
  check('the CSV only contains paid or disapproved receipts', lines.slice(1).every((l) => /,(paid|disapproved),/.test(l)));

  console.log('\nOnly administrators; everything recorded; nothing changed');
  check('a Med Ref cannot see the preview', (await call(ana, 'GET', '/retention/preview')).s === 403);
  check('a Med Ref cannot download the list', (await call(ana, 'GET', '/retention/preview.csv', undefined, true)).status === 403);
  check('signed-out people cannot see it', (await call('', 'GET', '/retention/preview')).s === 401);
  const aud = await call(admin, 'GET', '/audit?action=retention.&pageSize=10');
  check('previewing and downloading are written to the audit log', ['retention.previewed', 'retention.exported'].every((a) => (aud.d?.items ?? []).some((x) => x.action === a)), JSON.stringify((aud.d?.items ?? []).map((x) => x.action)));
  check('no receipt was changed, hidden or deleted by any of it', fingerprint() === before);
} finally {
  undo();
  await call(admin, 'PUT', '/app-settings', { ...cur, retentionMonths: cur.retentionMonths ?? 0 });
}
const restored = { paid: rows(`select id, paidAt from receipt where id in (${originals.paid.map((r) => r[0]).join(',')}) order by id`), dis: rows(`select id, decidedAt from receipt where id in (${originals.dis.map((r) => r[0]).join(',')}) order by id`) };
check('the dates changed for the test are put back', JSON.stringify(restored.paid) === JSON.stringify(originals.paid) && JSON.stringify(restored.dis) === JSON.stringify(originals.dis));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
