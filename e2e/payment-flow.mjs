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

// END OF CHECKS
done();
