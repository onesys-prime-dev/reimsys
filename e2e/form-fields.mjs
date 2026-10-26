// Checks the answers added from the client's Google Form against a running API: VAT-exempt amount and discount, where to charge (an editable list),
// the reimbursement code, "Review the details", and the new classification list. Needs the API (4000). Usage: node e2e/form-fields.mjs
import { call, loginAll, today, PNG, B, H } from './payment-helpers.mjs';

const U = await loginAll();
let failed = 0;
const check = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : x); if (!c) failed++; };
const stamp = Date.now();
const codes = (r) => (r.d?.error?.issues ?? []).map((i) => i.path[0]);

console.log('Where to charge');
const list = (await call(U.ana, 'GET', '/charge-locations')).d.locations;
const names = list.map((l) => l.name);
check('everyone signed in gets the four places from the form', ['Makati Medical Center', 'Solara Pharma Corp.', 'St. Lukes Medical Center - Quezon City', 'St. Lukes Medical Center - Taguig'].every((n) => names.includes(n)), JSON.stringify(names));
check('a Med Ref cannot change the list', (await call(U.ana, 'POST', '/charge-locations', { name: 'Nope ' + stamp })).s === 403 && (await call(U.ana, 'GET', '/charge-locations?all=true')).d.locations.every((l) => l.isActive));
const added = await call(U.admin, 'POST', '/charge-locations', { name: 'Test Clinic ' + stamp });
check('an administrator can add a place', added.s === 201 && added.d.location.isActive);
check('a duplicate name is refused', (await call(U.admin, 'POST', '/charge-locations', { name: 'Test Clinic ' + stamp })).s === 409);
check('a one-letter name is refused', (await call(U.admin, 'POST', '/charge-locations', { name: 'A' })).s === 400);
const id = added.d.location.id;
check('and rename it', (await call(U.admin, 'PATCH', `/charge-locations/${id}`, { name: 'Test Clinic B ' + stamp })).d.location.name === 'Test Clinic B ' + stamp);
check('it shows in the form list', (await call(U.ana, 'GET', '/charge-locations')).d.locations.some((l) => l.id === id));
await call(U.admin, 'PATCH', `/charge-locations/${id}`, { isActive: false });
check('switched off, it is hidden from the form list but the administrator still sees it', !(await call(U.ana, 'GET', '/charge-locations')).d.locations.some((l) => l.id === id) && (await call(U.admin, 'GET', '/charge-locations?all=true')).d.locations.some((l) => l.id === id && !l.isActive));
check('without a sign-in the list is refused', (await fetch(B + '/charge-locations', { headers: { 'x-requested-with': 'reimsys' } })).status === 401);

