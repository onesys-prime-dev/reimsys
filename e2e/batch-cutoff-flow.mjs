// Checks batch cutoffs and late additions through the API: repeating schedules, one batch's own cutoff, the worker filling and
// closing a batch at its time, the next batch opening, latecomers, empty runs, more than one batch's worth, claims, pausing,
// changing and deleting schedules, who may choose what, and adding receipts late with a reason.
// Needs the API (4000) running with the seed applied, and MySQL at C:/xampp. Usage: node e2e/batch-cutoff-flow.mjs
import { execFileSync } from 'node:child_process';
import { B, F, H, PNG, call, checker, login, loginAll, tag, today } from './payment-helpers.mjs';

const { ok, done } = checker();
const U = await loginAll();
U.manager = await login('manager@example.com');
console.log(`Run tag: ${tag}`);
const sql = (q) => execFileSync(process.env.MYSQL ?? 'C:/xampp/mysql/bin/mysql.exe', ['-u', 'root', 'reimsys', '-N', '-B'], { input: q, encoding: 'utf8' }).trim();
const DAY = 86_400_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms = 80_000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await sleep(2000); } };
const view = (c, r) => fetch(`${B}/receipts/${r.id}/evidence/${r.evidence[0].id}/file?mode=view`, { headers: H(c, false) });
const batch = async (id, c = U.admin) => (await call(c, 'GET', `/batches/${id}`)).d?.batch;
const receipt = async (id, c = U.admin) => (await call(c, 'GET', `/receipts/${id}`)).d?.receipt;
const notes = async (c) => (await call(c, 'GET', '/notifications')).d.items;
const lastNote = async (c) => Math.max(0, ...(await notes(c)).map((n) => n.id));
const since = async (c, id) => (await notes(c)).filter((n) => n.id > id);
const schedules = async () => (await call(U.admin, 'GET', '/batch-schedules')).d.schedules;
const manilaWeekday = (t = new Date()) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', weekday: 'short' }).format(t));
const isFridayFivePm = (iso) => { const t = new Date(iso); return t.getUTCDay() === 5 && t.getUTCHours() === 9 && t.getUTCMinutes() === 0; };

async function step(c, r, action, note) {
  const res = await call(c, 'POST', `/receipts/${r.id}/${action}`, { version: r.version, ...(note ? { note } : {}) });
  if (res.s !== 200) throw new Error(`${action} on ${r.refNo} failed: ${res.s} ${JSON.stringify(res.d)}`);
  return res.d.receipt;
}
/** A receipt charged to `loc`, taken as far as `stage`. */
async function make(owner, name, amount, loc, stage) {
  const c = U[owner];
  let r = (await call(c, 'POST', '/receipts', { payee: `${name} ${tag}`, receiptDate: today(), amount, ...F, chargeLocationId: loc, description: 'Created by the cutoff test' })).d.receipt;
  const f = new FormData();
  f.append('files', new Blob([Buffer.concat([PNG, Buffer.from(name + tag + Math.random())])], { type: 'image/png' }), 'receipt.png');
  r = (await (await fetch(`${B}/receipts/${r.id}/evidence`, { method: 'POST', headers: H(c, false), body: f })).json()).receipt;
  if (stage === 'draft') return r;
  r = await step(c, r, 'submit');
  if (stage === 'submitted') return r;
  await view(U.liza, r);
  if (stage === 'returned') return step(U.liza, r, 'return', 'Please fix the photo.');
  r = await step(U.liza, r, 'check');
  if (stage === 'checked') return r;
  await view(U.paolo, r);
  if (stage === 'reserved') return step(U.paolo, r, 'reserve', 'Waiting for the rate.');
  return step(U.paolo, r, 'approve');
}
const ids = (b) => b.receipts.map((r) => r.id).sort((x, y) => x - y);
async function place(name) {
  const r = await call(U.admin, 'POST', '/charge-locations', { name: `${name} ${tag}` });
  if (r.s !== 201) throw new Error('could not add a place ' + JSON.stringify(r.d));
  return r.d.location.id;
}
const L1 = await place('Cutoff A'), L2 = await place('Cutoff B'), L3 = await place('Cutoff C'), L4 = await place('Cutoff D'), L5 = await place('Cutoff E');
const approved = (loc) => ({ statuses: 'approved', chargeLocationIds: [loc] });

