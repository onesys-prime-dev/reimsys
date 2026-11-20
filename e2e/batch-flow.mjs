// Checks batches through the API, as each role: making them, adding and removing receipts, checking, approving and paying a
// whole batch, the summaries people get, and the batch filter on lists, exports and reports.
// Needs the API (4000) running and the seed applied. Usage: node e2e/batch-flow.mjs
import { B, H, PNG, call, checker, login, loginAll, makeApproved, makeDraft, tag, today } from './payment-helpers.mjs';

const { ok, done } = checker();
const U = await loginAll();
U.manager = await login('manager@example.com');
console.log(`Run tag: ${tag}`);

const view = (c, r) => fetch(`${B}/receipts/${r.id}/evidence/${r.evidence[0].id}/file?mode=view`, { headers: H(c, false) });
const get = async (c, r) => (await call(c, 'GET', `/receipts/${r.id}`)).d?.receipt;
async function submitted(owner, name, amount) {
  const r = await makeDraft(U, owner, name, amount);
  const s = await call(U[owner], 'POST', `/receipts/${r.id}/submit`, { version: r.version });
  if (s.s !== 200) throw new Error('submit failed ' + JSON.stringify(s.d));
  return s.d.receipt;
}
const notes = async (c) => (await call(c, 'GET', '/notifications')).d.items;
// The bell lists the newest 30, so new notices are found by id, not by counting.
const lastNote = async (c) => Math.max(0, ...(await notes(c)).map((n) => n.id));
const since = async (c, id) => (await notes(c)).filter((n) => n.id > id);
async function payBatch(c, id, lines, o = {}) {
  const f = new FormData();
  f.append('method', o.method ?? 'Bank transfer');
  f.append('paidOn', o.paidOn ?? today());
  f.append('lines', JSON.stringify(lines.map((l) => ({ receiptId: l.id, version: l.version, amount: l.amount, shortReason: l.shortReason ?? null }))));
  if (!o.noProof) f.append('proof', new Blob([Buffer.concat([PNG, Buffer.from('batch proof' + Math.random())])], { type: 'image/png' }), 'proof.png');
  const res = await fetch(`${B}/batches/${id}/pay`, { method: 'POST', headers: H(c, false), body: f });
  return { s: res.status, d: await res.json().catch(() => null) };
}

console.log('\nWho may see and make batches');
ok('a Med Ref cannot open the batch list', (await call(U.ana, 'GET', '/batches')).s === 403);
const lizaList = await call(U.liza, 'GET', '/batches');
ok('a Checker can open the batch list', lizaList.s === 200 && lizaList.d.canManage === false);
ok('a Checker cannot make a batch', (await call(U.liza, 'POST', '/batches', { name: 'x' })).s === 403);
ok('an Approver cannot make a batch', (await call(U.paolo, 'POST', '/batches', {})).s === 403);
const made = await call(U.admin, 'POST', '/batches', { name: `Week run ${tag}` });
ok('the Super Admin can make a batch', made.s === 201);
ok('the code is generated (B-year-number)', /^B-\d{4}-\d{6}$/.test(made.d?.batch.code ?? ''));
const B1 = made.d.batch;
const byRica = await call(U.rica, 'POST', '/batches', {});
ok('Accounting can make a batch (no name needed)', byRica.s === 201 && byRica.d.batch.name === null);
const byManager = await call(U.manager, 'POST', '/batches', { name: 'Manager test' });
ok('the Admin can make a batch', byManager.s === 201);
ok('a name over 80 characters is refused', (await call(U.admin, 'POST', '/batches', { name: 'x'.repeat(81) })).s === 400);
ok(`more than 300 receipts at once is refused`, (await call(U.admin, 'POST', `/batches/${B1.id}/receipts`, { receiptIds: Array.from({ length: 301 }, (_, i) => i + 1) })).s === 400);

