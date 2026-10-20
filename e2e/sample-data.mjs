// Fills the system with SAMPLE receipts in every status, so the screens can be seen with data. Needs the API (4000) and the demo accounts.
//   node e2e/sample-data.mjs          adds about 60 sample receipts, payments and a report
// Every sample receipt's payee ends in "(sample)". Remove them all afterwards with:
//   pnpm --filter @reimsys/api data:clear -- --confirm reimsys     (this clears ALL receipts, so do it before real use)
import { B, H, F, PNG, call, loginAll, today } from './payment-helpers.mjs';

const U = await loginAll();
const day = (back) => { const d = new Date(); d.setDate(d.getDate() - back); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10); };
const pick = (a, i) => a[i % a.length];
const VENDORS = [['Mercury Drug', 'meal'], ['Watsons Banilad', 'other'], ['Shell Mandaue', 'fuel'], ['Petron Lahug', 'fuel'], ['Jollibee Ayala', 'meal'], ['Cebu Pacific', 'transportation'], ['Grab Philippines', 'transportation'], ['SM Parking', 'parking'], ['National Book Store', 'printing'], ['Max\'s Restaurant', 'representation'], ['Ayala Center Parking', 'parking'], ['Rustan\'s Supermarket', 'meeting'], ['Caltex Talisay', 'fuel'], ['Starbucks IT Park', 'meeting'], ['Lazada Express', 'other']];
const WHY = ['Delivery to branch', 'Client meeting', 'Branch supplies', 'Training day', 'Inventory run', 'Audit visit', 'Regional meeting'];
let n = 0;

async function draft(owner, i) {
  const [name, classification] = pick(VENDORS, i * 7 + owner.length);
  const amount = Math.round((150 + ((i * 937) % 9000)) * 100) / 100;
  const made = await call(U[owner], 'POST', '/receipts', { payee: `${name} (sample)`, receiptDate: day(1 + (i % 28)), amount, ...F, classification, reasonForSpending: pick(WHY, i), ...(classification === 'other' ? { classificationOther: 'Pharmacy supplies' } : {}), description: 'Sample receipt' });
  if (!made.d?.receipt) throw new Error('create failed: ' + made.s + ' ' + JSON.stringify(made.d).slice(0, 300));
  const r = made.d.receipt;
  const f = new FormData();
  f.append('files', new Blob([Buffer.concat([PNG, Buffer.from('sample' + i + owner + Math.random())])], { type: 'image/png' }), `receipt-${i}.png`);
  return (await (await fetch(`${B}/receipts/${r.id}/evidence`, { method: 'POST', headers: H(U[owner], false), body: f })).json()).receipt;
}
const view = (who, r) => fetch(`${B}/receipts/${r.id}/evidence/${r.evidence[0].id}/file?mode=view`, { headers: H(U[who], false) });
const act = async (who, r, action, note) => {
  const x = await call(U[who], 'POST', `/receipts/${r.id}/${action}`, { version: r.version, ...(note ? { note } : {}) });
  if (x.s !== 200) throw new Error(`${action} ${r.refNo}: ${x.s} ${JSON.stringify(x.d)}`);
  return x.d.receipt;
};
const owners = ['ana', 'mark'];

// stage: draft, submitted, returned, checked, approved, disapproved, reserved, paid
const PLAN = [['draft', 6], ['submitted', 9], ['returned', 5], ['checked', 8], ['approved', 12], ['disapproved', 3], ['reserved', 3], ['paid', 14]];
const toPay = [];
let i = 0;
for (const [stage, count] of PLAN) {
  for (let k = 0; k < count; k++, i++) {
    const owner = owners[i % 2];
    let r = await draft(owner, i);
    if (stage !== 'draft') r = await act(owner, r, 'submit');
    if (stage === 'returned') { await view('liza', r); r = await act('liza', r, 'return', 'Photo is cut off. Please retake it.'); }
    if (['checked', 'approved', 'disapproved', 'reserved', 'paid'].includes(stage)) { await view('liza', r); r = await act('liza', r, 'check'); }
    if (['approved', 'paid'].includes(stage)) { await view('paolo', r); r = await act('paolo', r, 'approve'); }
    if (stage === 'disapproved') { await view('paolo', r); r = await act('paolo', r, 'disapprove', 'Not a reimbursable expense.'); }
    if (stage === 'reserved') { await view('paolo', r); r = await act('paolo', r, 'reserve', 'Waiting for the regional office.'); }
    if (stage === 'paid') toPay.push(r);
    n++;
  }
}

// Payments: one per person, in a couple of batches
let payments = 0;
for (const owner of owners) {
  const mine = toPay.filter((r) => r.encoder?.name === (owner === 'ana' ? 'Ana Reyes' : 'Mark Dela Cruz'));
  for (let s = 0; s < mine.length; s += 4) {
    const batch = mine.slice(s, s + 4);
    if (!batch.length) continue;
    const f = new FormData();
    f.append('method', pick(['Bank transfer', 'GCash', 'Cash'], s));
    f.append('paidOn', day(s % 5));
    f.append('lines', JSON.stringify(batch.map((r) => ({ receiptId: r.id, version: r.version, amount: r.amount, shortReason: null }))));
    f.append('proof', new Blob([Buffer.concat([PNG, Buffer.from('proof' + Math.random())])], { type: 'image/png' }), 'proof.png');
    const res = await fetch(`${B}/payments`, { method: 'POST', headers: H(U.rica, false), body: f });
    if (res.ok) payments++; else console.log('payment failed', res.status, JSON.stringify(await res.json().catch(() => null)).slice(0, 160));
  }
}

// A liquidation report
const rep = await call(U.admin, 'POST', '/reports', { from: day(30), to: today(), format: 'pdf' });
console.log(`Added ${n} sample receipts (6 drafts, 9 submitted, 5 returned, 8 checked, 12 approved, 3 disapproved, 3 on hold, up to 14 paid in ${payments} payments) and ${rep.s === 201 || rep.s === 200 ? 'one report' : 'no report (' + rep.s + ')'}.`);
console.log('They all end in "(sample)". Remove everything later with:  pnpm --filter @reimsys/api data:clear -- --confirm reimsys');
