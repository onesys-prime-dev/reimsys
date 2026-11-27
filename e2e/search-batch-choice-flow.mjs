// Checks two things the client asked for, through the API:
// 1. Search with any hint: every word is found anywhere on the receipt (vendor, reason, address, comments, REIM/PAY no., status,
//    classification, amount, date...), only among the receipts the person may see.
// 2. A Med Ref choosing the batch of their own receipt: a draft remembers it and joins when submitted; a submitted one moves at once;
//    only open batches whose cutoff has not run; a batch that closed meanwhile is reported, not forced.
// Needs the API (4000) running with the seed applied. Usage: node e2e/search-batch-choice-flow.mjs
import { B, F, H, PNG, call, checker, loginAll, makeApproved, pay, tag, today } from './payment-helpers.mjs';

const { ok, done } = checker();
const U = await loginAll();
console.log(`Run tag: ${tag}`);
const word = tag.split(' ').pop(); // the run number, on every receipt this run makes
const find = async (c, q) => (await call(c, 'GET', `/receipts?pageSize=100&q=${encodeURIComponent(q)}`)).d.items.map((r) => r.id);
const get = async (c, id) => (await call(c, 'GET', `/receipts/${id}`)).d?.receipt;
const view = (c, r) => fetch(`${B}/receipts/${r.id}/evidence/${r.evidence[0].id}/file?mode=view`, { headers: H(c, false) });
async function draft(owner, payee, amount, extra = {}) {
  const c = U[owner];
  const r = (await call(c, 'POST', '/receipts', { payee: `${payee} ${tag}`, receiptDate: today(), amount, ...F, ...extra })).d.receipt;
  const f = new FormData();
  f.append('files', new Blob([Buffer.concat([PNG, Buffer.from(payee + tag + Math.random())])], { type: 'image/png' }), 'receipt.png');
  return (await (await fetch(`${B}/receipts/${r.id}/evidence`, { method: 'POST', headers: H(c, false), body: f })).json()).receipt;
}
const step = async (c, r, action, note) => {
  const res = await call(c, 'POST', `/receipts/${r.id}/${action}`, { version: r.version, ...(note ? { note } : {}) });
  if (res.s !== 200) throw new Error(`${action} failed ${res.s} ${JSON.stringify(res.d)}`);
  return res.d.receipt;
};

console.log('\nSearching with any word');
let R = await draft('ana', 'Mercury Drug', 1284.5, { reasonForSpending: `Hepatitis vaccine for the clinic ${word}`, vendorAddress: `Calle Tagaytay ${word}` });
R = await step(U.ana, R, 'submit');
await view(U.liza, R); R = await step(U.liza, R, 'check');
await view(U.paolo, R); R = await step(U.paolo, R, 'approve');
await call(U.ana, 'POST', `/receipts/${R.id}/comments`, { body: `Bought for the zebrafish${word} outreach` });
const other = await draft('ana', 'Shell Station', 600);
const pct = await draft('ana', 'Percent Shop', 50, { description: `Promo 50% off, code SALE_${word}` });
const has = async (q, c = U.admin) => (await find(c, q)).includes(R.id);
ok('two words that are not next to each other ("mercury 123456")', await has(`mercury ${word}`));
ok('the words in any order', await has(`${word} drug mercury`));
ok('"quoted words" must stay together', !(await has(`"drug mercury" ${word}`)) && await has(`"mercury drug" ${word}`));
ok('a word from the reason for spending', await has(`hepatitis ${word}`));
ok('a word from the vendor address', await has(`tagaytay ${word}`));
ok('a word from a comment', await has(`zebrafish${word}`));
ok('the amount as written on the receipt (1,284.50)', await has(`${word} 1,284.50`));
ok('the amount without centavos (1284)', await has(`${word} 1284`));
ok('another amount does not match', !(await has(`${word} 999.99`)));
ok('the status word', await has(`approved ${word}`) && !(await has(`paid ${word}`)));
ok('the classification', await has(`fuel ${word}`));
ok('the receipt date', await has(`${today()} ${word}`));
ok('its document number (REIM-...)', await has(R.document?.docNo ?? 'missing'));
ok('the person who encoded it', await has(`ana ${word}`));
ok('a word that is nowhere on it leaves it out', !(await has(`mercury ${word} unicorn`)));
ok('the other receipt of the run (a draft, so searched by its Med Ref) is not caught by "mercury"', !(await find(U.ana, `mercury ${word}`)).includes(other.id) && (await find(U.ana, `shell ${word}`)).includes(other.id));
ok('drafts stay private: the Super Admin does not find hers', !(await find(U.admin, `shell ${word}`)).includes(other.id));
ok('the Med Ref finds her own receipt the same way', await has(`zebrafish${word}`, U.ana));
ok('another Med Ref finds nothing of hers', !(await has(`zebrafish${word}`, U.mark)) && !(await has(`mercury ${word}`, U.mark)));
const csv = await (await fetch(`${B}/receipts/export?format=csv&q=${encodeURIComponent(`hepatitis ${word}`)}`, { headers: H(U.admin, false) })).text();
ok('% and _ are searched as written, not as "anything"', (await find(U.ana, '50%')).includes(pct.id) && (await find(U.ana, `SALE_${word}`)).includes(pct.id) && (await call(U.ana, 'GET', '/receipts?q=%25')).d.total < (await call(U.ana, 'GET', '/receipts')).d.total && !(await find(U.ana, `SALEX${word}`)).includes(pct.id));
ok('the export uses the same search', csv.includes(R.refNo) && !csv.includes(other.refNo));
const paid = await makeApproved(U, 'mark', 'Payment search', 77);
const p = await pay(U.rica, [paid]);
ok('a payment number finds what it paid', p.s === 201 && (await find(U.admin, p.d.payments?.[0]?.paymentNo ?? p.d.payment?.paymentNo ?? 'missing')).includes(paid.id), JSON.stringify(p.d));

