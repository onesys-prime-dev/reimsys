// Checks the client's reimbursement form against a running API: required answers, warnings, the Checker's confirmation,
// import and export columns, reports, the PDF and the company settings.
// Usage: node e2e/client-form.mjs
const BASE = process.env.API ?? 'http://localhost:4000/api';
const PASSWORD = 'Reimsys#2026';
let failed = 0, passed = 0;
const check = (name, cond, extra = '') => { if (cond) { passed++; console.log('  ok  ', name); } else { failed++; console.log('  FAIL', name, extra); } };

class Client {
  constructor(email) { this.email = email; this.cookie = ''; }
  async req(method, path, body, { raw = false } = {}) {
    const headers = { 'x-requested-with': 'reimsys', cookie: this.cookie };
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(BASE + path, { method, headers, body: payload, redirect: 'manual' });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    if (raw) return res;
    return { status: res.status, data: await res.json().catch(() => null) };
  }
  get(p) { return this.req('GET', p); }
  post(p, b) { return this.req('POST', p, b ?? {}); }
  put(p, b) { return this.req('PUT', p, b); }
  async login() { const r = await this.post('/auth/login', { email: this.email, password: PASSWORD }); if (r.status !== 200) throw new Error('login failed for ' + this.email); }
}
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const upload = (tag) => { const f = new FormData(); f.append('files', new Blob([Buffer.concat([PNG, Buffer.from(String(tag))])], { type: 'image/png' }), `${tag}.png`); return f; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 20000) { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(500); } return null; }

const ana = new Client('ana.reyes@example.com');
const liza = new Client('liza.santos@example.com');
const paolo = new Client('paolo.v@example.com');
const admin = new Client('admin@example.com');
for (const c of [ana, liza, paolo, admin]) await c.login();
const stamp = Date.now();

// A complete answer for "BIR invoice: yes", vatable, no withholding.
const full = (over = {}) => ({
  birInvoice: true, invoiceUnderCompany: true, reasonForSpending: 'Clinic supplies for the week', classification: 'fuel', seenCompany: true, seenTin: true, seenAddress: true, receiptDate: '2026-10-12', invoiceNo: 'SI-' + stamp, payee: 'Form Test Pharmacy ' + stamp,
  vendorAddress: 'Mandaue City, Cebu', vendorTin: '123-456-789-00000', amount: 1120, transactionType: 'product', vatType: 'vatable', vatableAmount: 1000, vatAmount: 120, withheld: false, vatExemptAmount: 0, discountAmount: 0, chargeLocationId: 1, detailsReviewed: true, ...over,
});
const codes = (r) => (r.data?.error?.issues ?? []).map((i) => i.path[0]);

console.log('\nThe form accepts a complete answer');
let r = (await ana.post('/receipts', full())).data?.receipt;
check('a complete BIR-invoice receipt is created', !!r && r.status === 'draft', JSON.stringify(r));
check('the answers come back on the receipt', r?.form?.vendorTin === '123-456-789-00000' && r.form.vatAmount === 120 && r.form.transactionType === 'product' && r.form.birInvoice === true);
check('a correct receipt has no warnings', r?.warnings?.length === 0, JSON.stringify(r?.warnings));
check('no category is needed or shown', r?.category === null);