console.log('\nThe VAT-exempt amount counts in the total, the discount does not');
const base = { receiptDate: '2026-10-12', payee: 'Fields Test ' + stamp, amount: 1620, birInvoice: true, invoiceUnderCompany: false, vendorAddress: 'Cebu', vendorTin: '123-456-789-00000', transactionType: 'product', vatType: 'vatable', vatableAmount: 1000, vatAmount: 120, vatExemptAmount: 500, discountAmount: 50, withheld: false, reasonForSpending: 'Supplies', classification: 'meal_personal', chargeLocationId: list[0].id, newReimbursementCode: true, detailsReviewed: true };
async function upload(url, headers, make) { for (let i = 0; i < 8; i++) { const r = await fetch(url, { method: 'POST', headers, body: make() }); if (r.status !== 429) return r; await new Promise((x) => setTimeout(x, 10_000)); } } // the upload limit is 60 a minute, which the tests before this one can use up
async function submit(extra, tag) {
  const r = (await call(U.ana, 'POST', '/receipts', { ...base, invoiceNo: tag + stamp, ...extra }));
  if (r.s !== 201) return { create: r };
  await upload(`${B}/receipts/${r.d.receipt.id}/evidence`, H(U.ana, false), () => { const f = new FormData(); f.append('files', new Blob([Buffer.concat([PNG, Buffer.from(tag + stamp)])], { type: 'image/png' }), 'p.png'); return f; });
  const cur = (await call(U.ana, 'GET', `/receipts/${r.d.receipt.id}`)).d.receipt;
  return { create: r, sub: await call(U.ana, 'POST', `/receipts/${cur.id}/submit`, { version: cur.version }), id: cur.id };
}
const good = await submit({}, 'G');
check('1,000 + 120 + 500 = 1,620 is accepted and submitted, whatever the discount', good.sub?.s === 200 && good.sub.d.receipt.status === 'submitted', JSON.stringify(good.sub?.d?.error));
const saved = (await call(U.ana, 'GET', `/receipts/${good.id}`)).d.receipt;
check('the receipt keeps the exempt amount, discount and place', saved.form.vatExemptAmount === 500 && saved.form.discountAmount === 50 && saved.form.chargeLocation?.id === list[0].id);
const noEx = await submit({ vatExemptAmount: 0 }, 'N');
check('without the exempt amount the total no longer matches and submitting is refused', noEx.sub?.d?.error?.code === 'TOTAL_MISMATCH', JSON.stringify(noEx.sub?.d?.error));
const impact = saved.impact;
check('the net for the tax is the vatable plus the exempt amount (1,500)', impact.net === 1500 && impact.gross === 1620 && impact.difference === 2.4, JSON.stringify(impact));
check('a negative discount is refused', codes(await call(U.ana, 'POST', '/receipts', { ...base, invoiceNo: 'D' + stamp, discountAmount: -1 })).includes('discountAmount'));

console.log('\nThe last page must be complete before submitting');
for (const [label, extra, code] of [
  ['no place to charge', { chargeLocationId: null }, 'FORM_INCOMPLETE'],
  ['no answer about the reimbursement code', { newReimbursementCode: null }, 'FORM_INCOMPLETE'],
  ['"Other" without the code', { newReimbursementCode: false, reimbursementCode: '' }, 'FORM_INCOMPLETE'],
  ['"Review the details" not answered Yes', { detailsReviewed: false }, 'FORM_INCOMPLETE'],
  ['no VAT-exempt amount', { vatExemptAmount: null, amount: 1120 }, 'FORM_INCOMPLETE'],
]) {
  const r = await submit(extra, 'L' + label.length);
  check(`${label}: it can be saved as a draft but not submitted`, r.create.s === 201 && r.sub?.d?.error?.code === code, JSON.stringify(r.sub?.d?.error ?? r.create.d?.error));
}
const other = await submit({ newReimbursementCode: false, reimbursementCode: 'RC-77' }, 'O');
check('"Other" with the code is accepted and the code is kept', other.sub?.s === 200 && (await call(U.ana, 'GET', `/receipts/${other.id}`)).d.receipt.form.reimbursementCode === 'RC-77');
const yes = (await call(U.ana, 'GET', `/receipts/${good.id}`)).d.receipt.form;
check('with "Yes" no code is kept', yes.newReimbursementCode === true && yes.reimbursementCode === null);

console.log('\nThe classification list');
for (const c of ['notarial', 'representation_recreation']) check(`"${c}" is accepted`, (await call(U.ana, 'POST', '/receipts', { ...base, invoiceNo: 'C' + c + stamp, classification: c })).s === 201);
for (const c of ['meal', 'representation']) check(`the old "${c}" is no longer on the list`, codes(await call(U.ana, 'POST', '/receipts', { ...base, invoiceNo: 'C' + c + stamp, classification: c })).includes('classification'));

console.log('\nThe export has the new columns');
const csv = await (await fetch(B + '/receipts/export?format=csv&q=Fields%20Test', { headers: H(U.admin, false) })).text();
check('VAT-exempt amount, discount, where to charge and reimbursement code', ['VAT-exempt amount', 'Discount', 'Where to charge', 'Reimbursement code', 'Makati Medical Center'].every((c) => csv.includes(c)));

console.log(failed ? `\n${failed} FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