console.log('\nWho may set up repeating cutoffs');
for (const k of ['ana', 'liza', 'paolo', 'rica']) ok(`${k} cannot open the schedules`, (await call(U[k], 'GET', '/batch-schedules')).s === 403);
ok('the Super Admin can', (await call(U.admin, 'GET', '/batch-schedules')).s === 200);
ok('the Admin can', (await call(U.manager, 'GET', '/batch-schedules')).s === 200);
const choices = (await call(U.admin, 'GET', '/batch-schedules/choices')).d;
ok('the form offers the places, the people who encode, and the system time zone', choices.locations.some((l) => l.id === L1) && choices.people.some((p) => p.name === 'Ana Reyes') && choices.timeZone === 'Asia/Manila' && choices.canUseInProgress === true);

console.log('\nA schedule opens its batch');
const base = { name: `Weekly ${tag}`, repeat: 'weekly', days: [5], time: '17:00', timeZone: 'Asia/Manila', rule: approved(L1) };
ok('days that do not fit are refused', (await call(U.admin, 'POST', '/batch-schedules', { ...base, days: ['L'] })).s === 400);
ok('a bad time zone is refused', (await call(U.admin, 'POST', '/batch-schedules', { ...base, timeZone: 'Mars/Base' })).s === 400);
ok('Accounting cannot make one', (await call(U.rica, 'POST', '/batch-schedules', base)).s === 403);
const made = await call(U.admin, 'POST', '/batch-schedules', base);
ok('the Super Admin makes "every Friday at 5 PM"', made.s === 201 && made.d.batch, JSON.stringify(made.d));
const SID = made.d.schedule.id;
let B1 = made.d.batch;
ok('its batch has the coming Friday 5 PM (Manila) as cutoff', isFridayFivePm(B1.cutoffAt) && new Date(B1.cutoffAt) > new Date() && new Date(B1.cutoffAt) - Date.now() <= 7 * DAY, B1.cutoffAt);
let b1 = await batch(B1.id);
ok('the batch shows its cutoff, rule and schedule', b1.cutoff?.state === 'pending' && b1.schedule?.name === base.name && /approved receipts approved before then, charged to Cutoff A/.test(b1.cutoff.ruleText), JSON.stringify(b1.cutoff));
ok('it is named after the schedule and the date', b1.name.startsWith(`${base.name} · `));
const listed = (await call(U.admin, 'GET', '/batches')).d.batches.find((x) => x.id === B1.id);
ok('the list shows its cutoff and schedule', listed?.cutoffAt === B1.cutoffAt && listed.schedule?.id === SID);
const sch = (await schedules()).find((s) => s.id === SID);
ok('the schedule says when in plain words and points at its batch', sch.when === 'Every Friday at 5:00 PM (Asia/Manila)' && sch.current?.id === B1.id);
ok('its open batch cannot be deleted', (await call(U.admin, 'DELETE', `/batches/${B1.id}`)).d?.error?.code === 'SCHEDULE_BATCH');

console.log('\nWhat it would take');
const A1 = await make('ana', 'Cut A1', 100, L1, 'approved');
const A2 = await make('mark', 'Cut A2', 200, L1, 'approved');
const S1 = await make('ana', 'Cut S1', 50, L1, 'submitted');
const R1 = await make('ana', 'Cut R1', 60, L1, 'returned');
const V1 = await make('mark', 'Cut V1', 70, L1, 'reserved');
const X1 = await make('ana', 'Cut X1', 80, L2, 'approved');
const O1 = await make('ana', 'Cut O1', 90, L1, 'approved');
const other = (await call(U.admin, 'POST', '/batches', { name: `Other ${tag}`, receiptIds: [O1.id] })).d.batch;
b1 = await batch(B1.id);
ok('the batch page says 2 receipts would be added now (PHP 300)', b1.wouldAdd?.count === 2 && b1.wouldAdd.total === 300, JSON.stringify(b1.wouldAdd));
const pv = (await call(U.admin, 'POST', '/batches/cutoff-preview', { rule: approved(L1) })).d;
ok('the form preview agrees', pv.count === 2 && pv.total === 300);

