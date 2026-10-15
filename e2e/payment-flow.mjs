// Checks the payment step through the API, as each role. Needs the API (4000) running and the seed applied.
// Usage: node e2e/payment-flow.mjs
import { B, H, PNG, call, checker, loginAll, makeApproved, makeDraft, pay, tag, today } from './payment-helpers.mjs';

const { ok, done } = checker();
const U = await loginAll();
console.log(`Run tag: ${tag}`);

console.log('\nWho sees what');
const a1 = await makeApproved(U, 'ana', 'Pay one', 1000);
const draft = await makeDraft(U, 'ana', 'Still a draft', 50);
ok('accounting can open an approved receipt', (await call(U.rica, 'GET', `/receipts/${a1.id}`)).s === 200);
ok('accounting cannot open a draft', (await call(U.rica, 'GET', `/receipts/${draft.id}`)).s === 404);
const ev = await fetch(`${B}/receipts/${a1.id}/evidence/${a1.evidence[0].id}/file?mode=view`, { headers: H(U.rica, false) });
ok('accounting can open the evidence (the seed gave the new role its grants)', ev.status === 200);
const dash = (await call(U.rica, 'GET', '/dashboard')).d;
ok('accounting dashboard queue is "Ready to pay"', dash.queueTitle === 'Ready to pay' && dash.queueTotal >= 1 && dash.queue.every((r) => r.status === 'approved'));
ok('dashboard has a paid-this-month summary', typeof dash.paidThisMonth?.count === 'number' && typeof dash.paidThisMonth?.total === 'number');
const detail = (await call(U.rica, 'GET', `/receipts/${a1.id}`)).d?.receipt;
ok('an unpaid receipt has no payment block', detail?.payment === null);
ok('accounting is offered "pay" on an approved receipt', !!detail?.actions.some((a) => a.action === 'pay'));
ok('the approver is not offered "pay"', !(await call(U.paolo, 'GET', `/receipts/${a1.id}`)).d.receipt.actions.some((a) => a.action === 'pay'));

console.log('\nThe payment queue');
const a2 = await makeApproved(U, 'ana', 'Batch A', 250.5);
const a3 = await makeApproved(U, 'ana', 'Batch B', 749.5);
const m1 = await makeApproved(U, 'mark', 'Other person', 300);
for (const who of ['ana', 'liza', 'paolo', 'admin']) ok(`${who} cannot open the payment queue`, (await call(U[who], 'GET', '/payments/queue')).s === 403);
const q = await call(U.rica, 'GET', '/payments/queue');
const groupOf = (name) => q.d?.groups.find((g) => g.payee.name === name);
ok('accounting can open the queue', q.s === 200);
ok('the queue is grouped by person', !!groupOf('Ana Reyes')?.receipts.some((r) => r.id === a2.id) && !!groupOf('Mark Dela Cruz')?.receipts.some((r) => r.id === m1.id));
ok('each group has its count and total', groupOf('Ana Reyes')?.count >= 3 && groupOf('Ana Reyes')?.total >= 2000);

console.log('\nPayment methods');
const methods = (await call(U.rica, 'GET', '/payments/methods')).d?.methods ?? [];
ok('the method list starts with the four defaults', ['Bank transfer', 'Cheque', 'Cash', 'E-wallet'].every((m) => methods.includes(m)));
ok('accounting cannot change the method list', (await call(U.rica, 'PUT', '/payments/methods', { methods: ['Cash'] })).s === 403);
ok('the list cannot be emptied', (await call(U.admin, 'PUT', '/payments/methods', { methods: [] })).s === 400);
const changed = await call(U.admin, 'PUT', '/payments/methods', { methods: [...methods, 'GCash'] });
ok('the Super Admin can add a method', changed.s === 200 && changed.d.methods.includes('GCash'));
if (methods.length) await call(U.admin, 'PUT', '/payments/methods', { methods });

console.log('\nRefused payments');
const code = (r) => r.d?.error?.code;
ok('approver cannot pay', (await pay(U.paolo, [a1])).s === 403);
ok('Super Admin cannot pay by default', (await pay(U.admin, [a1])).s === 403);
ok('receipts of two people in one payment are refused', code(await pay(U.rica, [a2, m1])) === 'MIXED_PAYEES');
ok('paying more than the receipt is refused', code(await pay(U.rica, [a1], { amounts: { [a1.id]: 1000.01 } })) === 'OVERPAID');
ok('paying less without a reason is refused', code(await pay(U.rica, [a1], { amounts: { [a1.id]: 999.99 } })) === 'SHORT_REASON');
ok('a zero amount is refused', (await pay(U.rica, [a1], { amounts: { [a1.id]: 0 } })).s === 400);
const future = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
ok('a future payment date is refused', code(await pay(U.rica, [a1], { paidOn: future })) === 'DATE_FUTURE');
ok('a method that is not on the list is refused', code(await pay(U.rica, [a1], { method: 'Bitcoin' })) === 'BAD_METHOD');
ok('a payment without proof is refused', code(await pay(U.rica, [a1], { noProof: true })) === 'PROOF_REQUIRED');
ok('a text file renamed .png is refused', code(await pay(U.rica, [a1], { proof: Buffer.from('this is not a picture at all'), proofName: 'proof.png' })) === 'BAD_FILE');
ok('the same receipt twice is refused', code(await pay(U.rica, [a1, a1])) === 'DUPLICATE_RECEIPT');
ok('a stale version is refused', code(await pay(U.rica, [{ ...a1, version: a1.version - 1 }])) === 'RECORD_CHANGED');
ok('a draft cannot be paid', (await pay(U.rica, [draft])).s === 404);
ok('after all that, the receipt is still approved', (await call(U.rica, 'GET', `/receipts/${a1.id}`)).d.receipt.status === 'approved');

