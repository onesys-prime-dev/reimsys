// End-to-end check of the full workflow against a running API (http://localhost:4000).
// Usage: node e2e/api-flow.mjs
const BASE = process.env.API ?? 'http://localhost:4000/api';
import { execFileSync } from 'node:child_process';
const PASSWORD = 'Reimsis#2026';
let failed = 0, passed = 0;

function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ok  ', name); } else { failed++; console.log('  FAIL', name, extra); }
}

class Client {
  constructor(email) { this.email = email; this.cookie = ''; }
  async req(method, path, body, { raw = false } = {}) {
    const headers = { 'x-requested-with': 'reimsis', cookie: this.cookie };
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(BASE + path, { method, headers, body: payload, redirect: 'manual' });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    if (raw) return res;
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  }
  get(p) { return this.req('GET', p); }
  post(p, b) { return this.req('POST', p, b ?? {}); }
  async login() { const r = await this.post('/auth/login', { email: this.email, password: PASSWORD }); if (r.status !== 200) throw new Error('login failed for ' + this.email + ' ' + JSON.stringify(r.data)); }
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const png = (tag) => { const b = Buffer.concat([PNG, Buffer.from(String(tag))]); return new Blob([b], { type: 'image/png' }); };
const form = (name, blob) => { const f = new FormData(); f.append('files', blob, name); return f; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000) { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(500); } return null; }

const ana = new Client('ana.reyes@example.com');
const mark = new Client('mark.dc@example.com');
const liza = new Client('liza.santos@example.com');
const paolo = new Client('paolo.v@example.com');
const admin = new Client('admin@example.com');
for (const c of [ana, mark, liza, paolo, admin]) await c.login();

const cats = (await ana.get('/categories')).data.categories;
const med = cats.find((c) => c.name === 'Medicine').id;
const stamp = Date.now();

console.log('\nMed Ref encodes and submits');
let r = (await ana.post('/receipts', { payee: 'Test Pharmacy ' + stamp, receiptDate: '2026-10-12', amount: 1284.5, categoryId: med, description: 'flow test' })).data.receipt;
check('draft created', r.status === 'draft' && /^RC-\d{4}-\d{6}$/.test(r.refNo), r.refNo);
check('future date rejected', (await ana.post('/receipts', { payee: 'X Y', receiptDate: '2999-01-01', amount: 5, categoryId: med })).status === 400);
check('zero amount rejected', (await ana.post('/receipts', { payee: 'X Y', receiptDate: '2026-10-12', amount: 0, categoryId: med })).status === 400);
check('submit without evidence blocked', (await ana.post(`/receipts/${r.id}/submit`, { version: r.version })).data?.error?.code === 'NO_EVIDENCE');
let up = await ana.req('POST', `/receipts/${r.id}/evidence`, form('receipt.png', png('a')));
check('png uploaded', up.status === 201 && up.data.receipt.evidence.length === 1, JSON.stringify(up.data));
const textFile = new FormData(); textFile.append('files', new Blob(['not an image at all, just text'], { type: 'image/png' }), 'fake.png');
check('fake image rejected (signature check)', (await ana.req('POST', `/receipts/${r.id}/evidence`, textFile)).data?.error?.code === 'BAD_FILE');
check('duplicate file rejected', (await ana.req('POST', `/receipts/${r.id}/evidence`, form('again.png', png('a')))).data?.error?.code === 'DUPLICATE_FILE');
r = up.data.receipt;
check('mark cannot see ana receipt', (await mark.get(`/receipts/${r.id}`)).status === 404);
check('approver cannot see submitted-stage receipt yet', (await paolo.get(`/receipts/${r.id}`)).status === 404);
check('checker cannot see or submit a draft that is not theirs', (await liza.get(`/receipts/${r.id}`)).status === 404 && (await liza.post(`/receipts/${r.id}/submit`, { version: r.version })).status === 404);
let s = await ana.post(`/receipts/${r.id}/submit`, { version: r.version });
check('submitted', s.status === 200 && s.data.receipt.status === 'submitted', JSON.stringify(s.data));
r = s.data.receipt;
check('evidence locked after submit', (await ana.req('POST', `/receipts/${r.id}/evidence`, form('late.png', png('b')))).data?.error?.code === 'INVALID_STATE');
check('edit locked after submit', (await ana.req('PATCH', `/receipts/${r.id}`, { payee: 'Changed Name', receiptDate: '2026-10-12', amount: 5, categoryId: med })).status === 409);