console.log('\nAt the cutoff, the worker fills and closes the batch, and opens the next');
// Three batches come due at once: the schedule's, one whose run died over ten minutes ago, and one being run right now elsewhere.
const H1 = (await call(U.admin, 'POST', '/batches', { name: `Stale claim ${tag}`, cutoffAt: new Date(Date.now() + DAY).toISOString(), cutoffRule: approved(L5) })).d.batch;
const H2 = (await call(U.admin, 'POST', '/batches', { name: `Fresh claim ${tag}`, cutoffAt: new Date(Date.now() + DAY).toISOString(), cutoffRule: approved(L5) })).d.batch;
const E1 = await make('ana', 'Cut E1', 40, L5, 'approved');
const ricaBefore = await lastNote(U.rica);
sql(`UPDATE batch SET cutoffAt = UTC_TIMESTAMP(3) WHERE id IN (${B1.id}, ${H1.id}, ${H2.id});
UPDATE batch SET cutoffClaimedAt = UTC_TIMESTAMP(3) - INTERVAL 11 MINUTE WHERE id = ${H1.id};
UPDATE batch SET cutoffClaimedAt = UTC_TIMESTAMP(3) - INTERVAL 1 MINUTE WHERE id = ${H2.id};`);
b1 = await waitFor(async () => { const x = await batch(B1.id); return x.closed ? x : null; });
ok('within a minute or so the batch is closed by its cutoff', !!b1 && b1.cutoff?.state === 'ran');
ok('it took the two approved receipts of that place, nothing else', b1 && JSON.stringify(ids(b1)) === JSON.stringify([A1.id, A2.id].sort((x, y) => x - y)), JSON.stringify(b1 && ids(b1)));
ok('a submitted, a returned and a reserved receipt stay out, and so does another place', [S1, R1, V1, X1].every((r) => !b1.receipts.some((x) => x.id === r.id)));
ok('a receipt in another batch stays there', (await receipt(O1.id)).batch?.id === other.id);
const h1 = await batch(H1.id);
ok('a run that died ten minutes ago is taken over', h1.closed && h1.receipts.length === 1 && h1.receipts[0].id === E1.id);
const h2 = await batch(H2.id);
ok('a batch another run holds right now is left alone', !h2.closed && h2.cutoff.state === 'pending' && h2.cutoff.running);
ok('and nobody can change it meanwhile', (await call(U.admin, 'PUT', `/batches/${H2.id}/cutoff`, { cutoffAt: null })).d?.error?.code === 'CUTOFF_RUNNING');
sql(`UPDATE batch SET cutoffClaimedAt = NULL WHERE id = ${H2.id}`);
ok('once free, its cutoff can be removed', (await call(U.admin, 'PUT', `/batches/${H2.id}/cutoff`, { cutoffAt: null })).s === 200 && (await batch(H2.id)).cutoff === null);
let sNow = (await schedules()).find((s) => s.id === SID);
const B2 = sNow.current;
ok('the schedule opened its next batch, with the next Friday', B2 && B2.id !== B1.id && isFridayFivePm(B2.cutoffAt) && new Date(B2.cutoffAt) > new Date(), JSON.stringify(sNow.current));
ok('and remembers the run', sNow.lastBatch?.id === B1.id && sNow.lastCount === 2);
const ricaNew = (await since(U.rica, ricaBefore)).filter((n) => n.batchId === B1.id);
ok('Accounting is told once', ricaNew.length === 1 && /closed at cutoff/.test(ricaNew[0].text) && /2 receipts were added/.test(ricaNew[0].text), JSON.stringify(ricaNew));
// Read from the database: the email log page shows the newest 25, and a cutoff emails everyone who makes batches.
ok('and emailed with the cutoff template', sql(`SELECT COUNT(*) FROM emaillog WHERE template = 'batch_cutoff' AND toEmail = 'accounting@example.com' AND subject LIKE '%${b1.code}%'`) === '1');
ok('the run is in the history as the system', sql(`SELECT actorName FROM auditlog WHERE action = 'batch.cutoff_run' AND entityId = '${B1.id}'`) === `System (cutoff schedule ${base.name})`);
ok('each receipt has its line in the history', Number(sql(`SELECT COUNT(*) FROM auditlog WHERE action = 'batch.receipt_added' AND entityType = 'receipt' AND entityId IN ('${A1.id}', '${A2.id}') AND summary LIKE '%at its cutoff'`)) === 2);