console.log('\nNobody pays their own receipt');
const roles = (await call(U.admin, 'GET', '/roles')).d.roles;
const medrefRole = roles.find((r) => r.code === 'medref');
const grantsBefore = (await call(U.admin, 'GET', '/permissions')).d.grants[medrefRole.id];
try {
  await call(U.admin, 'PUT', `/roles/${medrefRole.id}/permissions`, { codes: [...grantsBefore, 'payment.mark'] });
  const own = await makeApproved(U, 'ana', 'Own receipt', 120);
  const r = await pay(U.ana, [own]);
  ok('a Med Ref with payment rights still cannot pay their own receipt', r.s === 403 && code(r) === 'OWN_RECEIPT');
} finally {
  await call(U.admin, 'PUT', `/roles/${medrefRole.id}/permissions`, { codes: grantsBefore });
}

console.log('\nPaying');
const p1 = await pay(U.rica, [a1], { method: 'Cash' });
ok('accounting pays one receipt', p1.s === 201 && /^PAY-\d{4}-\d{6}$/.test(p1.d.payment.paymentNo) && p1.d.payment.total === 1000);
const paid1 = (await call(U.rica, 'GET', `/receipts/${a1.id}`)).d.receipt;
ok('the receipt is Paid with a payment block', paid1.status === 'paid' && paid1.payment?.paymentNo === p1.d?.payment.paymentNo && paid1.payment.amount === 1000 && paid1.payment.method === 'Cash' && paid1.payment.recordedBy === 'Rica Tan');
ok('a paid receipt cannot be paid again', code(await pay(U.rica, [paid1])) === 'INVALID_STATE');
ok('a paid receipt cannot be edited by its owner', (await call(U.ana, 'PATCH', `/receipts/${a1.id}`, { payee: 'Changed', receiptDate: today(), amount: 1, birInvoice: false, vendorAddress: 'x', reasonForSpending: 'x', classification: 'fuel' })).s === 409);
ok('the approver can no longer take the approval back', (await call(U.paolo, 'POST', `/receipts/${a1.id}/undo`, { version: paid1.version, note: 'Trying' })).s === 409);
ok('the approver still sees the paid receipt', (await call(U.paolo, 'GET', `/receipts/${a1.id}`)).d?.receipt.status === 'paid');
ok('there is no plain /pay action route', (await call(U.rica, 'POST', `/receipts/${a2.id}/pay`, { version: a2.version })).s === 404);

const batch = await pay(U.rica, [a2, a3], { amounts: { [a3.id]: 700 }, reasons: { [a3.id]: 'Cash advance of 49.50 deducted' } });
ok('accounting pays two receipts of one person in one payment, one of them short', batch.s === 201 && batch.d.payment.count === 2 && batch.d.payment.total === 950.5);
const b3 = (await call(U.ana, 'GET', `/receipts/${a3.id}`)).d.receipt;
ok('the short receipt keeps its real amount and reason', b3.payment?.amount === 700 && b3.payment?.shortReason === 'Cash advance of 49.50 deducted');
const b2 = (await call(U.ana, 'GET', `/receipts/${a2.id}`)).d.receipt;
ok('both receipts share one payment number', !!b2.payment && b2.payment?.paymentNo === b3.payment?.paymentNo);

console.log('\nTwo people paying the same receipt at once');
const race = await makeApproved(U, 'ana', 'Race', 100);
const both = await Promise.all([pay(U.rica, [race]), pay(U.rica, [race])]);
ok('exactly one wins and the other gets a conflict', both.map((x) => x.s).sort().join() === '201,409');
const raced = (await call(U.rica, 'GET', `/receipts/${race.id}`)).d.receipt;
ok('the receipt is paid once', raced.status === 'paid' && both.some((x) => x.s === 201 && x.d.payment.paymentNo === raced.payment?.paymentNo));

console.log('\nProof of payment');
const proofUrl = (id, mode) => `${B}/payments/${id}/proof?mode=${mode}`;
const get = (c, url) => fetch(url, { headers: H(c, false) });
ok('the person who was paid can view the proof', (await get(U.ana, proofUrl(paid1.payment?.id, 'view'))).status === 200);
ok('accounting can download the proof', !!(await get(U.rica, proofUrl(paid1.payment?.id, 'download'))).headers.get('content-disposition')?.startsWith('attachment'));
ok('another Med Ref cannot see it', (await get(U.mark, proofUrl(paid1.payment?.id, 'view'))).status === 404);
const audit = (await call(U.admin, 'GET', `/audit?action=payment.proof_&q=${encodeURIComponent(paid1.payment?.paymentNo ?? 'none')}`)).d;
ok('every proof view and download is in the audit log', (audit?.items ?? []).length >= 2);

console.log('\nNotices');
const anaNotes = (await call(U.ana, 'GET', '/notifications')).d.items;
ok('the Med Ref has an in-app notice with the payment number', anaNotes.some((n) => n.text.includes(p1.d?.payment.paymentNo)));
const ricaNotes = (await call(U.rica, 'GET', '/notifications')).d.items;
ok('accounting was told a receipt is ready to pay', ricaNotes.some((n) => n.text.includes('ready to pay')));
const mails = (await call(U.admin, 'GET', '/email-log')).d.items;
ok('one "paid" email per payment went to the Med Ref', mails.filter((e) => e.template === 'paid' && e.to === 'ana.reyes@example.com').length >= 2);
ok('accounting got no email about approvals', !mails.some((e) => e.to === 'accounting@example.com'));
const dash2 = (await call(U.rica, 'GET', '/dashboard')).d;
ok('paid this month went up', dash2.paidThisMonth.count >= 4 && dash2.paidThisMonth.total >= 2050.5);

// END OF CHECKS
done();