console.log('\nChecker reviews');
check('checker sees it', (await liza.get(`/receipts/${r.id}`)).status === 200);
check('check blocked until evidence viewed', (await liza.post(`/receipts/${r.id}/check`, { version: r.version })).data?.error?.code === 'EVIDENCE_NOT_VIEWED');
const evId = r.evidence[0].id;
const view = await liza.req('GET', `/receipts/${r.id}/evidence/${evId}/file?mode=view`, undefined, { raw: true });
check('evidence streamed with image type', view.status === 200 && view.headers.get('content-type') === 'image/png');
check('return needs a note', (await liza.post(`/receipts/${r.id}/return`, { version: r.version })).data?.error?.code === 'NOTE_REQUIRED');
s = await liza.post(`/receipts/${r.id}/return`, { version: r.version, note: 'Photo is too small, please retake.' });
check('returned', s.data.receipt?.status === 'returned', JSON.stringify(s.data));
r = (await ana.get(`/receipts/${r.id}`)).data.receipt;
check('med ref sees return note', r.lastNote === 'Photo is too small, please retake.' && r.canEdit);
up = await ana.req('POST', `/receipts/${r.id}/evidence`, form('retake.png', png('c')));
check('can add evidence while returned', up.status === 201);
r = up.data.receipt;
s = await ana.post(`/receipts/${r.id}/submit`, { version: r.version });
check('resubmitted', s.data.receipt?.status === 'submitted');
r = s.data.receipt;
check('stale view does not count after resubmit', (await liza.post(`/receipts/${r.id}/check`, { version: r.version })).data?.error?.code === 'EVIDENCE_NOT_VIEWED');
await liza.req('GET', `/receipts/${r.id}/evidence/${r.evidence[1].id}/file?mode=view`, undefined, { raw: true });
check('stale version rejected', (await liza.post(`/receipts/${r.id}/check`, { version: r.version - 1 })).status === 409);
s = await liza.post(`/receipts/${r.id}/check`, { version: r.version, note: 'Matches the receipt.' });
check('checked', s.data.receipt?.status === 'checked', JSON.stringify(s.data));
r = s.data.receipt;

console.log('\nApprover decides');
check('approver sees checked receipt', (await paolo.get(`/receipts/${r.id}`)).status === 200);
check('checker cannot approve', (await liza.post(`/receipts/${r.id}/approve`, { version: r.version })).status === 403);
check('med ref cannot approve', (await ana.post(`/receipts/${r.id}/approve`, { version: r.version })).status === 403);
check('reserve needs a note', (await paolo.post(`/receipts/${r.id}/reserve`, { version: r.version })).data?.error?.code === 'NOTE_REQUIRED');
check('approver must open the evidence before deciding', (await paolo.post(`/receipts/${r.id}/approve`, { version: r.version })).data?.error?.code === 'EVIDENCE_NOT_VIEWED');
await paolo.req('GET', `/receipts/${r.id}/evidence/${r.evidence[0].id}/file?mode=view`, undefined, { raw: true });
s = await paolo.post(`/receipts/${r.id}/reserve`, { version: r.version, note: 'Waiting for the regional office.' });
check('reserved', s.data.receipt?.status === 'reserved', JSON.stringify(s.data));
r = s.data.receipt;
s = await paolo.post(`/receipts/${r.id}/release`, { version: r.version });
check('released to checked', s.data.receipt?.status === 'checked');
r = s.data.receipt;
s = await paolo.post(`/receipts/${r.id}/approve`, { version: r.version, note: 'Approved.' });
check('approved with document number', s.data.receipt?.status === 'approved' && /^REIM-\d{4}-\d{6}$/.test(s.data.receipt.document?.docNo ?? ''), JSON.stringify(s.data));
r = s.data.receipt;
check('approved is final', (await paolo.post(`/receipts/${r.id}/disapprove`, { version: r.version, note: 'x' })).data?.error?.code === 'INVALID_STATE');