console.log('\nReopening never runs it again');
ok('reopen', (await call(U.admin, 'PATCH', `/batches/${B1.id}`, { closed: false })).s === 200);
const A6 = await make('mark', 'Cut A6', 30, L1, 'approved');
ok('a reopened cut-off batch still needs a reason to add', (await call(U.admin, 'POST', `/batches/${B1.id}/receipts`, { receiptIds: [A6.id] })).d?.error?.code === 'LATE_REASON_REQUIRED');
ok('close again', (await call(U.admin, 'PATCH', `/batches/${B1.id}`, { closed: true })).s === 200);
ok('its cutoff still counts as run', (await batch(B1.id)).cutoff.state === 'ran');

console.log('\nLatecomers go to the next run; Run now uses up the slot');
const A3 = await make('ana', 'Cut A3', 300, L1, 'approved');
let b2 = await batch(B2.id);
ok('the next batch would take the latecomers (the late A6 and A3)', b2.wouldAdd?.count === 2, JSON.stringify(b2.wouldAdd));
const run2 = await call(U.rica, 'POST', `/batches/${B2.id}/cutoff/run`, {});
ok('Accounting runs the cutoff early', run2.s === 200 && run2.d.ran.kind === 'ran' && run2.d.ran.added === 2, JSON.stringify(run2.d));
b2 = await batch(B2.id);
ok('the batch is closed with them', b2.closed && b2.receipts.some((r) => r.id === A3.id));
ok('the run is recorded as that person', sql(`SELECT actorName FROM auditlog WHERE action = 'batch.cutoff_run' AND entityId = '${B2.id}'`) === 'Rica Tan');
sNow = (await schedules()).find((s) => s.id === SID);
const B3 = sNow.current;
ok('the next batch gets the slot after the planned one, a week on, not the same Friday again', new Date(B3.cutoffAt) - new Date(B2.cutoffAt) === 7 * DAY, `${B2.cutoffAt} -> ${B3.cutoffAt}`);
ok('running again says there is nothing waiting', (await call(U.rica, 'POST', `/batches/${B2.id}/cutoff/run`, {})).s === 409);

console.log('\nTwo runs at once give one result');
const A4 = await make('mark', 'Cut A4', 40, L1, 'approved');
const both = await Promise.all([call(U.rica, 'POST', `/batches/${B3.id}/cutoff/run`, {}), call(U.admin, 'POST', `/batches/${B3.id}/cutoff/run`, {})]);
ok('one runs, the other is told it is running or done', both.filter((x) => x.s === 200).length === 1 && both.filter((x) => x.s === 409).length === 1, JSON.stringify(both.map((x) => x.s)));
ok('the receipt is in that batch once', (await receipt(A4.id)).batch?.id === B3.id);
ok('one batch opened next, not two', Number(sql(`SELECT COUNT(*) FROM batch WHERE scheduleId = ${SID} AND cutoffDoneAt IS NULL`)) === 1);

console.log('\nNothing to take: the batch waits for the next slot');
sNow = (await schedules()).find((s) => s.id === SID);
const B4 = sNow.current;
const empty = await call(U.admin, 'POST', `/batches/${B4.id}/cutoff/run`, {});
ok('the run finds nothing', empty.s === 200 && empty.d.ran.kind === 'empty', JSON.stringify(empty.d));
let b4 = await batch(B4.id);
ok('the batch stays open, a week later, renamed to the new date', !b4.closed && b4.cutoff.state === 'pending' && new Date(b4.cutoffAt) - new Date(B4.cutoffAt) === 7 * DAY && b4.name !== B4.name, `${B4.cutoffAt} -> ${b4.cutoffAt}`);
ok('no empty closed batch was left', Number(sql(`SELECT COUNT(*) FROM batch WHERE scheduleId = ${SID} AND closedAt IS NOT NULL AND id NOT IN (SELECT DISTINCT batchId FROM receipt WHERE batchId IS NOT NULL)`)) === 0);

console.log('\nClosing before the cutoff cancels it');
ok('close it by hand', (await call(U.admin, 'PATCH', `/batches/${B4.id}`, { closed: true })).s === 200);
b4 = await batch(B4.id);
ok('its cutoff is cancelled, nothing is added', b4.cutoff?.state === 'cancelled' && b4.receipts.length === 0);
sNow = (await schedules()).find((s) => s.id === SID);
const B5 = sNow.current;
ok('the schedule opened its next batch at once', B5 && B5.id !== B4.id && new Date(B5.cutoffAt) > new Date());
ok('reopened, it does not get its cutoff back', (await call(U.admin, 'PATCH', `/batches/${B4.id}`, { closed: false })).s === 200 && (await call(U.admin, 'PUT', `/batches/${B4.id}/cutoff`, { cutoffAt: new Date(Date.now() + DAY).toISOString() })).s === 409);
ok('an empty, cancelled batch can be deleted', (await call(U.admin, 'DELETE', `/batches/${B4.id}`)).s === 200);