console.log('\nWhich batches a Med Ref can choose');
const BX = (await call(U.rica, 'POST', '/batches', { name: `Week run ${tag}` })).d.batch;
const BC = (await call(U.rica, 'POST', '/batches', { name: `Cutoff run ${tag}`, cutoffAt: new Date(Date.now() + 3 * 86_400_000).toISOString() })).d.batch;
const BZ = (await call(U.rica, 'POST', '/batches', { name: `Closed run ${tag}` })).d.batch;
await call(U.rica, 'PATCH', `/batches/${BZ.id}`, { closed: true });
const choices = (await call(U.ana, 'GET', '/receipts/batch-choices')).d.batches;
ok('open batches are offered, with and without a cutoff', choices.some((b) => b.id === BX.id) && choices.some((b) => b.id === BC.id && b.cutoffAt));
ok('a closed batch is not offered', !choices.some((b) => b.id === BZ.id));
ok('only people who encode receipts ask for the list', (await call(U.liza, 'GET', '/receipts/batch-choices')).s === 403);

console.log('\nA draft remembers its batch and joins when submitted');
let D = await draft('ana', 'Batch choice draft', 210);
const chose = await call(U.ana, 'PUT', `/receipts/${D.id}/batch`, { batchId: BX.id });
ok('the Med Ref chooses a batch for her draft', chose.s === 200 && chose.d.receipt.wantBatch?.id === BX.id && !chose.d.receipt.batch);
ok('the batch says a draft is waiting to join, without showing it', (await call(U.rica, 'GET', `/batches/${BX.id}`)).d.batch.waitingDrafts === 1 && (await call(U.rica, 'GET', `/batches/${BX.id}`)).d.batch.count === 0);
ok('a closed batch cannot be chosen', (await call(U.ana, 'PUT', `/receipts/${D.id}/batch`, { batchId: BZ.id })).d?.error?.code === 'BATCH_NOT_OPEN');
ok('someone else cannot choose for her', [403, 404].includes((await call(U.mark, 'PUT', `/receipts/${D.id}/batch`, { batchId: BX.id })).s));
ok('nor can a Checker', (await call(U.liza, 'PUT', `/receipts/${D.id}/batch`, { batchId: BX.id })).s === 403);
D = await step(U.ana, await get(U.ana, D.id), 'submit');
ok('on submitting it joins the batch', D.batch?.id === BX.id && !D.wantBatch);
ok('Accounting sees it in the batch', (await call(U.rica, 'GET', `/batches/${BX.id}`)).d.batch.waitingDrafts === 0);
D = await step(U.ana, D, 'withdraw');
ok('withdrawn, it leaves the batch but keeps the choice', !D.batch && D.wantBatch?.id === BX.id);
D = await step(U.ana, D, 'submit');
ok('sent again, it rejoins', D.batch?.id === BX.id);

console.log('\nA submitted receipt moves at once');
const moved = await call(U.ana, 'PUT', `/receipts/${D.id}/batch`, { batchId: BC.id });
ok('she moves it to the other open batch', moved.s === 200 && moved.d.receipt.batch?.id === BC.id);
ok('both moves are in the history', (await call(U.admin, 'GET', `/receipts/${D.id}/history`)).d.items.some((h) => /taken out of batch .* by its Med Ref/.test(h.summary ?? '')));
const out = await call(U.ana, 'PUT', `/receipts/${D.id}/batch`, { batchId: null });
ok('and can take it out', out.s === 200 && !out.d.receipt.batch);
await call(U.ana, 'PUT', `/receipts/${D.id}/batch`, { batchId: BC.id });
await call(U.rica, 'PATCH', `/batches/${BC.id}`, { closed: true });
const stuck = await call(U.ana, 'PUT', `/receipts/${D.id}/batch`, { batchId: null });
ok('once the batch closes, only Accounting can move it', stuck.d?.error?.code === 'BATCH_NOT_OPEN' && /Ask Accounting/.test(stuck.d.error.message));
const done1 = await call(U.ana, 'PUT', `/receipts/${paid.id}/batch`, { batchId: BX.id });
ok('a paid receipt keeps its batch (here: none)', [403, 404, 409].includes(done1.s));

console.log('\nThe chosen batch closed before the draft was sent');
let D2 = await draft('ana', 'Batch missed draft', 99);
await call(U.ana, 'PUT', `/receipts/${D2.id}/batch`, { batchId: BX.id });
await call(U.rica, 'PATCH', `/batches/${BX.id}`, { closed: true });
const before = Math.max(0, ...(await call(U.ana, 'GET', '/notifications')).d.items.map((n) => n.id));
D2 = await step(U.ana, await get(U.ana, D2.id), 'submit');
ok('it is still submitted, outside the batch', D2.status === 'submitted' && !D2.batch && !D2.wantBatch);
const told = (await call(U.ana, 'GET', '/notifications')).d.items.filter((n) => n.id > before && n.receiptId === D2.id);
ok('and she is told it did not join, and why', told.some((n) => /did not join B-\d{4}-\d{6}/.test(n.text) && /Accounting can still add/.test(n.text)), JSON.stringify(told));

done();
