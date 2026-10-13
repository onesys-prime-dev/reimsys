// End-to-end check of the full workflow against a running API (http://localhost:4000).
// Usage: node e2e/api-flow.mjs
const BASE = process.env.API ?? 'http://localhost:4000/api';
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
check('checker cannot submit', (await liza.post(`/receipts/${r.id}/submit`, { version: r.version })).status === 403);
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
d = (await paolo.post(`/receipts/${d.id}/disapprove`, { version: d.version, note: 'Not reimbursable.' })).data.receipt;
check('disapproved', d.status === 'disapproved');
const copy = await ana.post(`/receipts/${d.id}/copy`);
check('copy creates a new draft with evidence', copy.status === 201 && copy.data.receipt.status === 'draft' && copy.data.receipt.evidence.length === 1 && copy.data.receipt.refNo !== d.refNo);

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
check('report of another user is private', (await mark.req('GET', '/reports')).data.reports.length === 0);

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

console.log('\nDashboard and audit');
check('dashboard loads for every role', (await Promise.all([ana, liza, paolo, admin].map((c) => c.get('/dashboard')))).every((x) => x.status === 200));
check('checker queue is submitted receipts', (await liza.get('/dashboard')).data.queueTitle === 'Waiting to be checked');
const aud = (await admin.get(`/audit?q=${r.id}&pageSize=100`)).data;
check('audit browser finds receipt activity', aud.total > 5);
check('non-admin cannot read audit', (await ana.get('/audit')).status === 403);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