console.log('\nPausing, switching on, changing');
ok('pause', (await call(U.admin, 'PATCH', `/batch-schedules/${SID}`, { isOn: false })).s === 200);
let b5 = await batch(B5.id);
ok('its open batch loses its cutoff and becomes ordinary', b5.cutoff === null && !b5.closed);
ok('it cannot be given one while the schedule is paused', (await call(U.admin, 'PUT', `/batches/${B5.id}/cutoff`, { cutoffAt: new Date(Date.now() + DAY).toISOString() })).d?.error?.code === 'SCHEDULE_PAUSED');
ok('switch on', (await call(U.admin, 'PATCH', `/batch-schedules/${SID}`, { isOn: true })).s === 200);
b5 = await batch(B5.id);
ok('the same batch gets the next Friday back', b5.cutoff?.state === 'pending' && isFridayFivePm(b5.cutoffAt) && new Date(b5.cutoffAt) > new Date());
// Pretend the last run was two days ago, then move the time to early today: this run's cutoff is then in the past.
const wd = manilaWeekday();
sql(`UPDATE batchschedule SET lastSlotAt = UTC_TIMESTAMP(3) - INTERVAL 2 DAY WHERE id = ${SID}`);
const early = { ...base, days: [wd], time: '00:01' };
const past = await call(U.admin, 'PATCH', `/batch-schedules/${SID}`, early);
ok('a change that puts this run in the past asks first, and saves nothing', past.d?.error?.code === 'CUTOFF_PAST' && (await schedules()).find((s) => s.id === SID).time === '17:00', JSON.stringify(past.d));
const skip = await call(U.admin, 'PATCH', `/batch-schedules/${SID}`, { ...early, whenPast: 'skip' });
b5 = await batch(B5.id);
ok('skip: the batch waits for the next slot (a week from today, 00:01)', skip.s === 200 && new Date(b5.cutoffAt) > new Date() && new Date(b5.cutoffAt) - Date.now() <= 7 * DAY && manilaWeekday(new Date(b5.cutoffAt)) === wd, b5.cutoffAt);
sql(`UPDATE batchschedule SET lastSlotAt = UTC_TIMESTAMP(3) - INTERVAL 2 DAY WHERE id = ${SID}`);
const A5 = await make('ana', 'Cut A5', 55, L1, 'approved');
const run = await call(U.admin, 'PATCH', `/batch-schedules/${SID}`, { ...early, rule: { statuses: 'approved', date: 'receipt', chargeLocationIds: [L1] }, whenPast: 'run' });
ok('run: it runs at once with the new rule (dated today or before)', run.s === 200 && run.d.ran?.kind === 'ran' && (await receipt(A5.id)).batch?.id === B5.id, JSON.stringify(run.d));
sNow = (await schedules()).find((s) => s.id === SID);
ok('and the next batch has the new time', sNow.current && sNow.current.id !== B5.id && manilaWeekday(new Date(sNow.current.cutoffAt)) === wd && new Date(sNow.current.cutoffAt) > new Date());
ok('the change is in the history', Number(sql(`SELECT COUNT(*) FROM auditlog WHERE action = 'batchschedule.updated' AND entityId = '${SID}'`)) >= 2);