console.log('\nAdding receipts');
const s1 = await submitted('ana', 'Batch one', 400);
const s2 = await submitted('mark', 'Batch two', 600);
const s3 = await submitted('ana', 'Batch three', 150);
const d1 = await makeDraft(U, 'ana', 'Batch draft', 80);
const add = await call(U.admin, 'POST', `/batches/${B1.id}/receipts`, { receiptIds: [s1.id, s2.id, s3.id, d1.id, s1.id] });
ok('three submitted receipts are added', add.s === 200 && add.d.added === 3);
ok('a draft is skipped (it is private until submitted)', add.d.results.some((x) => x.id === d1.id && !x.ok));
ok('a receipt listed twice is added once', add.d.results.filter((x) => x.id === s1.id).length === 1);
const again = await call(U.admin, 'POST', `/batches/${B1.id}/receipts`, { receiptIds: [s1.id] });
ok('adding one already in the batch is fine and changes nothing', again.d.added === 0 && again.d.results[0].ok);
const B2 = (await call(U.admin, 'POST', '/batches', { name: 'Second' })).d.batch;
const steal = await call(U.admin, 'POST', `/batches/${B2.id}/receipts`, { receiptIds: [s1.id] });
ok('a receipt cannot be in two batches', steal.d.added === 0 && /Already in batch/.test(steal.d.results[0].message));
ok('a Checker cannot add receipts', (await call(U.liza, 'POST', `/batches/${B1.id}/receipts`, { receiptIds: [s1.id] })).s === 403);
ok('adding does not change the receipt version (no "someone changed it" for reviewers)', (await get(U.liza, s1)).version === s1.version);

console.log('\nFinding a batch');
const look = await call(U.liza, 'GET', `/batches/lookup?code=${B1.code.toLowerCase()}`);
ok('typing the code (any case) finds the batch', look.s === 200 && look.d.id === B1.id);
ok('an unknown code says so', (await call(U.liza, 'GET', '/batches/lookup?code=B-1999-000001')).s === 404);
const inList = (await call(U.liza, 'GET', '/batches')).d.batches.find((b) => b.id === B1.id);
ok('the list shows the count and what is waiting for this person', inList?.count === 3 && inList.waiting.check === 3);
ok('the receipt shows its batch', (await get(U.ana, s1))?.batch?.code === B1.code);
const filtered = await call(U.admin, 'GET', `/receipts?batchId=${B1.id}`);
ok('the receipts list filters by batch', filtered.d.total === 3 && filtered.d.items.every((r) => r.batch?.id === B1.id));
ok('searching the code finds its receipts', (await call(U.admin, 'GET', `/receipts?q=${encodeURIComponent(B1.code)}`)).d.total === 3);
const hist = (await call(U.ana, 'GET', `/receipts/${s1.id}/history`)).d.items;
ok('the receipt history records the batch', hist.some((h) => h.action === 'batch.receipt_added' && h.summary.includes(B1.code)));

console.log('\nChecking the batch');
ok('a Med Ref cannot check a batch', (await call(U.ana, 'POST', `/batches/${B1.id}/process`, { action: 'check' })).s === 403);
ok('Accounting cannot check a batch', (await call(U.rica, 'POST', `/batches/${B1.id}/process`, { action: 'check' })).s === 403);
const noView = await call(U.liza, 'POST', `/batches/${B1.id}/process`, { action: 'check' });
ok('without opening the evidence nothing is checked, and the reason is given', noView.s === 200 && noView.d.done === 0 && noView.d.results.every((x) => /Open the evidence/.test(x.message)));
const anaBefore = await lastNote(U.ana);
const paoloBefore = await lastNote(U.paolo);
await view(U.liza, s1);
await view(U.liza, s2);
const chk = await call(U.liza, 'POST', `/batches/${B1.id}/process`, { action: 'check', note: 'Batch check' });
ok('the two with evidence opened are checked, the third is skipped', chk.d.done === 2 && chk.d.skipped === 1 && chk.d.results.find((x) => x.id === s3.id && !x.ok));
ok('their status is now Checked', (await get(U.liza, s1)).status === 'checked' && (await get(U.liza, s2)).status === 'checked');
const paoloNew = await since(U.paolo, paoloBefore);
ok('the Approver gets one summary, linked to the batch', paoloNew.filter((n) => n.batchId === B1.id).length === 1 && !paoloNew.some((n) => n.receiptId === s1.id || n.receiptId === s2.id));
const anaNew = await since(U.ana, anaBefore);
ok('the Med Ref gets one summary instead of one per receipt', anaNew.length === 1 && anaNew[0].batchId === B1.id && /1 of your receipts/.test(anaNew[0].text));