console.log('\nDocument and notifications');
const doc = await until(async () => { const d = (await ana.get(`/receipts/${r.id}`)).data.receipt.document; return d?.status === 'ready' ? d : null; });
check('document generated by the worker', !!doc);
if (doc) {
  const pdf = await ana.req('GET', `/documents/${doc.id}/file?mode=download`, undefined, { raw: true });
  const buf = Buffer.from(await pdf.arrayBuffer());
  check('document is a real PDF', pdf.status === 200 && buf.subarray(0, 5).toString() === '%PDF-' && buf.length > 1500, `${pdf.status} ${buf.length}`);
}
{ const h = (await ana.get(`/receipts/${r.id}/history`)).data.items;
  check('history hides the owner looking at their own photo', !h.some((x) => x.action === 'evidence.viewed' && x.actor === 'Ana Reyes'));
  const before = (await ana.get('/notifications')).data.unread;
  await ana.post('/notifications/read', { receiptId: r.id });
  const after = (await ana.get('/notifications')).data;
  check('opening a receipt clears its notifications only', after.unread < before && after.items.filter((n) => n.receiptId === r.id).every((n) => n.read), `${before} -> ${after.unread}`); }
const notes = (await ana.get('/notifications')).data;
check('med ref notified of return, hold and approval', ['receipt.returned', 'receipt.reserved', 'receipt.approved'].every((t) => notes.items.some((n) => n.type === t && n.text.includes(r.refNo))));
const emails = (await admin.get('/email-log')).data;
check('emails queued and logged', emails.items.some((e) => e.template === 'approved') && emails.items.some((e) => e.template === 'returned'));
const hist = (await ana.get(`/receipts/${r.id}/history`)).data.items;
check('history has the whole story', ['receipt.submit', 'receipt.check', 'receipt.return', 'receipt.reserve', 'receipt.release', 'receipt.approve', 'evidence.viewed'].every((a) => hist.some((h) => h.action === a)));

console.log('\nDisapprove and copy');
let d = (await ana.post('/receipts', { payee: 'Disapprove Me ' + stamp, receiptDate: '2026-10-11', amount: 300, categoryId: med })).data.receipt;
d = (await ana.req('POST', `/receipts/${d.id}/evidence`, form('d.png', png('d')))).data.receipt;
d = (await ana.post(`/receipts/${d.id}/submit`, { version: d.version })).data.receipt;
await liza.req('GET', `/receipts/${d.id}/evidence/${d.evidence[0].id}/file?mode=view`, undefined, { raw: true });
d = (await liza.post(`/receipts/${d.id}/check`, { version: d.version })).data.receipt;
check('disapprove needs a reason', (await paolo.post(`/receipts/${d.id}/disapprove`, { version: d.version })).data?.error?.code === 'NOTE_REQUIRED');
await paolo.req('GET', `/receipts/${d.id}/evidence/${d.evidence[0].id}/file?mode=view`, undefined, { raw: true });
d = (await paolo.post(`/receipts/${d.id}/disapprove`, { version: d.version, note: 'Not reimbursable.' })).data.receipt;
check('disapproved', d.status === 'disapproved');
const copy = await ana.post(`/receipts/${d.id}/copy`);
check('copy creates a new draft with evidence', copy.status === 201 && copy.data.receipt.status === 'draft' && copy.data.receipt.evidence.length === 1 && copy.data.receipt.refNo !== d.refNo);

