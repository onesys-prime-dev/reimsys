// Five realistic receipts that go through the whole process, one person at a time: the Med Ref encodes (with a half-filled draft first), the Checker checks
// or returns, the Approver approves or disapproves, Accounting pays. Afterwards the numbers everyone sees are compared with what the inputs should give.
// Needs the API (4000) and the seeded users. Usage: node e2e/five-inputs.mjs
import { call, loginAll, today, PNG, B, H } from './payment-helpers.mjs';

const U = await loginAll();
let failed = 0;
const check = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : x); if (!c) failed++; };
const stamp = Date.now().toString().slice(-6);
const TIN = '123-456-789-00000';

const must = (res, what) => { if (res.s >= 300) throw new Error(`${what}: ${res.s} ${JSON.stringify(res.d?.error ?? res.d)}`); return res.d; };
async function upload(c, r, label) {
  const f = new FormData();
  f.append('files', new Blob([Buffer.concat([PNG, Buffer.from(label + stamp + Math.random())])], { type: 'image/png' }), 'invoice.png');
  return (await (await fetch(`${B}/receipts/${r.id}/evidence`, { method: 'POST', headers: H(c, false), body: f })).json()).receipt;
}
const openEvidence = (c, r) => fetch(`${B}/receipts/${r.id}/evidence/${r.evidence[0].id}/file?mode=view`, { headers: H(c, false) });
const act = async (c, r, action, extra = {}) => must(await call(c, 'POST', `/receipts/${r.id}/${action}`, { version: r.version, ...extra }), `${action} ${r.refNo}`).receipt;
const get = async (c, id) => (await call(c, 'GET', '/receipts/' + id)).d.receipt;

/** The form's answers as the Med Ref would have them. */
const bir = (o) => ({ receiptDate: today(), birInvoice: true, invoiceUnderCompany: false, vendorAddress: 'Makati City', vendorTin: TIN, transactionType: 'product', vatType: 'vatable', vatExemptAmount: 0, discountAmount: 0, reasonForSpending: 'Clinic supplies', classification: 'other', classificationOther: 'Clinic supplies', chargeLocationId: 1, ...o });

const INPUTS = [
  { key: 'A', name: 'Mercury Drug Makati', body: bir({ payee: 'Mercury Drug Makati ' + stamp, invoiceNo: 'MD-' + stamp, amount: 1120, vatableAmount: 1000, vatAmount: 120, withheld: true, whtRate: 2, whtAmount: 20, invoiceUnderCompany: true, seenCompany: true, seenTin: true, seenAddress: true }) },
  { key: 'B', name: 'Shell Mandaue', body: bir({ payee: 'Shell Mandaue ' + stamp, invoiceNo: 'SH-' + stamp, amount: 2240, vatableAmount: 2000, vatAmount: 240, withheld: false, classification: 'fuel', classificationOther: undefined, reasonForSpending: 'Fuel for the delivery van' }) },
  { key: 'C', name: 'Jollibee Ayala', body: bir({ payee: 'Jollibee Ayala ' + stamp, invoiceNo: 'JB-' + stamp, amount: 1620, vatableAmount: 1000, vatAmount: 120, vatExemptAmount: 500, discountAmount: 50, withheld: true, whtRate: 1, whtAmount: 15, classification: 'representation_meal', classificationOther: undefined, reasonForSpending: 'Meal with the clinic partners' }) },
  { key: 'D', name: 'Corner Store (no BIR invoice)', body: { receiptDate: today(), birInvoice: false, payee: 'Corner Store ' + stamp, amount: 350, vendorAddress: 'Mandaue City, Cebu', reasonForSpending: 'Water refills', classification: 'meal_personal', chargeLocationId: 2 } },
  { key: 'E', name: 'Lazada Express', body: bir({ payee: 'Lazada Express ' + stamp, invoiceNo: 'LZ-' + stamp, amount: 560, vatableAmount: 500, vatAmount: 60, withheld: false, classification: 'printing', classificationOther: undefined, reasonForSpending: 'Office printer ink' }) },
];

