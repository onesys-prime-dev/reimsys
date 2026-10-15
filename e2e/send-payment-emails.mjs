// Sends the two payment emails ("Reimbursement paid" and "Payment reversed") to ONE real address using test mode.
// Uses the mail account already saved in the app and puts test mode back as it was afterwards.
// Usage: node e2e/send-payment-emails.mjs you@example.com
import { call, loginAll, makeApproved, pay } from './payment-helpers.mjs';

const TO = process.argv[2];
if (!TO) { console.error('Usage: node e2e/send-payment-emails.mjs <address that should receive everything>'); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const U = await loginAll();

/* 1. Test mode on, keeping the saved account and password exactly as they are */
const before = (await call(U.admin, 'GET', '/settings/mail')).d.mail;
if (before.source !== 'database' || !before.hasPassword) { console.error('No mail account is saved in the app yet. Save one under Access, Email first.'); process.exit(1); }
const keep = { host: before.host, port: before.port, secure: before.secure, user: before.user, fromName: before.fromName, fromAddress: before.fromAddress };
const set = (testRedirect) => call(U.admin, 'PUT', '/settings/mail', { ...keep, testRedirect });
if ((await set(TO)).s !== 200) { console.error('Could not turn on test mode.'); process.exit(1); }
console.log(`Test mode ON. Everything goes to ${TO}, sent as ${keep.fromAddress} through ${keep.host}.`);
const startId = (await call(U.admin, 'GET', '/email-log')).d.items[0]?.id ?? 0;

let exitCode = 1;
try {
  /* 2. Two receipts approved, paid together (one short), then one payment reversed */
  const a = await makeApproved(U, 'ana', 'Mercury Drug - Mandaue', 1284.5);
  const b = await makeApproved(U, 'ana', 'Shell Mandaue', 700);
  const p = await pay(U.rica, [a, b], { method: 'Bank transfer', amounts: { [b.id]: 600 }, reasons: { [b.id]: 'Cash advance of 100.00 deducted' } });
  if (p.s !== 201) throw new Error('payment failed: ' + JSON.stringify(p.d));
  console.log(`Paid ${a.refNo} and ${b.refNo} as ${p.d.payment.paymentNo}  → "Reimbursement paid" email`);
  const paidA = (await call(U.rica, 'GET', `/receipts/${a.id}`)).d.receipt;
  const rev = await call(U.rica, 'POST', `/receipts/${a.id}/reverse_payment`, { version: paidA.version, note: 'Recorded against the wrong bank account. It will be paid again today.' });
  if (rev.s !== 200) throw new Error('reversal failed: ' + JSON.stringify(rev.d));
  console.log(`Reversed the payment on ${a.refNo}  → "Payment reversed" email`);

  /* 3. Wait until the payment emails have been sent or have failed */
  let rows = [];
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    rows = (await call(U.admin, 'GET', '/email-log')).d.items.filter((e) => e.id > startId && (e.template === 'paid' || e.template === 'payment_reversed'));
    if (rows.length >= 2 && rows.every((e) => ['sent', 'failed', 'logged'].includes(e.status))) break;
  }
  for (const e of rows.sort((x, y) => x.id - y.id)) console.log(`  ${e.template.padEnd(17)} ${e.subject}  →  ${e.status}${e.error ? '  ' + e.error : ''}`);
  exitCode = rows.length >= 2 && rows.every((e) => e.status === 'sent') ? 0 : 1;
} finally {
  /* 4. Put test mode back exactly as it was */
  const off = await set(before.testRedirect || '');
  console.log(`Test mode ${before.testRedirect ? 'restored to ' + before.testRedirect : 'OFF'} (${off.s === 200 ? 'ok' : 'FAILED to restore'}).`);
}
process.exit(exitCode);