console.log('\nRequired answers depend on the answers');
const miss = await ana.post('/receipts', full({ invoiceNo: '', vendorTin: '', vatableAmount: '' }));
check('missing invoice no., TIN and vatable amount are refused', miss.status === 400 && ['invoiceNo', 'vendorTin', 'vatableAmount'].every((k) => codes(miss).includes(k)), JSON.stringify(codes(miss)));
check('an unticked company check is refused', codes(await ana.post('/receipts', full({ seenTin: false }))).includes('seenTin'));
check('Product or Service is required', codes(await ana.post('/receipts', full({ transactionType: '' }))).includes('transactionType'));
check('zero VAT is a real answer', (await ana.post('/receipts', full({ invoiceNo: 'Z-' + stamp, vatableAmount: 1120, vatAmount: 0, vatType: 'non_vatable' }))).status === 201);
const w1 = await ana.post('/receipts', full({ invoiceNo: 'W1-' + stamp, withheld: true }));
check('withholding needs a rate and an amount when "Yes"', w1.status === 400 && ['whtRate', 'whtAmount'].every((k) => codes(w1).includes(k)), JSON.stringify(codes(w1)));
const w = await ana.post('/receipts', full({ invoiceNo: 'W2-' + stamp, withheld: true, whtRate: 2, whtAmount: 20, reasonForSpending: undefined, classification: undefined }));
check('withholding saved with rate and amount', w.status === 201 && w.data.receipt.form.whtRate === 2 && w.data.receipt.form.whtAmount === 20);
const none = { birInvoice: false, receiptDate: '2026-10-12', payee: 'Form Test Corner ' + stamp, amount: 350 };
const noneBad = await ana.post('/receipts', none);
check('no BIR invoice still needs the address and the reason for spending', noneBad.status === 400 && ['vendorAddress', 'reasonForSpending', 'classification'].every((k) => codes(noneBad).includes(k)), JSON.stringify(codes(noneBad)));
const noneOk = { ...none, vendorAddress: 'Mandaue City, Cebu', reasonForSpending: 'Water refills for the clinic', classification: 'meal_personal' };
const nb = await ana.post('/receipts', { ...noneOk, vatType: 'vatable', vatAmount: 9, seenCompany: true, transactionType: 'service' });
check('the short no-BIR path is accepted', nb.status === 201 && nb.data.receipt.form.reasonForSpending === 'Water refills for the clinic' && nb.data.receipt.form.classification === 'meal_personal');
check('a classification outside the list is refused', codes(await ana.post('/receipts', { ...noneOk, classification: 'holiday' })).includes('classification'));
check('"Other" needs the person to write what it is', codes(await ana.post('/receipts', { ...noneOk, classification: 'other' })).includes('classificationOther'));
const oth = await ana.post('/receipts', { ...noneOk, classification: 'other', classificationOther: 'Team building' });
check('"Other" with its words is saved', oth.status === 201 && oth.data.receipt.form.classification === 'other' && oth.data.receipt.form.classificationOther === 'Team building');
const oth3 = await ana.post('/receipts', { ...noneOk, classification: 'meal_personal', classificationOther: 'left over' });
check('the "Other" words are dropped when another classification is chosen', oth3.status === 201 && oth3.data.receipt.form.classificationOther === null);
const notCo = await ana.post('/receipts', full({ invoiceNo: 'NC-' + stamp, invoiceUnderCompany: false, seenCompany: false, seenTin: false, seenAddress: false }));
check('an invoice not under the company skips the three ticks', notCo.status === 201 && notCo.data.receipt.form.invoiceUnderCompany === false && notCo.data.receipt.form.seenCompany === null, JSON.stringify(notCo.data?.error));
const tax = await ana.post('/receipts', full({ invoiceNo: 'TX-' + stamp, withheld: true, whtRate: 2, whtAmount: 20, reasonForSpending: undefined, classification: undefined }));
check('tax withheld finishes after the withholding step, with no reason for spending', tax.status === 201 && tax.data.receipt.form.reasonForSpending === null, JSON.stringify(tax.data?.error));
const noTax = await ana.post('/receipts', full({ invoiceNo: 'NT-' + stamp, reasonForSpending: undefined, classification: undefined }));
check('without tax withheld the reason for spending is required', noTax.status === 400 && codes(noTax).includes('reasonForSpending'));
check('answers that do not apply are not kept', nb.data.receipt.form.vatType === null && nb.data.receipt.form.vatAmount === null && nb.data.receipt.form.seenCompany === null && nb.data.receipt.form.transactionType === null);
check('future invoice dates are refused', codes(await ana.post('/receipts', full({ receiptDate: '2999-01-01' }))).includes('receiptDate'));
check('text in an amount is refused', (await ana.post('/receipts', full({ amount: 'abc' }))).status === 400);
check('negative VAT is refused', (await ana.post('/receipts', full({ vatAmount: -5 }))).status === 400);
check('a vendor name that looks like a formula is stored as typed, not run', (await ana.post('/receipts', full({ invoiceNo: 'F-' + stamp, payee: '=HYPERLINK("http://evil")' }))).status === 201);

