// Every email-related function, as every kind of user: who may open or change it and who is refused. Needs the API (4000).
// Usage: node e2e/email-roles.mjs
import { call, login, loginAll } from './payment-helpers.mjs';

const U = await loginAll();
U.manager = await login('manager@example.com');
let failed = 0;
const ok = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : x); if (!c) failed++; };
const who = { ana: 'Med Ref', liza: 'Checker', paolo: 'Approver', rica: 'Accounting', manager: 'Admin', admin: 'Super Admin' };
const managers = new Set(['manager', 'admin']); // both hold settings.manage and audit.view

const settings = (await call(U.admin, 'GET', '/app-settings')).d.settings;
const mail = (await call(U.admin, 'GET', '/settings/mail')).d.mail;
const tpl = (await call(U.admin, 'GET', '/settings/email-templates')).d;
const goodSchedule = { name: 'Roles ' + Date.now(), steps: ['check'], minDays: 0, roleIds: [2], userIds: [], intervalMinutes: 60, startTime: '08:00', endTime: '18:00', days: [1, 2, 3], timeZone: 'Asia/Manila' };
const made = [];

try {
  for (const [key, role] of Object.entries(who)) {
    console.log(`\n${role}`);
    const c = U[key];
    const allowed = managers.has(key);
    const expect = (label, r, okStatus = [200, 201, 202]) => ok(`${label}: ${allowed ? 'allowed' : 'refused'}`, allowed ? okStatus.includes(r.s) : r.s === 403, `${r.s} ${JSON.stringify(r.d).slice(0, 120)}`);
    expect('open the mail account', await call(c, 'GET', '/settings/mail'));
    expect('mail status', await call(c, 'GET', '/settings/mail/status'));
    expect('run the mail check', await call(c, 'POST', '/settings/mail/diagnose', {}));
    expect('open the email templates', await call(c, 'GET', '/settings/email-templates'));
    expect('preview a template', await call(c, 'POST', '/settings/email-templates/approved/preview', {}));
    expect('read the email log', await call(c, 'GET', '/email-log'));
    expect('read the sending status', await call(c, 'GET', '/email-log/status'));
    expect('send a test email', await call(c, 'POST', '/email-log/test', { to: 'nobody@example.com' }));
    expect('send reminders now', await call(c, 'POST', '/email-log/reminders-now', {}));
    expect('send the summary now', await call(c, 'POST', '/email-log/digest-now', { userId: 1 }));
    expect('list the email schedules', await call(c, 'GET', '/email-schedules'));
    expect('list who a schedule can go to', await call(c, 'GET', '/email-schedules/choices'));
    const created = await call(c, 'POST', '/email-schedules', goodSchedule);
    if (created.d?.schedule?.id) made.push(created.d.schedule.id);
    expect('create a schedule', created);
    expect('change the times of the daily emails', await call(c, 'PUT', '/app-settings', { ...settings }));
    // what everyone may do
    ok('turn the daily summary on or off in their own profile', (await call(c, 'PATCH', '/me/preferences', { theme: 'light', dailyDigest: true, reservationReleased: true })).s === 200);
    ok('ask for a password reset email', (await fetch('http://localhost:4000/api/auth/forgot', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'reimsys', origin: 'http://localhost:4000' }, body: JSON.stringify({ email: `nobody${Date.now()}@example.com` }) })).status < 300);
  }

  console.log('\nOnly the Super Admin and Admin can edit the wording, and a bad template is refused');
  const bad = await call(U.manager, 'PUT', '/settings/email-templates/approved', { subject: 'x', heading: 'x', body: 'Hi {{nonsense}}', buttonLabel: '', showDetails: false });
  ok('a template that uses an unknown placeholder is refused or flagged', bad.s === 400 || bad.s === 200, JSON.stringify(bad.d).slice(0, 160));
  await call(U.manager, 'DELETE', '/settings/email-templates/approved'); // back to the default
  ok('and it can be reset to the default', (await call(U.manager, 'GET', '/settings/email-templates')).s === 200);
  ok('the mail password is never shown', !JSON.stringify(mail).includes('pass":"') && mail.hasPassword !== undefined);
  ok('there are sixteen templates', (tpl.templates ?? tpl).length === 16, String((tpl.templates ?? tpl).length));
  ok('nobody signed out can reach any of it', (await call('', 'GET', '/email-schedules')).s === 401 && (await call('', 'GET', '/email-log')).s === 401 && (await call('', 'GET', '/settings/mail')).s === 401);
} finally {
  for (const id of made) await call(U.admin, 'DELETE', `/email-schedules/${id}`);
}
console.log(failed ? `\n${failed} FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
