// Checks the potential tax loss and savings on the dashboard and the employee evaluation, against a running API: the figures follow the Tax withheld answer,
// a Med Ref sees only their own, management sees every employee, and the totals add up. Needs the API (4000). Usage: node e2e/tax-impact.mjs
import { call, loginAll, today, PNG, B, H } from './payment-helpers.mjs';

const U = await loginAll();
let failed = 0;
const check = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : x); if (!c) failed++; };
const stamp = Date.now();
const DAY = new Date(Date.UTC(2000, 0, 1) + (stamp % 7000) * 86_400_000).toISOString().slice(0, 10); // a day no other run uses, so the figures below are exact

const settings = (await call(U.admin, 'GET', '/app-settings')).d.settings;
check('the default withholding rate is a setting', typeof settings.defaultWhtRate === 'number' && settings.defaultWhtRate > 0, JSON.stringify(settings));
await call(U.admin, 'PUT', '/app-settings', { ...settings, defaultWhtRate: 2, askWithholding: true, requireVendorTin: true });

const base = { receiptDate: DAY, amount: 1120, birInvoice: true, invoiceUnderCompany: false, vendorAddress: 'Cebu', vendorTin: '123-456-789-00000', transactionType: 'product', vatType: 'vatable', vatableAmount: 1000, vatAmount: 120, reasonForSpending: 'Supplies', classification: 'meal_personal', vatExemptAmount: 0, discountAmount: 0, chargeLocationId: 1, detailsReviewed: true };
async function upload(url, headers, make) { for (let i = 0; i < 8; i++) { const r = await fetch(url, { method: 'POST', headers, body: make() }); if (r.status !== 429) return r; await new Promise((x) => setTimeout(x, 10_000)); } } // the upload limit is 60 a minute, which the tests before this one can use up
async function submitted(c, extra) {
  const r = (await call(c, 'POST', '/receipts', { ...base, ...extra })).d?.receipt;
  if (!r) throw new Error('could not create ' + JSON.stringify(extra));
  await upload(`${B}/receipts/${r.id}/evidence`, H(c, false), () => { const f = new FormData(); f.append('files', new Blob([Buffer.concat([PNG, Buffer.from(String(stamp) + extra.invoiceNo)])], { type: 'image/png' }), 'p.png'); return f; });
  const cur = (await call(c, 'GET', `/receipts/${r.id}`)).d.receipt;
  const s = await call(c, 'POST', `/receipts/${r.id}/submit`, { version: cur.version });
  if (s.s !== 200) throw new Error('submit failed ' + JSON.stringify(s.d));
  return s.d.receipt;
}

console.log('The receipt shows what the answer costs');
const no = await submitted(U.ana, { payee: 'Tax No ' + stamp, invoiceNo: 'TN-' + stamp, withheld: false });
const yes = await submitted(U.ana, { payee: 'Tax Yes ' + stamp, invoiceNo: 'TY-' + stamp, withheld: true, whtRate: 1, whtAmount: 10 });
const dNo = (await call(U.ana, 'GET', `/receipts/${no.id}`)).d.receipt;
const dYes = (await call(U.ana, 'GET', `/receipts/${yes.id}`)).d.receipt;
check('No: tax on the gross (22.40) instead of the net (20.00): a potential loss of 2.40', dNo.impact.ifNo === 22.4 && dNo.impact.ifYes === 20 && dNo.impact.potentialLoss === 2.4 && dNo.impact.potentialSavings === 0, JSON.stringify(dNo.impact));
check('Yes: the typed rate is used on the net amount, and the saving is 1.20', dYes.impact.rate === 1 && dYes.impact.rateSource === 'entered' && dYes.impact.ifYes === 10 && dYes.impact.ifNo === 11.2 && dYes.impact.potentialSavings === 1.2 && dYes.impact.potentialLoss === 0, JSON.stringify(dYes.impact));
check('an answer of No counts as an incomplete receipt', dNo.incompleteReasons.includes('Tax withheld answered No') && dYes.incompleteReasons.length === 0, JSON.stringify([dNo.incompleteReasons, dYes.incompleteReasons]));

console.log('\nThe Med Ref sees only their own');
const q = `?from=${DAY}&to=${DAY}`;
const own = (await call(U.ana, 'GET', '/dashboard/tax-impact' + q)).d;
check('scope is "own" and there is no employee list', own.scope === 'own' && own.employees.length === 0, JSON.stringify(own.scope));
check('the totals are exactly this Med Ref\'s receipts', own.totals.receipts === 2 && own.totals.potentialLoss === 2.4 && own.totals.potentialSavings === 1.2 && own.totals.taxWithheld === 10 && own.totals.answeredNo === 1 && own.totals.answeredYes === 1 && own.totals.incomplete === 1, JSON.stringify(own.totals));
const other = (await call(U.mark, 'GET', '/dashboard/tax-impact' + q)).d;
check('another Med Ref sees none of them', other.totals.receipts === 0 && other.totals.potentialLoss === 0 && other.employees.length === 0, JSON.stringify(other.totals));