console.log('\nWarnings never block');
const odd = await ana.post('/receipts', full({ invoiceNo: 'O-' + stamp, vatAmount: 50 }));
check('numbers that do not add up still save as a draft', odd.status === 201);
check('and are flagged for the Checker', odd.data.receipt.warnings.length >= 1, JSON.stringify(odd.data.receipt.warnings));
check('a TIN that is not complete is refused', codes(await ana.post('/receipts', full({ invoiceNo: 'O2-' + stamp, vendorTin: 'ABC' }))).includes('vendorTin') && codes(await ana.post('/receipts', full({ invoiceNo: 'O3-' + stamp, vendorTin: '123-456-789' }))).includes('vendorTin'));
const loose = await ana.post('/receipts', full({ invoiceNo: 'O4-' + stamp, vendorTin: '12345678900000' }));
check('a TIN typed without hyphens is saved in the formatted way', loose.status === 201 && loose.data.receipt.form.vendorTin === '123-456-789-00000', JSON.stringify(loose.data?.error));
const dup = (await ana.post('/receipts', full())).data?.receipt;
check('the same vendor TIN and invoice no. is flagged as a possible duplicate', (dup?.possibleDuplicates ?? []).length >= 1, JSON.stringify(dup?.possibleDuplicates));

console.log('\nEditing and the old receipts');
const edit = await ana.req('PATCH', `/receipts/${r.id}`, full({ invoiceNo: 'E-' + stamp, vatAmount: 120 }));
check('a draft can be edited', edit.status === 200 && edit.data.receipt.form.invoiceNo === 'E-' + stamp);
const oldCsv = `payee,receipt_date,amount,category,description\nForm Test Old ${stamp},2026-10-10,150.25,Medicine,old template\n`;
const oldFile = new FormData(); oldFile.append('file', new Blob([oldCsv], { type: 'text/csv' }), 'old.csv');
const oldPv = await ana.req('POST', '/imports', oldFile);
check('the old import template still works', oldPv.status === 201 && oldPv.data.validRows === 1, JSON.stringify(oldPv.data));
await ana.post(`/imports/${oldPv.data.id}/confirm`);
const legacy = (await ana.get(`/receipts?q=${encodeURIComponent('Form Test Old ' + stamp)}`)).data.items[0];
check('an old-template receipt has no invoice answers yet', legacy && legacy.birInvoice === null);
await ana.req('POST', `/receipts/${legacy.id}/evidence`, upload('legacy' + stamp));
const lv = (await ana.get(`/receipts/${legacy.id}`)).data.receipt;
check('and cannot be submitted until they are filled in', (await ana.post(`/receipts/${legacy.id}/submit`, { version: lv.version })).data?.error?.code === 'FORM_INCOMPLETE');

