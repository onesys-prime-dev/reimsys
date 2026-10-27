// The reimbursement form's answers for a receipt with no BIR invoice: the shortest valid receipt.
const F = { birInvoice: false, vendorAddress: 'Test Street, Test City', reasonForSpending: 'Test receipt', classification: 'fuel', chargeLocationId: 1, detailsReviewed: true };
// Walks the whole workflow so that every kind of email is sent, with all of it redirected to ONE address (test mode).
// Uses the mail account already saved in the app. Usage: node e2e/send-all-emails.mjs you@example.com
const TO = process.argv[2];
if (!TO) { console.error('Usage: node e2e/send-all-emails.mjs <address that should receive everything>'); process.exit(1); }
const B = process.env.API ?? 'http://localhost:4000/api';
const ORIGIN = new URL(B).origin;
const PW = 'Reimsys#2026';
const tag = 'Email test ' + Date.now().toString().slice(-6);

const H = (c, json = true) => ({ cookie: c, 'x-requested-with': 'reimsys', origin: ORIGIN, ...(json ? { 'content-type': 'application/json' } : {}) });
const login = async (e) => {
  const r = await fetch(B + '/auth/login', { method: 'POST', headers: H('', true), body: JSON.stringify({ email: e, password: PW }) });
  if (!r.ok) throw new Error('login failed for ' + e);
  return r.headers.get('set-cookie').split(';')[0];
};
const call = async (c, m, p, b) => { const r = await fetch(B + p, { method: m, headers: H(c), body: b === undefined ? undefined : JSON.stringify(b) }); return { s: r.status, d: await r.json().catch(() => null) }; };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(m);

const admin = await login('admin@example.com');
const ana = await login('ana.reyes@example.com');
const liza = await login('liza.santos@example.com');
const paolo = await login('paolo.v@example.com');

/* 1. Test mode on, keeping the saved account and password exactly as they are */
const before = (await call(admin, 'GET', '/settings/mail')).d.mail;
if (before.source !== 'database' || !before.hasPassword) { console.error('No mail account is saved in the app yet. Save one under Access, Email first.'); process.exit(1); }
const keep = { host: before.host, port: before.port, secure: before.secure, user: before.user, fromName: before.fromName, fromAddress: before.fromAddress };
const set = (testRedirect) => call(admin, 'PUT', '/settings/mail', { ...keep, testRedirect });
const on = await set(TO);
if (on.s !== 200) { console.error('Could not turn on test mode', on); process.exit(1); }
log(`Test mode ON. Everything goes to ${TO}. Sending as ${keep.fromAddress} through ${keep.host}.\n`);

const startId = (await call(admin, 'GET', '/email-log')).d.items[0]?.id ?? 0;
const me = (await call(ana, 'GET', '/me')).d.user;
const wasRelease = me.prefs.reservationReleased;
await call(ana, 'PATCH', '/me/preferences', { reservationReleased: true });

/* 2. A receipt that goes through every decision */
const cat = (await call(ana, 'GET', '/categories')).d.categories[0].id;
const make = async (name, amount) => {
  let r = (await call(ana, 'POST', '/receipts', { payee: `${name} ${tag}`, receiptDate: new Date().toISOString().slice(0, 10), amount, ...F, description: 'Created by the email test' })).d.receipt;
  const f = new FormData(); f.append('files', new Blob([Buffer.concat([PNG, Buffer.from(name + tag)])], { type: 'image/png' }), 'receipt.png');
  r = (await (await fetch(`${B}/receipts/${r.id}/evidence`, { method: 'POST', headers: H(ana, false), body: f })).json()).receipt;
  return r;
};
const view = (c, r) => fetch(`${B}/receipts/${r.id}/evidence/${r.evidence[0].id}/file?mode=view`, { headers: H(c, false) });
const step = async (c, r, action, note) => (await call(c, 'POST', `/receipts/${r.id}/${action}`, { version: r.version, ...(note ? { note } : {}) })).d.receipt;

let a = await make('Approved path', 1284.5);
a = await step(ana, a, 'submit');
await view(liza, a);
a = await step(liza, a, 'return', 'Please retake the photo, the amount is hard to read.');   // email: returned
a = await step(ana, a, 'submit');
await view(liza, a);
a = await step(liza, a, 'check', 'Matches the receipt now.');
a = await step(paolo, a, 'reserve', 'Waiting for the regional office to confirm the rate.');  // email: on hold (to Ana and Liza)
a = await step(paolo, a, 'release', 'Confirmed.');                                             // email: hold released
a = await step(paolo, a, 'approve', 'Approved.');                                              // email: approved (to Ana and Liza)
log(`Receipt ${a.refNo}: returned, on hold, released, approved`);

let d = await make('Disapproved path', 300);
d = await step(ana, d, 'submit');
await view(liza, d);
d = await step(liza, d, 'check');
d = await step(paolo, d, 'disapprove', 'Not reimbursable under the current policy.');          // email: disapproved (to Ana and Liza)
log(`Receipt ${d.refNo}: disapproved`);

/* 3. Leave something waiting for each person so the daily summary has content */
let w1 = await make('Waiting for the checker', 150); w1 = await step(ana, w1, 'submit');                                  // Liza has one to check
let w2 = await make('Waiting for the approver', 220); w2 = await step(ana, w2, 'submit'); await view(liza, w2); w2 = await step(liza, w2, 'check'); // Paolo has one to decide
const w3 = await make('Draft not submitted', 90);                                                                          // Ana has a draft
const users = (await call(admin, 'GET', '/users')).d.users;
for (const e of ['ana.reyes@example.com', 'liza.santos@example.com', 'paolo.v@example.com']) {
  const u = users.find((x) => x.email === e);
  const r = await call(admin, 'POST', '/email-log/digest-now', { userId: u.id });
  log(`Daily summary for ${u.name}: ${r.d?.sent ? 'queued' : 'nothing waiting'}`);
}

/* 4. The plain test email */
await call(admin, 'POST', '/email-log/test', { to: TO });

/* 5. Wait until every message from this run has been sent or has failed */
log('\nSending…');
let rows = [];
for (let i = 0; i < 90; i++) {
  await sleep(1000);
  const all = [];
  for (let page = 1; page <= 3; page++) all.push(...(await call(admin, 'GET', `/email-log?page=${page}`)).d.items);
  rows = all.filter((e) => e.id > startId).sort((x, y) => x.id - y.id);
  if (rows.length && rows.every((e) => e.status === 'sent' || e.status === 'failed' || e.status === 'logged')) break;
}
console.log('\n  #   template      meant for                       status');
for (const e of rows) console.log(`${String(e.id).padStart(4)}  ${e.template.padEnd(12)}  ${e.to.padEnd(30)}  ${e.status}${e.error ? '  ' + e.error : ''}`);
const sent = rows.filter((e) => e.status === 'sent').length;
console.log(`\n${sent} of ${rows.length} sent to ${TO}`);

/* 6. Put everything back */
await call(ana, 'PATCH', '/me/preferences', { reservationReleased: wasRelease });
const off = await set(before.testRedirect || '');
log(`Test mode ${before.testRedirect ? 'restored to ' + before.testRedirect : 'OFF'} (${off.s === 200 ? 'ok' : 'FAILED to restore'}).`);
log(`Leftover receipts for the summaries: ${w1.refNo}, ${w2.refNo}, ${w3.refNo} (tag "${tag}")`);
process.exit(sent === rows.length && rows.length >= 11 ? 0 : 1);