console.log('\nApproving the batch');
await view(U.paolo, s1);
await view(U.paolo, s2);
const lizaBefore = await lastNote(U.liza);
const ricaBefore = await lastNote(U.rica);
const appr = await call(U.paolo, 'POST', `/batches/${B1.id}/process`, { action: 'approve' });
ok('both checked receipts are approved', appr.d.done === 2);
ok('each approved receipt has its document', !!(await get(U.paolo, s1)).document && !!(await get(U.paolo, s2)).document);
ok('the Checker hears once, about the receipts they checked', (await since(U.liza, lizaBefore)).length === 1);
const ricaNew = await since(U.rica, ricaBefore);
ok('Accounting hears once that the batch is ready to pay', ricaNew.length === 1 && ricaNew[0].batchId === B1.id && /ready to pay/.test(ricaNew[0].text));
const mails = (await call(U.admin, 'GET', '/email-log')).d.items.filter((e) => e.subject.includes(B1.code) || e.subject.includes(s1.refNo) || e.subject.includes(s2.refNo));
ok('the summaries are emailed with the batch template', ['paolo.v@example.com', 'accounting@example.com', 'ana.reyes@example.com', 'mark.dc@example.com', 'liza.santos@example.com'].every((to) => mails.some((e) => e.to === to && e.template === 'batch_update')), JSON.stringify(mails.map((e) => [e.to, e.template])));
ok('no email is sent per receipt for the batch steps', !mails.some((e) => ['checked', 'approved', 'ready_to_pay'].includes(e.template)));
ok('the Med Ref is told "1 of your receipts was approved"', mails.some((e) => e.to === 'ana.reyes@example.com' && /1 of your receipts was approved/.test(e.subject)));
ok('nothing left to approve says so', (await call(U.paolo, 'POST', `/batches/${B1.id}/process`, { action: 'approve' })).s === 409);

console.log('\nPaying the batch (two people, one payment each)');
const queue = (await call(U.rica, 'GET', '/payments/queue')).d;
ok('Ready to pay lists the batch', queue.batches.some((b) => b.id === B1.id && b.count === 2 && b.people === 2));
const det = (await call(U.rica, 'GET', `/batches/${B1.id}`)).d.batch;
ok('Accounting sees only what it may see, and is told some are hidden', det.count === 2 && det.hidden === 1);
ok('both receipts are offered for payment, with the person', det.payable.length === 2 && det.payable.every((p) => p.person));
ok('the Super Admin cannot pay a batch', (await payBatch(U.admin, B1.id, det.payable)).s === 403);
ok('the proof is required', (await payBatch(U.rica, B1.id, det.payable, { noProof: true })).s === 400);
const a4 = await makeApproved(U, 'ana', 'Not in batch', 90);
const stranger = await payBatch(U.rica, B1.id, [...det.payable, { id: a4.id, version: a4.version, amount: a4.amount }]);
ok('a receipt that is not in the batch is refused, and nothing is paid', stranger.s === 409 && (await get(U.rica, s1)).status === 'approved');
const paid = await payBatch(U.rica, B1.id, det.payable);
ok('the batch is paid: one payment per person', paid.s === 201 && paid.d.payments.length === 2 && new Set(paid.d.payments.map((p) => p.paymentNo)).size === 2);
ok('both receipts are Paid', (await get(U.rica, s1)).status === 'paid' && (await get(U.rica, s2)).status === 'paid');
ok('the totals per payment are right', paid.d.payments.map((p) => p.total).sort((a, b) => a - b).join() === '400,600');
for (const p of paid.d.payments) ok(`the proof opens for ${p.paymentNo}`, (await fetch(`${B}/payments/${p.id}/proof`, { headers: H(U.rica, false) })).status === 200);
ok('paying again is refused', (await payBatch(U.rica, B1.id, det.payable)).s === 409);
const anaPaid = (await notes(U.ana))[0];
ok('each person gets the usual payment notice', /paid/.test(anaPaid.text));

