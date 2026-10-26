// Helpers for the payment scripts. Needs the API on port 4000 and the seeded demo users (password Reimsys#2026).
export const B = process.env.API ?? 'http://localhost:4000/api';
export const ORIGIN = new URL(B).origin;
const PW = 'Reimsys#2026';
export const tag = 'Pay test ' + Date.now().toString().slice(-6);
/** The reimbursement form's answers for a receipt with no BIR invoice: the shortest valid receipt. */
export const F = { birInvoice: false, vendorAddress: 'Test Street, Test City', reasonForSpending: 'Payment test', classification: 'fuel', chargeLocationId: 1, newReimbursementCode: true, detailsReviewed: true };
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
/** Today's date where the tester is, not in UTC. */
export const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10); };

export const H = (c, json = true) => ({ cookie: c, 'x-requested-with': 'reimsys', origin: ORIGIN, ...(json ? { 'content-type': 'application/json' } : {}) });
export async function login(email) {
  const r = await fetch(B + '/auth/login', { method: 'POST', headers: H('', true), body: JSON.stringify({ email, password: PW }) });
  if (!r.ok) throw new Error('login failed for ' + email);
  return r.headers.get('set-cookie').split(';')[0];
}
export async function call(c, m, p, b) {
  const r = await fetch(B + p, { method: m, headers: H(c), body: b === undefined ? undefined : JSON.stringify(b) });
  return { s: r.status, d: await r.json().catch(() => null) };
}

export const USERS = { ana: 'ana.reyes@example.com', mark: 'mark.dc@example.com', liza: 'liza.santos@example.com', paolo: 'paolo.v@example.com', admin: 'admin@example.com', rica: 'accounting@example.com' };
export async function loginAll() {
  const U = {};
  for (const [k, e] of Object.entries(USERS)) U[k] = await login(e);
  return U;
}

async function step(c, r, action, note) {
  const res = await call(c, 'POST', `/receipts/${r.id}/${action}`, { version: r.version, ...(note ? { note } : {}) });
  if (res.s !== 200) throw new Error(`${action} on ${r.refNo} failed: ${res.s} ${JSON.stringify(res.d)}`);
  return res.d.receipt;
}
const view = (c, r) => fetch(`${B}/receipts/${r.id}/evidence/${r.evidence[0].id}/file?mode=view`, { headers: H(c, false) });

export async function makeDraft(U, owner, name, amount) {
  const c = U[owner];
  const r = (await call(c, 'POST', '/receipts', { payee: `${name} ${tag}`, receiptDate: today(), amount, ...F, description: 'Created by the payment test' })).d.receipt;
  const f = new FormData();
  f.append('files', new Blob([Buffer.concat([PNG, Buffer.from(name + tag + Math.random())])], { type: 'image/png' }), 'receipt.png');
  return (await (await fetch(`${B}/receipts/${r.id}/evidence`, { method: 'POST', headers: H(c, false), body: f })).json()).receipt;
}

/** A receipt that went the whole way: encoded by `owner`, checked by Liza, approved by Paolo. */
export async function makeApproved(U, owner, name, amount) {
  let r = await makeDraft(U, owner, name, amount);
  r = await step(U[owner], r, 'submit');
  await view(U.liza, r);
  r = await step(U.liza, r, 'check');
  await view(U.paolo, r);
  return step(U.paolo, r, 'approve');
}

/** Records a payment for `receipts` (receipt objects from the API). Options: amounts and reasons keyed by receipt id, method, paidOn, proof (Buffer), proofType, proofName, noProof. */
export async function pay(c, receipts, o = {}) {
  const f = new FormData();
  f.append('method', o.method ?? 'Bank transfer');
  f.append('paidOn', o.paidOn ?? today());
  f.append('lines', JSON.stringify(receipts.map((r) => ({ receiptId: r.id, version: r.version, amount: o.amounts?.[r.id] ?? r.amount, shortReason: o.reasons?.[r.id] ?? null }))));
  if (!o.noProof) f.append('proof', new Blob([o.proof ?? Buffer.concat([PNG, Buffer.from('proof' + Math.random())])], { type: o.proofType ?? 'image/png' }), o.proofName ?? 'proof.png');
  const res = await fetch(`${B}/payments`, { method: 'POST', headers: H(c, false), body: f });
  return { s: res.status, d: await res.json().catch(() => null) };
}

export function checker() {
  let failed = 0;
  const ok = (name, cond) => { console.log(cond ? '  ok  ' : '  FAIL', name); if (!cond) failed++; };
  const done = () => { console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed'); process.exit(failed ? 1 : 0); };
  return { ok, done };
}
