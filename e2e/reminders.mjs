// Checks the reminders for receipts that have waited too long. Needs the API (4000) and the MySQL tools of XAMPP (to make receipts look old).
// Usage: node e2e/reminders.mjs
import { spawnSync } from 'node:child_process';
import { B, H, call, checker, loginAll, makeDraft } from './payment-helpers.mjs';

const { ok, done } = checker();
const U = await loginAll();
const look = (c, r) => fetch(`${B}/receipts/${r.id}/evidence/${r.evidence[0].id}/file?mode=view`, { headers: H(c, false) });
const sql = (q) => { const r = spawnSync(process.env.MYSQL ?? 'C:/xampp/mysql/bin/mysql.exe', ['-uroot', 'reimsys', '-e', q], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); };
const step = async (c, r, action, body = {}) => { const x = await call(c, 'POST', `/receipts/${r.id}/${action}`, { version: r.version, ...body }); if (x.s !== 200) throw new Error(`${action}: ${x.s}`); return x.d.receipt; };

// One receipt at each waiting stage, plus one that has not waited long.
const make = async (name) => step(U.ana, await makeDraft(U, 'ana', name, 520), 'submit');
const waitCheck = await make('Remind check');
const waitDecide = await step(U.liza, await (async () => { const r = await make('Remind decide'); await look(U.liza, r); return r; })(), 'check');
const waitPay = await (async () => { let r = await make('Remind pay'); await look(U.liza, r); r = await step(U.liza, r, 'check'); await look(U.paolo, r); return step(U.paolo, r, 'approve'); })();
const waitFix = await (async () => { const r = await make('Remind fix'); await look(U.liza, r); return step(U.liza, r, 'return', { note: 'Please retake.' }); })();
const fresh = await make('Remind fresh');
// A reminder lists every overdue receipt in one notice, and a development copy keeps the old ones from earlier test runs, which would push these five out of the
// notice text. So the other waiting receipts are made to look new first (their waiting clocks are reset; nothing else about them changes).
const mine = [waitCheck, waitDecide, waitPay, waitFix, fresh].map((r) => r.id).join(',');
sql(`UPDATE receipt SET submittedAt = UTC_TIMESTAMP(3), checkedAt = IF(checkedAt IS NULL, NULL, UTC_TIMESTAMP(3)), decidedAt = IF(decidedAt IS NULL, NULL, UTC_TIMESTAMP(3)), updatedAt = UTC_TIMESTAMP(3) WHERE id NOT IN (${mine}) AND status IN ('submitted','checked','approved','returned');`);
sql(`UPDATE receipt SET submittedAt = UTC_TIMESTAMP(3) - INTERVAL 6 DAY WHERE id = ${waitCheck.id};
     UPDATE receipt SET checkedAt = UTC_TIMESTAMP(3) - INTERVAL 6 DAY WHERE id = ${waitDecide.id};
     UPDATE receipt SET decidedAt = UTC_TIMESTAMP(3) - INTERVAL 6 DAY WHERE id = ${waitPay.id};
     UPDATE receipt SET updatedAt = UTC_TIMESTAMP(3) - INTERVAL 6 DAY WHERE id = ${waitFix.id};`);

const sent = await call(U.admin, 'POST', '/email-log/reminders-now', {});
ok('an administrator can send the reminders now', sent.s === 200 && sent.d.sent > 0);

const notes = async (who) => (await call(U[who], 'GET', '/notifications')).d.items.filter((n) => n.type === 'reminder').map((n) => n.text).join(' | ');
const [liza, paolo, rica, ana] = [await notes('liza'), await notes('paolo'), await notes('rica'), await notes('ana')];
ok('the Checker is reminded about the receipt waiting to be checked', liza.includes(waitCheck.refNo));
ok('the Approver is reminded about the receipt waiting for a decision', paolo.includes(waitDecide.refNo));
ok('Accounting is reminded about the approved receipt waiting to be paid', rica.includes(waitPay.refNo));
ok('the Med Ref is reminded about the returned receipt', ana.includes(waitFix.refNo));
ok('nobody is reminded about a receipt that has not waited long', ![liza, paolo, rica, ana].some((t) => t.includes(fresh.refNo)));
ok('the Approver is not reminded about things only the Checker can do', !paolo.includes(waitCheck.refNo));
ok('the Med Ref is not reminded about stages that are not theirs', !ana.includes(waitCheck.refNo) && !ana.includes(waitDecide.refNo));

const anaNotes = (await call(U.ana, 'GET', '/notifications')).d.items.filter((n) => n.type === 'reminder');
ok('the notice opens a receipt when clicked', anaNotes.some((n) => Number.isInteger(n.receiptId)));

const mails = (await call(U.admin, 'GET', '/email-log')).d.items;
ok('the reminder went out as an email too', mails.some((e) => e.template === 'reminder' && e.to === 'liza.santos@example.com'));
done();