console.log('\nRemoving, closing and deleting');
ok('a paid receipt cannot be removed', (await call(U.admin, 'DELETE', `/batches/${B1.id}/receipts/${s1.id}`)).s === 409);
ok('a Checker cannot remove a receipt', (await call(U.liza, 'DELETE', `/batches/${B1.id}/receipts/${s3.id}`)).s === 403);
ok('a submitted receipt can be removed', (await call(U.admin, 'DELETE', `/batches/${B1.id}/receipts/${s3.id}`)).s === 200 && (await get(U.ana, s3)).batch === null);
ok('removing it twice says it is not there', (await call(U.admin, 'DELETE', `/batches/${B1.id}/receipts/${s3.id}`)).s === 404);
ok('with nothing waiting, checking the batch says so', (await call(U.liza, 'POST', `/batches/${B1.id}/process`, { action: 'check' })).s === 409);
ok('the batch can be closed', (await call(U.admin, 'PATCH', `/batches/${B1.id}`, { closed: true })).d?.batch.closed === true);
ok('a closed batch takes no more receipts', (await call(U.admin, 'POST', `/batches/${B1.id}/receipts`, { receiptIds: [s3.id] })).s === 409);
ok('a closed batch is not in the open list', !(await call(U.admin, 'GET', '/batches')).d.batches.some((b) => b.id === B1.id));
ok('it is in the closed list', (await call(U.admin, 'GET', '/batches?state=closed')).d.batches.some((b) => b.id === B1.id));
ok('it can be reopened and renamed', (await call(U.admin, 'PATCH', `/batches/${B1.id}`, { closed: false, name: 'Renamed' })).d?.batch.name === 'Renamed');
ok('a batch with receipts cannot be deleted', (await call(U.admin, 'DELETE', `/batches/${B1.id}`)).s === 409);
ok('an empty batch can be deleted', (await call(U.admin, 'DELETE', `/batches/${B2.id}`)).s === 200 && (await call(U.admin, 'GET', `/batches/${B2.id}`)).s === 404);
ok('Accounting cleans up its own empty batch', (await call(U.rica, 'DELETE', `/batches/${byRica.d.batch.id}`)).s === 200);
await call(U.manager, 'DELETE', `/batches/${byManager.d.batch.id}`);

console.log('\nLists, exports and reports');
const csv = await (await fetch(`${B}/receipts/export?format=csv&batchId=${B1.id}`, { headers: H(U.admin, false) })).text();
ok('the receipts export has a Batch column with the code', csv.split('\n')[0].includes('Batch') && csv.split('\n').filter((l) => l.includes(B1.code)).length === 2);
const payCsv = await (await fetch(`${B}/payments/export?format=csv&from=${today()}&to=${today()}`, { headers: H(U.rica, false) })).text();
ok('the payments export shows the batch', payCsv.split('\n')[0].includes('Batch') && payCsv.includes(B1.code));
const prev = await call(U.admin, 'GET', `/reports/preview?from=${today()}&to=${today()}&batchId=${B1.id}`);
ok('a report can be limited to one batch', prev.s === 200 && prev.d.count === 2 && prev.d.total === 1000);

done();