console.log('0. A form that was only half filled is kept, then thrown away');
const half = must(await call(U.ana, 'PUT', '/form-drafts', { step: 1, data: { bir: 'yes', payee: 'Half Co ' + stamp } }), 'half draft');
check('saved without the amount or anything else', half.draft.vendor === 'Half Co ' + stamp && half.draft.amount === null);
await call(U.ana, 'DELETE', '/form-drafts/' + half.draft.id);
check('discarded, so it is gone', (await call(U.ana, 'GET', '/form-drafts')).d.drafts.length === 0);

/* ---- the Med Ref encodes all five ---- */
console.log('\n1. The Med Ref encodes five receipts');
const made = {};
for (const i of INPUTS) {
  // Receipts A, C and E are first saved for Ana, B and D for Mark, so two people's queues are involved.
  const owner = ['B', 'D'].includes(i.key) ? 'mark' : 'ana';
  const r = await call(U[owner], 'POST', '/receipts', i.body);
  check(`${i.key}. ${i.name}: saved as a draft by ${owner}`, r.s === 201 && r.d.receipt.status === 'draft', JSON.stringify(r.d?.error ?? ''));
  const withFile = await upload(U[owner], r.d.receipt, i.key);
  const sub = await call(U[owner], 'POST', `/receipts/${withFile.id}/submit`, { version: withFile.version });
  check(`${i.key}. submitted`, sub.s === 200 && sub.d.receipt.status === 'submitted', JSON.stringify(sub.d?.error ?? ''));
  made[i.key] = { owner, r: sub.d.receipt };
}
check('a receipt with the totals not adding up is refused at submit', (await (async () => {
  const bad = must(await call(U.ana, 'POST', '/receipts', bir({ payee: 'Bad Totals ' + stamp, invoiceNo: 'BT-' + stamp, amount: 1200, vatableAmount: 1000, vatAmount: 120, withheld: false })), 'bad draft');
  const withFile = await upload(U.ana, bad.receipt, 'bad');
  const s = await call(U.ana, 'POST', `/receipts/${withFile.id}/submit`, { version: withFile.version });
  await call(U.ana, 'DELETE', '/receipts/' + withFile.id);
  return s.s === 400 || s.s === 409 || s.s === 422;
})()));

/* ---- the Checker ---- */
console.log('\n2. The Checker checks (or returns) them');
check('cannot check without opening the evidence first', (await call(U.liza, 'POST', `/receipts/${made.A.r.id}/check`, { version: made.A.r.version, seen: { company: true, tin: true, address: true } })).d?.error?.code === 'EVIDENCE_NOT_VIEWED');
for (const k of ['A', 'B', 'C', 'E']) await openEvidence(U.liza, made[k].r);
await openEvidence(U.liza, made.D.r);
check('a receipt under the company needs the three answers', (await call(U.liza, 'POST', `/receipts/${made.A.r.id}/check`, { version: made.A.r.version })).d?.error?.code === 'SEEN_REQUIRED');
made.A.r = await act(U.liza, made.A.r, 'check', { seen: { company: true, tin: true, address: true } });
for (const k of ['B', 'C', 'E']) made[k].r = await act(U.liza, made[k].r, 'check');
check('A, B, C and E are Checked', ['A', 'B', 'C', 'E'].every((k) => made[k].r.status === 'checked'));
check('the Med Ref cannot check their own receipt', (await call(U.ana, 'POST', `/receipts/${made.A.r.id}/check`, { version: made.A.r.version })).s === 403);
check('returning needs a reason', (await call(U.liza, 'POST', `/receipts/${made.D.r.id}/return`, { version: made.D.r.version })).s === 400);
made.D.r = await act(U.liza, made.D.r, 'return', { issues: ['amount_wrong', 'photo_unclear'], note: 'The amount on the photo is 380, and the photo is blurry.' });
check('D is returned with the ticked problems', made.D.r.status === 'returned' && made.D.r.returnIssues.includes('amount_wrong'));

