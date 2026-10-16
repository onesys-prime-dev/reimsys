// Checks that nobody can take two steps on the same receipt: check then approve, or check/approve then pay. Needs the API (4000).
// Uses the Super Admin for the "same person" cases, so it only applies when that role has the rights (they can be granted on the Access page).
// Usage: node e2e/separation.mjs
import { call, checker, loginAll, makeDraft, pay, B, H } from './payment-helpers.mjs';

const { ok, done } = checker();
const U = await loginAll();
const code = (r) => r.d?.error?.code;
const perms = (await call(U.admin, 'GET', '/me')).d.permissions;
const look = (c, r) => fetch(`${B}/receipts/${r.id}/evidence/${r.evidence[0].id}/file?mode=view`, { headers: H(c, false) });
const submitted = async (name) => {
  const r = await makeDraft(U, 'ana', name, 310);
  return (await call(U.ana, 'POST', `/receipts/${r.id}/submit`, { version: r.version })).d.receipt;
};

if (perms.includes('review.check') && perms.includes('review.decide')) {
  console.log('Checking and then approving');
  const r = await submitted('Same person A');
  await look(U.admin, r);
  const checked = await call(U.admin, 'POST', `/receipts/${r.id}/check`, { version: r.version });
  ok('the admin can check', checked.s === 200);
  await look(U.admin, checked.d.receipt);
  const own = await call(U.admin, 'POST', `/receipts/${r.id}/approve`, { version: checked.d.receipt.version });
  ok('the person who checked cannot also approve', own.s === 403 && code(own) === 'SAME_PERSON');
  ok('nor disapprove', code(await call(U.admin, 'POST', `/receipts/${r.id}/disapprove`, { version: checked.d.receipt.version, note: 'no' })) === 'SAME_PERSON');
  await look(U.paolo, checked.d.receipt);
  const other = await call(U.paolo, 'POST', `/receipts/${r.id}/approve`, { version: checked.d.receipt.version });
  ok('a different approver can', other.s === 200);

  if (perms.includes("payment.mark") && other.s === 200) {
    console.log('Paying');
    ok('the person who checked cannot pay it either', code(await pay(U.admin, [other.d.receipt])) === 'SAME_PERSON');
    const rp = await pay(U.rica, [other.d.receipt]); if (rp.s !== 201) console.log(JSON.stringify(rp.d)); ok("the Accounting user can", rp.s === 201);
  }
} else console.log('  note: the Super Admin lacks review rights in this database, so the same-person checks are skipped');

console.log('Normal flow is untouched');
const n = await submitted('Different people');
await look(U.liza, n);
const c = await call(U.liza, 'POST', `/receipts/${n.id}/check`, { version: n.version });
await look(U.paolo, c.d.receipt);
const a = await call(U.paolo, 'POST', `/receipts/${n.id}/approve`, { version: c.d.receipt.version });
ok('check, approve and pay by three different people works', a.s === 200 && (await pay(U.rica, [a.d.receipt])).s === 201);
done();