console.log('\nManagement sees every employee');
const all = (await call(U.admin, 'GET', '/dashboard/tax-impact' + q)).d;
check('scope is "all"', all.scope === 'all');
check('the company totals match', all.totals.receipts === 2 && all.totals.potentialLoss === 2.4 && all.totals.potentialSavings === 1.2, JSON.stringify(all.totals));
const ana = all.employees.find((e) => e.submissions.some((s) => s.id === no.id));
check('the employee evaluation names the person, with the loss and the submission', !!ana && ana.potentialLoss === 2.4 && ana.answeredNo === 1 && ana.incomplete === 1 && ana.submissions.length === 1 && ana.submissions[0].refNo === no.refNo, JSON.stringify(all.employees));
check('the employee rows add up to the company totals', Math.abs(all.employees.reduce((t, e) => t + e.potentialLoss, 0) - all.totals.potentialLoss) < 0.005);
check('the largest-loss list has the receipt, with the reason', all.worst[0]?.id === no.id && all.worst[0].reasons.includes('Tax withheld answered No'), JSON.stringify(all.worst));
check('the monthly figures add up to the totals', Math.abs(all.months.reduce((t, m) => t + m.potentialLoss, 0) - all.totals.potentialLoss) < 0.005 && all.months.every((m) => /^\d{4}-\d{2}$/.test(m.month)));
const onlyAna = (await call(U.admin, 'GET', '/dashboard/tax-impact' + q + `&employeeId=${999999}`)).d;
check('filtering by an employee with no receipts gives zero', onlyAna.totals.receipts === 0);

console.log('\nThe default rate follows the setting');
await call(U.admin, 'PUT', '/app-settings', { ...settings, defaultWhtRate: 5, askWithholding: true });
const dNo5 = (await call(U.ana, 'GET', `/receipts/${no.id}`)).d.receipt;
check('at 5% the potential loss of the No receipt is 6.00 (5% of the 120 VAT)', dNo5.impact.potentialLoss === 6, JSON.stringify(dNo5.impact));
check('the dashboard follows', (await call(U.ana, 'GET', '/dashboard/tax-impact' + q)).d.totals.potentialLoss === 6);
check('a rate over 100 is refused', (await call(U.admin, 'PUT', '/app-settings', { ...settings, defaultWhtRate: 150 })).s === 400);
await call(U.admin, 'PUT', '/app-settings', settings);

console.log('\nAdministrator: the whole, and one person at a time');
{
  const whole = (await call(U.admin, 'GET', '/dashboard/tax-impact')).d;
  const first = whole.people[0];
  check('the list of people comes with the figures', whole.scope === 'all' && whole.people.length >= 1 && whole.people.every((x) => x.id && x.name), JSON.stringify(whole.people));
  const one = (await call(U.admin, 'GET', '/dashboard/tax-impact?employeeId=' + first.id)).d;
  check('one person: only their receipts', one.employeeId === first.id && one.employees.every((e) => e.employeeId === first.id) && one.worst.every((w) => w.employeeId === first.id), JSON.stringify(one.totals));
  check('and the list of people does not shrink when one is chosen', one.people.length === whole.people.length);
  const sum = whole.people.length === 1 ? whole.totals.potentialLoss : null;
  let total = 0;
  for (const x of whole.people) total += (await call(U.admin, 'GET', '/dashboard/tax-impact?employeeId=' + x.id)).d.totals.potentialLoss;
  check('the people add up to the whole', Math.abs(total - whole.totals.potentialLoss) < 0.011, total + ' vs ' + whole.totals.potentialLoss);
  const peek = (await call(U.ana, 'GET', '/dashboard/tax-impact?employeeId=' + (first.id + 1000))).d;
  check('a Med Ref who asks for someone else still gets only their own, and no list of people', peek.scope === 'own' && peek.people.length === 0 && peek.employeeId === null, JSON.stringify(peek.totals));
}

console.log('\nNot signed in');
check('the figures need a sign-in', (await fetch(B + '/dashboard/tax-impact', { headers: { 'x-requested-with': 'reimsys' } })).status === 401);
console.log(failed ? `\n${failed} FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