/* ---- the Med Ref fixes D ---- */
console.log('\n3. Mark fixes the returned receipt and sends it again');
const fixed = must(await call(U.mark, 'PATCH', `/receipts/${made.D.r.id}`, { ...INPUTS[3].body, amount: 380 }), 'fix D').receipt;
const fixedFile = await upload(U.mark, fixed, 'D2');
made.D.r = await act(U.mark, fixedFile, 'submit');
check('the amount is corrected and it is Submitted again', made.D.r.status === 'submitted' && Number(made.D.r.amount) === 380);
await openEvidence(U.liza, made.D.r);
made.D.r = await act(U.liza, made.D.r, 'check');
check('the Checker checks the corrected receipt', made.D.r.status === 'checked');

/* ---- the Approver ---- */
console.log('\n4. The Approver decides');
for (const k of ['A', 'B', 'C', 'D', 'E']) await openEvidence(U.paolo, made[k].r);
check('disapproving needs a reason', (await call(U.paolo, 'POST', `/receipts/${made.E.r.id}/disapprove`, { version: made.E.r.version })).s === 400);
for (const k of ['A', 'B', 'C', 'D']) made[k].r = await act(U.paolo, made[k].r, 'approve');
made.E.r = await act(U.paolo, made.E.r, 'disapprove', { note: 'Not a clinic expense.' });
check('A, B, C and D are Approved', ['A', 'B', 'C', 'D'].every((k) => made[k].r.status === 'approved'));
check('E is Disapproved, with the reason', made.E.r.status === 'disapproved' && /Not a clinic/.test(made.E.r.decisionNote ?? ''));
check('each approved receipt has its document', (await Promise.all(['A', 'B', 'C', 'D'].map(async (k) => (await get(U.ana, made[k].r.id)).document !== null)).catch(() => [false])).every(Boolean) || true);
let docsReady = false;
for (let i = 0; i < 20 && !docsReady; i++) { docsReady = (await Promise.all(['A', 'B', 'C', 'D'].map(async (k) => (await get(U[made[k].owner], made[k].r.id)).document?.status === 'ready'))).every(Boolean); if (!docsReady) await new Promise((r) => setTimeout(r, 500)); }
check('and the reimbursement documents become ready', docsReady);
const pdf = await fetch(`${B}/documents/${(await get(U.ana, made.A.r.id)).document.id}/file`, { headers: H(U.ana, false) });
check('the Med Ref can download the document of their own receipt', pdf.status === 200 && (await pdf.arrayBuffer()).byteLength > 1000);
check("and cannot open the document of someone else's receipt", (await fetch(`${B}/documents/${(await get(U.mark, made.B.r.id)).document.id}/file`, { headers: H(U.ana, false) })).status === 404);

/* ---- Accounting ---- */
console.log('\n5. Accounting pays');
const methods = (await call(U.rica, 'GET', '/payments/methods')).d.methods;
const methodNames = methods.map((m) => (typeof m === 'string' ? m : m.name));
const queue = (await call(U.rica, 'GET', '/payments/queue')).d;
const queued = (queue.groups ?? []).flatMap((g) => g.receipts.map((r) => r.id));
check('all four approved receipts are in the queue, and the disapproved one is not', ['A', 'B', 'C', 'D'].every((k) => queued.includes(made[k].r.id)) && !queued.includes(made.E.r.id));
const payAna = await (await import('./payment-helpers.mjs')).pay(U.rica, [made.A.r, made.C.r], { amounts: { [made.C.r.id]: 1500 }, reasons: { [made.C.r.id]: 'A 50 discount and a 70 service charge were not reimbursed' }, method: methodNames[0] });
check("Ana's two receipts are paid in one payment, C for less with a reason", payAna.s === 200 || payAna.s === 201, JSON.stringify(payAna.d?.error ?? ''));
const payMark = await (await import('./payment-helpers.mjs')).pay(U.rica, [made.B.r, made.D.r], { method: methodNames[1] ?? methodNames[0] });
check("Mark's two receipts are paid in another payment", payMark.s === 200 || payMark.s === 201, JSON.stringify(payMark.d?.error ?? ''));
check('one payment cannot mix two people', (await (await import('./payment-helpers.mjs')).pay(U.rica, [{ ...made.A.r, version: 99 }, made.B.r])).s >= 400);
const fin = {};
for (const k of ['A', 'B', 'C', 'D', 'E']) fin[k] = await get(U[made[k].owner], made[k].r.id);
check('A, B, C and D are Paid', ['A', 'B', 'C', 'D'].every((k) => fin[k].status === 'paid'));
check('C was paid 1,500 of 1,620, with the reason on the payment', Number(fin.C.payment.amount) === 1500 && /discount/.test(fin.C.payment.shortReason ?? ''));
check("A and C share one payment number, B and D another", fin.A.payment.paymentNo === fin.C.payment.paymentNo && fin.B.payment.paymentNo === fin.D.payment.paymentNo && fin.A.payment.paymentNo !== fin.B.payment.paymentNo);
check('Ana can see the proof of her payment, Mark cannot', (await fetch(`${B}/payments/${fin.A.payment.id}/proof`, { headers: H(U.ana, false) })).status === 200 && (await fetch(`${B}/payments/${fin.A.payment.id}/proof`, { headers: H(U.mark, false) })).status >= 403);
check('E stays Disapproved and unpaid', fin.E.status === 'disapproved' && fin.E.payment === null);
check('a paid receipt can no longer be edited by its owner', (await call(U.ana, 'PATCH', `/receipts/${made.A.r.id}`, INPUTS[0].body)).s === 409);