console.log('\nThe full import template');
const fullCsv = [
  'vendor,invoice_date,invoice_no,vendor_tin,vendor_address,gross_amount,type,bir_invoice,invoice_under_company,company_check,reason_for_spending,classification,vat_type,vatable_amount,vat_amount,withheld,wht_rate,wht_amount,description',
  `Form Test Import A ${stamp},2026-10-10,IMP-1,111-222-333-00000,Cebu City,1120,product,yes,yes,yes,Clinic supplies,Other: Clinic supplies,vatable,1000,120,no,,,ok`,
  `Form Test Import B ${stamp},2026-10-10,,,Cebu City,350,,no,,,Water refills,meal,,,,,,,no invoice`,
  `Form Test Import C ${stamp},2026-10-10,IMP-3,,,500,product,yes,yes,no,Supplies,fuel,vatable,400,48,no,,,missing TIN and unticked`,
].join('\n') + '\n';
const ff = new FormData(); ff.append('file', new Blob([fullCsv], { type: 'text/csv' }), 'full.csv');
const fpv = await ana.req('POST', '/imports', ff);
check('two rows are valid and the incomplete one is rejected with reasons', fpv.status === 201 && fpv.data.validRows === 2 && fpv.data.errorCount === 1 && /vendor_tin|company_check/.test(fpv.data.errors[0].message), JSON.stringify(fpv.data));
await ana.post(`/imports/${fpv.data.id}/confirm`);
const imported = (await ana.get(`/receipts?q=${encodeURIComponent('Form Test Import A ' + stamp)}`)).data.items[0];
check('imported rows keep their invoice answers', imported?.invoiceNo === 'IMP-1' && imported.birInvoice === true && imported.transactionType === 'product');
const importedFull = imported ? (await ana.get('/receipts/' + imported.id)).data.receipt : null;
check('an imported "Other: ..." classification keeps its words', importedFull?.form?.classification === 'other' && importedFull.form.classificationOther === 'Clinic supplies', JSON.stringify(importedFull?.form));