console.log('\nWhat each person may choose');
const future = new Date(Date.now() + 3 * DAY).toISOString();
ok('nor count them with the preview', (await call(U.rica, 'POST', '/batches/cutoff-preview', { rule: { statuses: 'in_progress' } })).d?.error?.code === 'RULE_NOT_ALLOWED' && (await call(U.rica, 'POST', '/batches/cutoff-preview', { rule: { statuses: 'approved' } })).s === 200);
ok('Accounting cannot take receipts still in progress', (await call(U.rica, 'POST', '/batches', { name: 'x', cutoffAt: future, cutoffRule: { statuses: 'in_progress' } })).d?.error?.code === 'RULE_NOT_ALLOWED');
const byRica = await call(U.rica, 'POST', '/batches', { name: `Rica cutoff ${tag}`, cutoffAt: future, cutoffRule: approved(L4) });
ok('but can give her own batch a cutoff for approved receipts', byRica.s === 201 && (await batch(byRica.d.batch.id)).cutoff?.state === 'pending');
ok('a cutoff in the past is refused when making a batch', (await call(U.rica, 'POST', '/batches', { cutoffAt: new Date(Date.now() - 60_000).toISOString() })).d?.error?.code === 'CUTOFF_PAST');
ok('moving it into the past asks first', (await call(U.rica, 'PUT', `/batches/${byRica.d.batch.id}/cutoff`, { cutoffAt: new Date(Date.now() - 60_000).toISOString() })).d?.error?.code === 'CUTOFF_PAST');
ok('it can be removed', (await call(U.rica, 'PUT', `/batches/${byRica.d.batch.id}/cutoff`, { cutoffAt: null })).s === 200 && (await batch(byRica.d.batch.id)).cutoff === null);
ok('a schedule batch cannot lose its cutoff', (await call(U.admin, 'PUT', `/batches/${sNow.current.id}/cutoff`, { cutoffAt: null })).d?.error?.code === 'SCHEDULE_BATCH');
ok('a Checker cannot set a cutoff', (await call(U.liza, 'PUT', `/batches/${byRica.d.batch.id}/cutoff`, { cutoffAt: future })).s === 403);
await call(U.admin, 'DELETE', `/batches/${byRica.d.batch.id}`);

console.log('\nAnything in progress: submitted, checked and approved, never returned, reserved or drafts');
const P = [await make('ana', 'Cut P sub', 10, L3, 'submitted'), await make('ana', 'Cut P chk', 11, L3, 'checked'), await make('mark', 'Cut P app', 12, L3, 'approved')];
const Q = [await make('ana', 'Cut Q ret', 13, L3, 'returned'), await make('mark', 'Cut Q res', 14, L3, 'reserved'), await make('ana', 'Cut Q dra', 15, L3, 'draft')];
const IP = (await call(U.admin, 'POST', '/batches', { name: `In progress ${tag}`, cutoffAt: future, cutoffRule: { statuses: 'in_progress', chargeLocationIds: [L3] } })).d.batch;
const ipRun = await call(U.admin, 'POST', `/batches/${IP.id}/cutoff/run`, {});
const ip = await batch(IP.id);
ok('takes the three in progress', ipRun.s === 200 && JSON.stringify(ids(ip)) === JSON.stringify(P.map((r) => r.id).sort((x, y) => x - y)), JSON.stringify(ids(ip)));
ok('leaves the others where they were', (await Promise.all(Q.slice(0, 2).map((r) => receipt(r.id)))).every((r) => !r.batch));

console.log('\nMore than one batch holds');
const ana = sql(`SELECT id FROM user WHERE email = 'ana.reyes@example.com'`);
const values = Array.from({ length: 305 }, (_, i) => `('CUT-${tag.slice(-6)}-${String(i).padStart(3, '0')}', ${ana}, 'Bulk ${tag}', CURDATE(), 1.00, 'approved', UTC_TIMESTAMP(3) - INTERVAL 1 HOUR, UTC_TIMESTAMP(3) - INTERVAL 1 HOUR, UTC_TIMESTAMP(3) - INTERVAL 1 HOUR, ${L4}, UTC_TIMESTAMP(3))`).join(',\n');
sql(`INSERT INTO receipt (refNo, encoderId, payee, receiptDate, amount, status, submittedAt, checkedAt, decidedAt, chargeLocationId, updatedAt) VALUES\n${values};`);
const BIG = (await call(U.admin, 'POST', '/batches', { name: `Big run ${tag}`, cutoffAt: future, cutoffRule: approved(L4) })).d.batch;
const bigRun = await call(U.admin, 'POST', `/batches/${BIG.id}/cutoff/run`, {});
ok('300 go into the batch and 5 into part 2', bigRun.d?.ran?.added === 300 && bigRun.d.ran.parts.length === 1 && bigRun.d.ran.parts[0].count === 5, JSON.stringify(bigRun.d));
const part2 = await batch(bigRun.d.ran.parts[0].id);
ok('part 2 is closed, named so, and points back', part2.closed && /\(part 2\)$/.test(part2.name) && part2.partOf?.id === BIG.id && part2.cutoff?.state === 'ran');
ok('the first batch lists its part', (await batch(BIG.id)).parts.some((p) => p.id === part2.id));
ok('none were dropped', Number(sql(`SELECT COUNT(*) FROM receipt WHERE refNo LIKE 'CUT-${tag.slice(-6)}-%' AND batchId IS NULL`)) === 0);
const A9 = await make('mark', 'Cut A9', 9, L4, 'approved');
const full = await call(U.admin, 'POST', `/batches/${BIG.id}/receipts`, { receiptIds: [A9.id], lateReason: 'missed it' });
ok('a full batch refuses a late one, pointing to the next run', full.s === 200 && full.d.added === 0 && /full.*next run/.test(full.d.results[0].message), JSON.stringify(full.d));