console.log('\nWithdraw, delete a draft, duplicate warning');
const wName = 'Withdraw Test ' + stamp;
const mk = async (name = wName) => {
  let x = (await ana.post('/receipts', { payee: name, receiptDate: '2026-10-12', amount: 77.7, categoryId: med })).data.receipt;
  x = (await ana.req('POST', `/receipts/${x.id}/evidence`, form('w.png', png('w' + Math.random())))).data.receipt;
  return x;
};
let w1 = await mk();
let w2 = await mk();
check('a second receipt with the same payee, amount and date shows a duplicate warning', ((await ana.get(`/receipts/${w2.id}`)).data.receipt.possibleDuplicates ?? []).some((x) => x.id === w1.id));
check('a different amount is not flagged', ((await ana.post('/receipts', { payee: wName, receiptDate: '2026-10-12', amount: 78, categoryId: med })).data.receipt.possibleDuplicates ?? []).length === 0);
check('the other Med Ref does not see it as a duplicate (they cannot see it)', (((await mark.post('/receipts', { payee: wName, receiptDate: '2026-10-12', amount: 77.7, categoryId: med })).data.receipt).possibleDuplicates ?? []).length === 0);
w1 = (await ana.post(`/receipts/${w1.id}/submit`, { version: w1.version })).data.receipt;
check('checker sees the submitted receipt', (await liza.get(`/receipts/${w1.id}`)).status === 200);
check('the checker cannot withdraw it', (await liza.post(`/receipts/${w1.id}/withdraw`, { version: w1.version })).status === 403);
check('another Med Ref cannot withdraw it', (await mark.post(`/receipts/${w1.id}/withdraw`, { version: w1.version })).status === 404);
const wd = await ana.post(`/receipts/${w1.id}/withdraw`, { version: w1.version, note: 'Wrong photo' });
check('the owner withdraws it back to draft', wd.data.receipt?.status === 'draft' && wd.data.receipt.canEdit, JSON.stringify(wd.data));
check('the checker can no longer see it', (await liza.get(`/receipts/${w1.id}`)).status === 404);
check('the withdrawal is in the history', ((await ana.get(`/receipts/${w1.id}/history`)).data.items).some((h) => h.action === 'receipt.withdraw'));
w1 = wd.data.receipt;
w1 = (await ana.post(`/receipts/${w1.id}/submit`, { version: w1.version })).data.receipt;
await liza.req('GET', `/receipts/${w1.id}/evidence/${w1.evidence[0].id}/file?mode=view`, undefined, { raw: true });
w1 = (await liza.post(`/receipts/${w1.id}/check`, { version: w1.version })).data.receipt;
check('once checked it can no longer be withdrawn', (await ana.post(`/receipts/${w1.id}/withdraw`, { version: w1.version })).data?.error?.code === 'INVALID_STATE');
check('a checked receipt cannot be deleted either', (await ana.req('DELETE', `/receipts/${w1.id}`)).data?.error?.code === 'INVALID_STATE');
check('another Med Ref cannot delete someone else\'s draft', (await mark.req('DELETE', `/receipts/${w2.id}`)).status === 404);
check('the checker cannot delete a draft', (await liza.req('DELETE', `/receipts/${w2.id}`)).status === 403 || (await liza.req('DELETE', `/receipts/${w2.id}`)).status === 404);
const del = await ana.req('DELETE', `/receipts/${w2.id}`);
check('the owner deletes their own draft', del.status === 200 && del.data?.ok === true, JSON.stringify(del.data));
check('a deleted draft is gone', (await ana.get(`/receipts/${w2.id}`)).status === 404);
check('the deletion was audited', ((await admin.get(`/audit?q=${w2.id}&pageSize=50`)).data.items).some((a) => a.action === 'receipt.deleted'));

console.log('\nReports (approved only)');
const prev = (await ana.req('GET', '/reports/preview?from=2026-10-01&to=2026-10-31')).data;
check('preview counts approved only', prev.count >= 1);
for (const format of ['csv', 'xlsx', 'pdf']) {
  const rep = await ana.post('/reports', { from: '2026-10-01', to: '2026-10-31', format });
  const ready = await until(async () => { const l = (await ana.get('/reports')).data.reports.find((x) => x.id === rep.data.report.id); return l?.status === 'ready' ? l : (l?.status === 'failed' ? l : null); });
  check(`${format} report generated`, ready?.status === 'ready', JSON.stringify(ready));
  if (ready?.status === 'ready') {
    const f = await ana.req('GET', `/reports/${ready.id}/file`, undefined, { raw: true });
    const b = Buffer.from(await f.arrayBuffer());
    const magic = format === 'pdf' ? b.subarray(0, 5).toString() === '%PDF-' : format === 'xlsx' ? b.subarray(0, 2).toString() === 'PK' : b.toString('utf8').includes('Document no.');
    check(`${format} file content is valid`, f.status === 200 && magic);
    if (format === 'csv') check('csv has the approved receipt but not the disapproved one', b.toString().includes(r.refNo) && !b.toString().includes(d.refNo));
  }
}
check('reports of other people are private', (await mark.req('GET', '/reports')).data.reports.every((x) => x.requestedBy === 'Mark Dela Cruz'));