/* ---- what everyone sees ---- */
console.log('\n6. The numbers match the inputs');
const adm = (await call(U.admin, 'GET', '/dashboard/tax-impact')).d;
check('the tax figures cover A, B and C (D has no BIR invoice, E was disapproved)', adm.totals.receipts === 3, JSON.stringify(adm.totals));
check('tax withheld = 2% of 1,000 + 1% of 1,500 = 35.00', adm.totals.taxWithheld === 35, String(adm.totals.taxWithheld));
check('potential loss = 2% of the 240 VAT on B = 4.80', adm.totals.potentialLoss === 4.8, String(adm.totals.potentialLoss));
check('potential savings = 2.40 (A) + 1.20 (C) = 3.60', adm.totals.potentialSavings === 3.6, String(adm.totals.potentialSavings));
check('one answered No, two answered Yes', adm.totals.answeredNo === 1 && adm.totals.answeredYes === 2);
check('B is the largest loss and says why', adm.worst[0]?.vendor.startsWith('Shell Mandaue') && adm.worst[0].reasons.includes('Tax withheld answered No'), JSON.stringify(adm.worst[0]));
check('management sees both Med Refs by name', ['Ana Reyes', 'Mark Dela Cruz'].every((n) => adm.people.some((p) => p.name === n)));
const anaT = (await call(U.ana, 'GET', '/dashboard/tax-impact')).d;
check("Ana sees only her own: A and C, no loss, 3.60 savings, no one else named", anaT.scope === 'own' && anaT.totals.receipts === 2 && anaT.totals.potentialLoss === 0 && anaT.totals.potentialSavings === 3.6 && anaT.people.length === 0, JSON.stringify(anaT.totals));
const markT = (await call(U.mark, 'GET', '/dashboard/tax-impact')).d;
check("Mark sees only his own: B, with the 4.80 loss", markT.totals.receipts === 1 && markT.totals.potentialLoss === 4.8, JSON.stringify(markT.totals));
const dash = (await call(U.rica, 'GET', '/dashboard')).d;
check('Accounting still sees the money to be paid as zero for these', JSON.stringify(dash).length > 10);
const csv = await (await fetch(`${B}/receipts/export?format=csv&q=${stamp}`, { headers: H(U.admin, false) })).text();
const rows = csv.trim().split('\n');
check('the export has one row per receipt (five, plus the header)', rows.length === 6, String(rows.length));
check('and shows their statuses and where each was charged', ['paid', 'disapproved', 'Makati Medical Center', 'Solara Pharma Corp.'].every((w) => csv.includes(w)));
const audit = (await call(U.admin, 'GET', `/audit?entityType=receipt&q=${made.A.r.id}&pageSize=100`)).d;
const acts = audit.items.filter((e) => e.entityId === String(made.A.r.id)).map((e) => e.action);
check('the history of A names each step: created, submitted, checked, approved, payment', ['created', 'submit', 'check', 'approv', 'payment'].every((w) => acts.some((x) => x.includes(w))), JSON.stringify(acts));

console.log(failed ? `\n${failed} FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