console.log('\nAdding late');
const A7 = await make('ana', 'Cut A7', 70, L2, 'approved');
const noReason = await call(U.admin, 'POST', `/batches/${B1.id}/receipts`, { receiptIds: [A7.id] });
ok('a closed batch needs a reason', noReason.d?.error?.code === 'BATCH_CLOSED');
const ricaLate = await lastNote(U.rica);
const lateAdd = await call(U.admin, 'POST', `/batches/${B1.id}/receipts`, { receiptIds: [A7.id], lateReason: '  approved 20 minutes after the cutoff  ' });
ok('with a reason it is added late', lateAdd.s === 200 && lateAdd.d.added === 1 && lateAdd.d.late === true, JSON.stringify(lateAdd.d));
b1 = await batch(B1.id);
const a7 = b1.receipts.find((r) => r.id === A7.id);
ok('the batch stays closed and the receipt is marked late with the reason', b1.closed && a7?.batchLateAt && a7.batchLateNote === 'approved 20 minutes after the cutoff' && b1.lateCount === 1);
ok('Accounting is told once', (await since(U.rica, ricaLate)).filter((n) => n.type === 'batch.added_late' && n.batchId === B1.id).length === 1);
ok('it can be paid from the batch', (await batch(B1.id, U.rica)).payable.some((p) => p.id === A7.id));
const csv = await (await fetch(`${B}/receipts/export?format=csv&batchId=${B1.id}`, { headers: H(U.admin, false) })).text();
ok('the export has the "Added late" column with the reason', csv.includes('Added late') && csv.includes('Yes: approved 20 minutes after the cutoff'));
ok('the history has it', sql(`SELECT summary FROM auditlog WHERE action = 'batch.receipt_added_late' AND entityId = '${A7.id}'`).includes('approved 20 minutes after the cutoff'));

const open = sNow.current;
const A8 = await make('mark', 'Cut A8', 80, L2, 'approved');
await call(U.admin, 'POST', `/batches/${open.id}/receipts`, { receiptIds: [A8.id] });
const notMoved = await call(U.admin, 'POST', `/batches/${B1.id}/receipts`, { receiptIds: [A8.id], lateReason: 'late' });
ok('one in another open batch is not taken without "move"', notMoved.d.added === 0 && /Remove it from there first/.test(notMoved.d.results[0].message));
const moved = await call(U.admin, 'POST', `/batches/${B1.id}/receipts`, { receiptIds: [A8.id], lateReason: 'belongs to last week', move: true });
ok('with "move" it is moved over from the open batch', moved.d.added === 1 && (await receipt(A8.id)).batch?.id === B1.id, JSON.stringify(moved.d));
ok('the move is recorded on both batches', Number(sql(`SELECT COUNT(*) FROM auditlog WHERE action = 'batch.receipt_moved' AND ((entityType = 'receipt' AND entityId = '${A8.id}') OR (entityType = 'batch' AND entityId = '${open.id}'))`)) === 2);
const fromClosed = await call(U.admin, 'POST', `/batches/${B1.id}/receipts`, { receiptIds: [A3.id], lateReason: 'x', move: true });
ok('one in a batch that was already cut off is refused', fromClosed.d.added === 0 && /closed or already cut off/.test(fromClosed.d.results[0].message));
ok('removing it clears the mark', (await call(U.admin, 'DELETE', `/batches/${B1.id}/receipts/${A7.id}`)).s === 200 && (await receipt(A7.id)).batchLateAt === null);
const S2 = await make('ana', 'Cut S2', 20, L2, 'submitted');
await call(U.admin, 'POST', `/batches/${B1.id}/receipts`, { receiptIds: [S2.id], lateReason: 'needed in this run' });
const wd2 = await step(U.ana, await receipt(S2.id, U.ana), 'withdraw');
ok('a late receipt that is withdrawn leaves the batch and loses the mark', !wd2.batch && (await receipt(S2.id, U.ana)).batchLateAt === null);