console.log('\nImport and export');
const csv = `payee,receipt_date,amount,category,description\nImport Store A ${stamp},2026-10-10,150.25,Medicine,ok\nImport Store B,2026-10-10,abc,Medicine,bad amount\nImport Store C,2026-10-10,99,Nonsense,bad category\n`;
const imf = new FormData(); imf.append('file', new Blob([csv], { type: 'text/csv' }), 'import.csv');
const pv = await ana.req('POST', '/imports', imf);
check('import preview finds 1 valid and 2 bad rows', pv.status === 201 && pv.data.validRows === 1 && pv.data.errorCount === 2, JSON.stringify(pv.data));
const cf = await ana.post(`/imports/${pv.data.id}/confirm`);
check('import creates drafts only for valid rows', cf.data?.created === 1);
check('import cannot be confirmed twice', (await ana.post(`/imports/${pv.data.id}/confirm`)).status === 409);
check('checker cannot import', (await liza.post('/imports')).status === 403);
const ex = await ana.req('GET', '/receipts/export?format=csv', undefined, { raw: true });
check('export contains imported row', (await ex.text()).includes('Import Store A ' + stamp));

console.log('\nUndo a decision, comments, bulk actions');
{
  const mk = async (who, tag, amount = 100) => {
    let x = (await who.post('/receipts', { payee: `${tag} ${stamp}`, receiptDate: '2026-10-11', amount, categoryId: med })).data.receipt;
    x = (await who.req('POST', `/receipts/${x.id}/evidence`, form('n.png', png(tag + stamp + Math.random())))).data.receipt;
    return (await who.post(`/receipts/${x.id}/submit`, { version: x.version })).data.receipt;
  };
  const view = (who, x) => who.req('GET', `/receipts/${x.id}/evidence/${x.evidence[0].id}/file?mode=view`, undefined, { raw: true });
  const mysql = (q) => execFileSync('C:/xampp/mysql/bin/mysql.exe', ['-u', 'root', 'reimsis', '-N', '-B', '-e', q], { encoding: 'utf8' });

  /* ---- undo ---- */
  let u = await mk(ana, 'Undo Me');
  await view(liza, u); u = (await liza.post(`/receipts/${u.id}/check`, { version: u.version })).data.receipt;
  await view(paolo, u); u = (await paolo.post(`/receipts/${u.id}/approve`, { version: u.version, note: 'ok' })).data.receipt;
  check('the decider is offered undo right after approving', u.actions.some((a) => a.action === 'undo') && !!u.undoUntil);
  check('nobody else is offered undo', !(await liza.get(`/receipts/${u.id}`)).data.receipt.actions.some((a) => a.action === 'undo') && (await ana.get(`/receipts/${u.id}`)).data.receipt.undoUntil === null);
  check('undo needs a reason', (await paolo.post(`/receipts/${u.id}/undo`, { version: u.version })).data?.error?.code === 'NOTE_REQUIRED');
  check('the Med Ref cannot undo', (await ana.post(`/receipts/${u.id}/undo`, { version: u.version, note: 'please' })).status === 403);
  check('a checker cannot undo', (await liza.post(`/receipts/${u.id}/undo`, { version: u.version, note: 'please' })).status === 403);
  await until(async () => (await ana.get(`/receipts/${u.id}`)).data.receipt.document?.status === 'ready');
  const docs = mysql(`SELECT COUNT(*) FROM ReimbursementDocument WHERE receiptId=${u.id}`).trim();
  const undone = await paolo.post(`/receipts/${u.id}/undo`, { version: u.version, note: 'Approved by mistake.' });
  check('the decider can take an approval back', undone.data.receipt?.status === 'checked', JSON.stringify(undone.data));
  check('the reimbursement document is removed with it', docs === '1' && mysql(`SELECT COUNT(*) FROM ReimbursementDocument WHERE receiptId=${u.id}`).trim() === '0');
  check('the decision details are cleared', undone.data.receipt.decidedBy === null && undone.data.receipt.lastNote === null);
  u = undone.data.receipt;
  check('it can be decided again, and gets a new document', (await paolo.post(`/receipts/${u.id}/approve`, { version: u.version })).data.receipt?.document?.docNo !== undefined);

  let w = await mk(ana, 'Undo Late');
  await view(liza, w); w = (await liza.post(`/receipts/${w.id}/check`, { version: w.version })).data.receipt;
  await view(paolo, w); w = (await paolo.post(`/receipts/${w.id}/disapprove`, { version: w.version, note: 'No.' })).data.receipt;
  mysql(`UPDATE Receipt SET decidedAt = UTC_TIMESTAMP() - INTERVAL 11 MINUTE WHERE id=${w.id}`);
  const late = await paolo.post(`/receipts/${w.id}/undo`, { version: w.version, note: 'Too slow.' });
  check('undo is refused after ten minutes', late.data?.error?.code === 'UNDO_EXPIRED', JSON.stringify(late.data));
  check('and the button is gone', !(await paolo.get(`/receipts/${w.id}`)).data.receipt.actions.some((a) => a.action === 'undo'));
  mysql(`UPDATE Receipt SET decidedAt = UTC_TIMESTAMP() WHERE id=${w.id}`);
  const fresh = (await paolo.get(`/receipts/${w.id}`)).data.receipt;
  const dis = await paolo.post(`/receipts/${w.id}/undo`, { version: fresh.version, note: 'Wrong receipt.' });
  check('a disapproval can be taken back too', dis.data.receipt?.status === 'checked', JSON.stringify(dis.data));
  const mails = mysql(`SELECT COUNT(*) FROM EmailLog WHERE subject LIKE 'Correction:%' AND createdAt > UTC_TIMESTAMP() - INTERVAL 5 MINUTE`).trim();
  check('the Med Ref and checker were sent a correction email', Number(mails) >= 2, mails);

  /* ---- comments ---- */
  let c = await mk(ana, 'Comment On');
  check('a comment needs some text', (await ana.post(`/receipts/${c.id}/comments`, { body: '   ' })).status === 400);
  check('a comment cannot be huge', (await ana.post(`/receipts/${c.id}/comments`, { body: 'x'.repeat(1001) })).status === 400);
  const posted = await liza.post(`/receipts/${c.id}/comments`, { body: 'Is this the full receipt?' });
  check('a checker can comment', posted.status === 201 && posted.data.comment.mine === true);
  const list = (await ana.get(`/receipts/${c.id}/comments`)).data.comments;
  check('the Med Ref sees it, and it is not marked as theirs', list.length === 1 && list[0].mine === false && list[0].author.name === 'Liza Santos');
  const heard = (await ana.get('/notifications')).data.items.find((n) => n.receiptId === c.id && /commented/.test(n.text));
  check('the Med Ref gets a bell notice', !!heard, JSON.stringify(heard));
  check('the writer does not notify themselves', !(await liza.get('/notifications')).data.items.some((n) => n.receiptId === c.id && /commented/.test(n.text)));
  await ana.post(`/receipts/${c.id}/comments`, { body: 'Yes, both pages are attached.' });
  check('a reply reaches the checker', (await liza.get('/notifications')).data.items.some((n) => n.receiptId === c.id && /commented/.test(n.text)));
  check('markup in a comment is stored as plain text', (await ana.post(`/receipts/${c.id}/comments`, { body: '<img src=x onerror=alert(1)>' })).data.comment.body === '<img src=x onerror=alert(1)>');
  check('someone who cannot see the receipt cannot read or write comments', (await mark.get(`/receipts/${c.id}/comments`)).status === 404 && (await mark.post(`/receipts/${c.id}/comments`, { body: 'hi' })).status === 404);
  check('comments appear in the audit log', (await admin.get(`/audit?q=commented&pageSize=5`)).data.items.some((a) => a.entityId === String(c.id)));

  /* ---- bulk ---- */
  const b1 = await mk(ana, 'Bulk One'), b2 = await mk(ana, 'Bulk Two'), b3 = await mk(ana, 'Bulk Three');
  await view(liza, b1); await view(liza, b2); // b3 deliberately not opened
  const bulk = await liza.post('/receipts/bulk', { action: 'check', ids: [b1.id, b2.id, b3.id], note: 'Bulk checked.' });
  check('bulk check does the ones whose evidence was opened', bulk.data.done === 2 && bulk.data.skipped === 1, JSON.stringify(bulk.data));
  check('and explains the one it skipped', /evidence/i.test(bulk.data.results.find((x) => x.id === b3.id)?.message ?? ''));
  check('the checked ones are really checked', (await liza.get(`/receipts/${b1.id}`)).data.receipt.status === 'checked' && (await liza.get(`/receipts/${b3.id}`)).data.receipt.status === 'submitted');
  check('the remark was applied to each', (await liza.get(`/receipts/${b2.id}`)).data.receipt.checkNote === 'Bulk checked.');
  check('an approver cannot bulk check', (await paolo.post('/receipts/bulk', { action: 'check', ids: [b3.id] })).data.results?.[0]?.ok !== true);
  check('bulk needs at least one receipt', (await liza.post('/receipts/bulk', { action: 'check', ids: [] })).status === 400);
  check('bulk is limited to 25 at a time', (await liza.post('/receipts/bulk', { action: 'check', ids: Array.from({ length: 26 }, (_, i) => i + 1) })).status === 400);
  check('only check and approve are allowed in bulk', (await liza.post('/receipts/bulk', { action: 'disapprove', ids: [b1.id] })).status === 400);
  await view(paolo, b1);
  const ap = await paolo.post('/receipts/bulk', { action: 'approve', ids: [b1.id, b2.id, b3.id] });
  check('bulk approve approves only what the approver opened and what was checked', ap.data.done === 1 && ap.data.skipped === 2, JSON.stringify(ap.data));
  check('an unchecked receipt cannot be approved in bulk', ap.data.results.find((x) => x.id === b3.id)?.ok === false);
  check('a Med Ref cannot bulk anything', (await ana.post('/receipts/bulk', { action: 'check', ids: [b3.id] })).data.results?.every((x) => !x.ok));
  check('bulk runs are in the audit log', (await admin.get('/audit?q=receipt.bulk&pageSize=3')).data.items.length > 0);
}

