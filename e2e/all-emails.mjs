// Sends every one of the system's emails for real (to a pretend mail server on port 1025) by doing what makes each one go out, then checks each arrived,
// went to the right person, has no leftover {{ }} or "undefined", and has its button. Needs the API (4000). Restores the saved mail settings afterwards.
// Usage: node e2e/all-emails.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { call, loginAll, makeDraft, B, H, pay } from './payment-helpers.mjs';
import { protectSettings } from './protect-settings.mjs';

protectSettings();
const U = await loginAll();
let failed = 0;
const ok = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : x); if (!c) failed++; };
const stamp = Date.now();
const box = fs.mkdtempSync(path.join(os.tmpdir(), 'reimsys-mailbox-'));
const catcher = spawn(process.execPath, ['e2e/smtp-catcher.mjs', box], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));

const inbox = () => fs.readdirSync(box).filter((f) => f.endsWith('.json')).map((f) => { const m = JSON.parse(fs.readFileSync(path.join(box, f), 'utf8')); m.html = fs.readFileSync(path.join(box, f.replace('.json', '.html')), 'utf8'); return m; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const arrives = async (pred, ms = 25000) => { for (let t = 0; t < ms; t += 500) { const m = inbox().find(pred); if (m) return m; await sleep(500); } return null; };
const to = (m) => (m.to ?? '').toLowerCase();
const step = async (c, r, a, body = {}) => { const x = await call(c, 'POST', `/receipts/${r.id}/${a}`, { version: r.version, ...body }); if (x.s !== 200) throw new Error(`${a} ${x.s} ${JSON.stringify(x.d)}`); return x.d.receipt; };
const look = (c, r) => fetch(`${B}/receipts/${r.id}/evidence/${r.evidence[0].id}/file?mode=view`, { headers: H(c, false) });
const get = async (c, r) => (await call(c, 'GET', `/receipts/${r.id}`)).d.receipt;

try {
  const cur = (await call(U.admin, 'GET', '/settings/mail')).d.mail;
  const saved = await call(U.admin, 'PUT', '/settings/mail', { host: '127.0.0.1', port: 1025, secure: false, user: '', fromName: 'REIMSYS', fromAddress: 'no-reply@reimsys.test', testRedirect: '' });
  ok('the mail account points at the pretend mail server', saved.s === 200 && saved.d.mail.host === '127.0.0.1', JSON.stringify(saved.d).slice(0, 160));
  void cur;
  await call(U.ana, 'PATCH', '/me/preferences', { theme: 'light', dailyDigest: true, reservationReleased: true });
  const roles = (await call(U.admin, 'GET', '/roles')).d.roles;
  const medref = roles.find((r) => r.name === 'Med Ref').id;

  console.log('Emails that do not come from a receipt');
  await call(U.admin, 'POST', '/email-log/test', { to: `tester${stamp}@example.com` });
  const test = await arrives((m) => to(m).includes(`tester${stamp}`));
  await call(U.admin, 'POST', '/users', { name: 'New Person ' + stamp, email: `newperson${stamp}@example.com`, roleId: medref });
  const invite = await arrives((m) => to(m).includes(`newperson${stamp}`));
  const forgot = await fetch(B + '/auth/forgot', { method: 'POST', headers: H('', true), body: JSON.stringify({ email: 'mark.dc@example.com' }) });
  const reset = await arrives((m) => to(m).includes('mark.dc@') && /password/i.test(m.subject));

  console.log('\nA receipt goes all the way');
  const mine = async (name, amt) => step(U.ana, await makeDraft(U, 'ana', name + stamp, amt), 'submit');
  let r = await mine('Mail A ', 410);
  await look(U.liza, r);
  r = await step(U.liza, r, 'return', { note: 'The photo is blurry.', issues: ['photo_unclear'] });
  const returned = await arrives((m) => to(m).includes('ana.reyes') && /needs a correction/.test(m.subject) && m.html.includes(r.refNo));
  r = await step(U.ana, await get(U.ana, r), 'submit');
  await look(U.liza, r); r = await step(U.liza, r, 'check');
  await look(U.paolo, r);
  r = await step(U.paolo, r, 'reserve', { note: 'Waiting for the rate.' });
  const reserved = await arrives((m) => to(m).includes('ana.reyes') && /on hold/.test(m.subject) && m.html.includes(r.refNo));
  r = await step(U.paolo, r, 'release');
  const released = await arrives((m) => to(m).includes('ana.reyes') && /Hold released/.test(m.subject) && m.html.includes(r.refNo));
  r = await step(U.paolo, r, 'approve');
  const approved = await arrives((m) => to(m).includes('ana.reyes') && /was approved/.test(m.subject) && m.html.includes(r.refNo));
  const approvedChecker = await arrives((m) => to(m).includes('liza.santos') && /was approved/.test(m.subject) && m.html.includes(r.refNo));
  r = await step(U.paolo, r, 'undo', { note: 'Approved by mistake.' });
  const reversed = await arrives((m) => to(m).includes('ana.reyes') && /decision on .* was reversed/.test(m.subject) && m.html.includes(r.refNo));
  r = await step(U.paolo, r, 'approve');
  const methods = (await call(U.rica, 'GET', '/payments/methods')).d.methods.map((m) => (typeof m === 'string' ? m : m.name));
  const paidRes = await pay(U.rica, [await get(U.rica, r)], { method: methods[0] });
  const paid = await arrives((m) => to(m).includes('ana.reyes') && /Payment sent/.test(m.subject));
  r = await step(U.rica, await get(U.rica, r), 'reverse_payment', { note: 'Wrong account.' });
  const payRev = await arrives((m) => to(m).includes('ana.reyes') && /payment for .* was reversed/.test(m.subject));
  let d = await mine('Mail D ', 150);
  await look(U.liza, d); d = await step(U.liza, d, 'check'); await look(U.paolo, d);
  d = await step(U.paolo, d, 'disapprove', { note: 'Not reimbursable.' });
  const disapproved = await arrives((m) => to(m).includes('ana.reyes') && /was disapproved/.test(m.subject) && m.html.includes(d.refNo));

  console.log('\nThe daily emails');
  const anaId = (await call(U.admin, 'GET', '/users?q=ana.reyes')).d.users?.[0]?.id ?? (await call(U.admin, 'GET', '/users?q=ana.reyes')).d.items?.[0]?.id;
  await mine('Mail W ', 99);
  await call(U.admin, 'POST', '/email-log/digest-now', { userId: anaId });
  const digest = await arrives((m) => to(m).includes('ana.reyes') && /daily summary/.test(m.subject));
  const sched = await call(U.admin, 'POST', '/email-schedules', { name: 'All emails ' + stamp, steps: ['check'], minDays: 0, roleIds: [], userIds: [(await call(U.admin, 'GET', '/email-schedules/choices')).d.people.find((p) => p.name === 'Liza Santos').id], intervalMinutes: 60, startTime: '00:00', endTime: '23:59', days: [0, 1, 2, 3, 4, 5, 6], timeZone: 'Asia/Manila' });
  await call(U.admin, 'POST', `/email-schedules/${sched.d.schedule.id}/send-now`, {});
  const reminder = await arrives((m) => to(m).includes('liza.santos') && /waiting for you/.test(m.subject));
  await call(U.admin, 'DELETE', `/email-schedules/${sched.d.schedule.id}`);

  const all = { test, invite, reset, returned, reserved, released, approved, reversed, paid, payment_reversed: payRev, disapproved, digest, reminder };
  console.log('\nEach one arrived, to the right person, and reads properly');
  for (const [key, m] of Object.entries(all)) {
    ok(`${key}: arrived`, !!m);
    if (!m) continue;
    const text = (m.subject + ' ' + m.text + ' ' + m.html.replace(/<[^>]+>/g, ' '));
    ok(`${key}: no leftover {{ }}, "undefined" or "NaN"`, !/\{\{|\}\}|undefined|NaN/.test(text), text.match(/.{20}(\{\{|undefined|NaN).{20}/)?.[0]);
    ok(`${key}: from the right address, with a subject`, /no-reply@reimsys\.test/.test(m.from ?? '') && m.subject.length > 5, `${m.from} | ${m.subject}`);
    ok(`${key}: addressed by first name`, key === 'test' || /Hi \w+|Hello, \w+/.test(text) || key === 'paid' || key === 'reminder' || key === 'digest', text.slice(0, 120));
    // A link to a private address (localhost) is left out of the email on purpose, because it looks like spam; the email then says where to sign in.
    if (key !== 'test') ok(`${key}: has its button, or says where to sign in when the address is private`, /href="http[^"]*"/.test(m.html) || /sign in|log in|open reimsys|localhost/i.test(text), text.slice(-200));
  }
  ok('the checker is told too when a receipt is approved', !!approvedChecker);
  ok('paying worked, so the paid email was real', paidRes.s === 200 || paidRes.s === 201, JSON.stringify(paidRes.d).slice(0, 160));
  ok('the reset email has a working reset link', !!reset && /\/reset\?token=|\/reset\//.test(reset.html) && forgot.status < 300, reset?.html.match(/href="([^"]+)"/)?.[1]);
  ok('the invitation has its link', !!invite && /href="http:\/\/localhost:5173\/[^"]+"/.test(invite.html));
  const names = ['returned', 'approved', 'disapproved', 'reserved', 'released', 'reversed', 'paid', 'payment_reversed', 'digest', 'reminder', 'reset', 'invite', 'test'];
  ok('all thirteen emails of the system were sent and received', names.every((n) => !!all[n]));
  const log = (await call(U.admin, 'GET', '/email-log?pageSize=100')).d;
  ok('and the email log says sent for them', (log.items ?? []).filter((e) => /example\.com/.test(e.to) && e.status === 'sent').length >= 12, JSON.stringify(log.counts ?? log.total));
} finally {
  catcher.kill();
}
console.log(failed ? `\n${failed} FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