// Two late moves of the same receipt at the same moment: it ends up in exactly one batch.
const A10 = await make('ana', 'Cut A10', 10, L2, 'approved');
const holder = (await call(U.admin, 'POST', '/batches', { name: `Holder ${tag}`, receiptIds: [A10.id] })).d.batch;
const race = await Promise.all([B1.id, H1.id].map((id) => call(U.admin, 'POST', `/batches/${id}/receipts`, { receiptIds: [A10.id], lateReason: 'race', move: true })));
const landed = (await receipt(A10.id)).batch?.id;
ok('two moves at once: it lands in one batch only', race.reduce((n, r) => n + (r.d?.added ?? 0), 0) === 1 && [B1.id, H1.id].includes(landed), JSON.stringify(race.map((r) => r.d)));
void holder;

console.log('\nA batch with everything paid is final');
const payable = (await batch(B2.id, U.rica)).payable;
const f = new FormData();
f.append('method', 'Bank transfer'); f.append('paidOn', today());
f.append('lines', JSON.stringify(payable.map((l) => ({ receiptId: l.id, version: l.version, amount: l.amount, shortReason: null }))));
f.append('proof', new Blob([Buffer.concat([PNG, Buffer.from('cutoff proof' + Math.random())])], { type: 'image/png' }), 'proof.png');
const paid = await fetch(`${B}/batches/${B2.id}/pay`, { method: 'POST', headers: H(U.rica, false), body: f });
ok('Accounting pays the whole batch', paid.status === 201);
const A11 = await make('mark', 'Cut A11', 11, L2, 'approved');
ok('then a late addition is refused as final', (await call(U.admin, 'POST', `/batches/${B2.id}/receipts`, { receiptIds: [A11.id], lateReason: 'too late' })).d?.error?.code === 'BATCH_FINAL');
ok('and the batch page says it cannot take late ones', (await batch(B2.id)).canAddLate === false && (await batch(B1.id)).canAddLate === true);

console.log('\nWho may add late');
ok('a Med Ref cannot', (await call(U.ana, 'POST', `/batches/${B1.id}/receipts`, { receiptIds: [A11.id], lateReason: 'x' })).s === 403);
ok('a Checker cannot', (await call(U.liza, 'POST', `/batches/${B1.id}/receipts`, { receiptIds: [A11.id], lateReason: 'x' })).s === 403);

console.log('\nDeleting a schedule');
const last = (await schedules()).find((s) => s.id === SID).current;
await call(U.admin, 'POST', `/batches/${last.id}/receipts`, { receiptIds: [A11.id] });
const del = await call(U.admin, 'DELETE', `/batch-schedules/${SID}`);
ok('its open batch with receipts stays, without a cutoff', del.s === 200 && del.d.kept === last.code && (await batch(last.id)).cutoff === null && !(await batch(last.id)).closed);
ok('its past batches keep their history', (await batch(B1.id)).cutoff.state === 'ran');
const tmp = (await call(U.admin, 'POST', '/batch-schedules', { ...base, name: `Temp ${tag}` })).d;
ok('an empty open batch goes with its schedule', (await call(U.admin, 'DELETE', `/batch-schedules/${tmp.schedule.id}`)).s === 200 && (await call(U.admin, 'GET', `/batches/${tmp.batch.id}`)).s === 404);
ok('deleting is in the history', Number(sql(`SELECT COUNT(*) FROM auditlog WHERE action = 'batchschedule.deleted' AND entityId IN ('${SID}', '${tmp.schedule.id}')`)) === 2);

// Tidy up: the bulk rows and the test places.
sql(`UPDATE receipt SET batchId = NULL WHERE refNo LIKE 'CUT-${tag.slice(-6)}-%'; DELETE FROM receipt WHERE refNo LIKE 'CUT-${tag.slice(-6)}-%'; DELETE FROM batch WHERE id IN (${BIG.id}, ${part2.id}) AND id NOT IN (SELECT batchId FROM (SELECT batchId FROM receipt WHERE batchId IS NOT NULL) x);`);
for (const id of [L1, L2, L3, L4, L5]) await call(U.admin, 'PATCH', `/charge-locations/${id}`, { isActive: false });
done();