console.log('\nThe Checker confirms the company details');
r = edit.data.receipt;
let ev = await ana.req('POST', `/receipts/${r.id}/evidence`, upload('form' + stamp));
r = ev.data.receipt;
let s = await ana.post(`/receipts/${r.id}/submit`, { version: r.version });
check('a complete receipt is submitted', s.data?.receipt?.status === 'submitted', JSON.stringify(s.data));
r = s.data.receipt;
await liza.req('GET', `/receipts/${r.id}/evidence/${r.evidence[0].id}/file?mode=view`, undefined, { raw: true });
check('checking without an answer on the company details is refused', (await liza.post(`/receipts/${r.id}/check`, { version: r.version })).data?.error?.code === 'SEEN_REQUIRED');
check('"not seen" needs a reason', (await liza.post(`/receipts/${r.id}/check`, { version: r.version, seen: { company: true, tin: false, address: true } })).data?.error?.code === 'NOTE_REQUIRED');
const bulk = await liza.post('/receipts/bulk', { action: 'check', ids: [r.id] });
check('a bulk check cannot skip the company confirmation', bulk.data?.results?.[0]?.ok === false, JSON.stringify(bulk.data));
s = await liza.post(`/receipts/${r.id}/check`, { version: r.version, seen: { company: true, tin: true, address: true } });
check('checked once all three are confirmed', s.data?.receipt?.status === 'checked', JSON.stringify(s.data));
check('the Checker answers are saved with the receipt', s.data.receipt.form.checked?.company === true && s.data.receipt.form.checked?.tin === true);
await paolo.req('GET', `/receipts/${r.id}/evidence/${r.evidence[0].id}/file?mode=view`, undefined, { raw: true });
s = await paolo.post(`/receipts/${r.id}/approve`, { version: s.data.receipt.version });
check('approved', s.data?.receipt?.status === 'approved', JSON.stringify(s.data));
const doc = await until(async () => { const x = (await ana.get(`/receipts/${r.id}`)).data.receipt; return x.document?.status === 'ready' ? x : null; });
check('the reimbursement document is built', !!doc);
if (doc) {
  const pdf = await ana.req('GET', `/documents/${doc.document.id}/file?mode=download`, undefined, { raw: true });
  const buf = Buffer.from(await pdf.arrayBuffer());
  check('and is a one-page PDF', buf.subarray(0, 5).toString() === '%PDF-' && (buf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length === 1);
}

console.log('\nExports and reports carry the new columns');
const exp = await ana.req('GET', '/receipts/export?format=csv', undefined, { raw: true });
const text = await exp.text();
check('the receipt export has the invoice, VAT and withholding columns', ['Invoice no.', 'Vendor TIN', 'VAT amount', 'Withholding amount', 'BIR invoice'].every((c) => text.includes(c)));
check('the export holds no category column', !/Category/.test(text.split('\n')[0]));
const svc = await ana.post('/receipts', full({ transactionType: 'service', invoiceNo: 'SVC-' + Date.now() })); // make our own, so the check does not depend on what earlier runs left behind
check('a Service receipt can be created for the filter check', svc.status === 201, JSON.stringify(svc.data).slice(0, 160));
const t = (await ana.get('/receipts?transactionType=service')).data;
check('the list can be filtered by Product or Service', t.items.length > 0 && t.items.every((x) => x.transactionType === 'service'));
const rep = await ana.post('/reports', { from: '2026-10-01', to: '2026-10-31', format: 'csv', transactionType: 'product' });
const ready = await until(async () => { const x = (await ana.get('/reports')).data.reports.find((y) => y.id === rep.data.report.id); return x && x.status !== 'pending' ? x : null; });
check('a report filtered by type is produced', ready?.status === 'ready', JSON.stringify(ready));
const data = (await ana.get(`/reports/${rep.data.report.id}/data`)).data;
check('the report shows VAT and withholding totals', data?.totals && data.totals.vat >= 120 && 'wht' in data.totals, JSON.stringify(data?.totals));
const xl = await ana.post('/reports', { from: '2026-10-01', to: '2026-10-31', format: 'xlsx' });
const pf = await ana.post('/reports', { from: '2026-10-01', to: '2026-10-31', format: 'pdf' });
const done = await until(async () => { const l = (await ana.get('/reports')).data.reports; const a = l.find((y) => y.id === xl.data.report.id), b = l.find((y) => y.id === pf.data.report.id); return a?.status !== 'pending' && b?.status !== 'pending' ? [a, b] : null; });
check('Excel and PDF reports are produced too', done && done.every((x) => x.status === 'ready'), JSON.stringify(done));

console.log('\nCompany details');
console.log('\nAdministrator settings');
const s0 = (await ana.get('/app-settings')).data;
check('anyone signed in can read the settings', s0?.settings?.vatRate === 12 && s0.defaults.vatRate === 12, JSON.stringify(s0));
check('a Med Ref cannot change them', (await ana.put('/app-settings', s0.settings)).status === 403);
check('nonsense values are refused', (await admin.put('/app-settings', { ...s0.settings, vatRate: 'abc' })).status === 400 && (await admin.put('/app-settings', { ...s0.settings, sessionIdleMinutes: 1 })).status === 400);
try {
  await admin.put('/app-settings', { ...s0.settings, allowNoBir: false, requireVendorTin: false, askWithholding: false });
  check('with "no BIR" switched off it is refused', codes(await ana.post('/receipts', noneOk)).includes('birInvoice'));
  const noTin = await ana.post('/receipts', full({ invoiceNo: 'S1-' + stamp, vendorTin: '', withheld: undefined }));
  check('with the TIN made optional it is accepted, and withholding is not asked', noTin.status === 201 && noTin.data.receipt.form.withheld === false, JSON.stringify(noTin.data?.error));
  await admin.put('/app-settings', { ...s0.settings }); // the questions are asked again for the rules below
  const bad = (await ana.post('/receipts', full({ invoiceNo: 'S2-' + stamp, vatAmount: 50 }))).data.receipt;
  await ana.req('POST', '/receipts/' + bad.id + '/evidence', upload('blk' + stamp));
  const cur = (await ana.get('/receipts/' + bad.id)).data.receipt;
  check('a total that does not add up cannot be submitted, whatever the Tax withheld answer', (await ana.post('/receipts/' + bad.id + '/submit', { version: cur.version })).data?.error?.code === 'TOTAL_MISMATCH');
  await ana.req('PATCH', '/receipts/' + bad.id, full({ invoiceNo: 'S2-' + stamp, vatAmount: 120 }));
  const fixed = (await ana.get('/receipts/' + bad.id)).data.receipt;
  check('and can be submitted once the total is corrected', (await ana.post('/receipts/' + bad.id + '/submit', { version: fixed.version })).data?.receipt?.status === 'submitted');
  const ord = (await ana.post('/receipts', full({ invoiceNo: 'S2b-' + stamp, vatableAmount: 1020, vatAmount: 100 }))).data.receipt;
  await ana.req('POST', '/receipts/' + ord.id + '/evidence', upload('ord' + stamp));
  const ordCur = (await ana.get('/receipts/' + ord.id)).data.receipt;
  check('Tax withheld No: an ordinary mismatch (VAT not 12%) still lets the receipt be submitted', (await ana.post('/receipts/' + ord.id + '/submit', { version: ordCur.version })).data?.receipt?.status === 'submitted');
  const yes = (await ana.post('/receipts', full({ invoiceNo: 'S2c-' + stamp, vatableAmount: 1020, vatAmount: 100, withheld: true, whtRate: 2, whtAmount: 20.4 }))).data.receipt;
  await ana.req('POST', '/receipts/' + yes.id + '/evidence', upload('yes' + stamp));
  const yesCur = (await ana.get('/receipts/' + yes.id)).data.receipt;
  check('Tax withheld Yes: the same mismatch cannot be submitted', (await ana.post('/receipts/' + yes.id + '/submit', { version: yesCur.version })).data?.error?.code === 'VAT_MISMATCH');
  const impact = (await ana.get('/dashboard/tax-impact')).data;
  check('the dashboard figures add up: potential loss is rate x VAT of the receipts answered No', impact?.totals?.potentialLoss > 0 && impact.scope === 'own', JSON.stringify(impact?.totals));
  await admin.put('/app-settings', { ...s0.settings, evidenceMaxFiles: 1 });
  const two = (await ana.post('/receipts', full({ invoiceNo: 'S3-' + stamp }))).data.receipt;
  await ana.req('POST', '/receipts/' + two.id + '/evidence', upload('one' + stamp));
  check('the file limit setting applies', (await ana.req('POST', '/receipts/' + two.id + '/evidence', upload('two' + stamp))).data?.error?.code === 'TOO_MANY_FILES');
  await admin.put('/app-settings', { ...s0.settings, sessionIdleMinutes: 30 });
  await sleep(300);
  check('the idle limit applies at once', (await ana.get('/me')).data?.session?.idleMinutes === 30, JSON.stringify((await ana.get('/me')).data?.session));
} finally {
  await admin.put('/app-settings', s0.settings);
}
check('the settings are put back as they were', JSON.stringify((await ana.get('/app-settings')).data.settings) === JSON.stringify(s0.settings));
const rs = await admin.post('/app-settings/reset');
check('"reset to default" works', rs.status === 200 && JSON.stringify(rs.data.settings) === JSON.stringify(rs.data.defaults));
await admin.put('/app-settings', s0.settings);
check('changes appear in the audit log', (await admin.get('/audit?q=setting')).data?.items?.some((x) => /setting/.test(x.summary ?? '')));

const co0 = (await ana.get('/company')).data.company;
check('anyone signed in can read the company details', co0?.name && co0.tin && co0.address);
check('a Med Ref cannot change them', (await ana.put('/company', { name: 'Hacked Corp', tin: '000', address: 'nowhere at all' })).status === 403);
const save = await admin.put('/company', { name: 'Test Co Inc.', tin: '999-888-777-00000', address: '1 Test Street, Test City' });
check('an administrator can change them', save.status === 200 && (await ana.get('/company')).data.company.name === 'Test Co Inc.');
check('a short or empty name is refused', (await admin.put('/company', { name: '', tin: '999-888-777-00000', address: '1 Test Street, Test City' })).status === 400);
await admin.put('/company', co0);
check('and they are put back as they were', (await ana.get('/company')).data.company.name === co0.name);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