{ const get = async (q) => (await liza.get('/receipts?pageSize=50&' + q)).data.items;
  const hi = await get('sort=amount_high'), lo = await get('sort=amount_low'), nw = await get('sort=newest'), old = await get('sort=oldest');
  const sorted = (a, f, dir) => a.every((x, i) => i === 0 || (dir > 0 ? f(a[i - 1]) >= f(x) : f(a[i - 1]) <= f(x)));
  check('list sorts by amount, high to low', hi.length > 1 && sorted(hi, (x) => x.amount, 1));
  check('list sorts by amount, low to high', sorted(lo, (x) => x.amount, -1));
  check('list sorts by receipt date, newest first', sorted(nw, (x) => x.receiptDate, 1));
  check('list sorts by receipt date, oldest first', sorted(old, (x) => x.receiptDate, -1));
  check('an unknown sort is refused', (await liza.get('/receipts?sort=bogus')).status === 400); }

console.log('\nDashboard and audit');
check('dashboard loads for every role', (await Promise.all([ana, liza, paolo, admin].map((c) => c.get('/dashboard')))).every((x) => x.status === 200));
check('checker queue is submitted receipts', (await liza.get('/dashboard')).data.queueTitle === 'Waiting to be checked');
const aud = (await admin.get(`/audit?q=${r.id}&pageSize=100`)).data;
check('audit browser finds receipt activity', aud.total > 5);
check('non-admin cannot read audit', (await ana.get('/audit')).status === 403);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
