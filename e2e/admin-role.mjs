// The everyday Admin role (below the Super Admin): looks after people and settings and sees everything, but cannot change roles, check, approve or pay,
// cannot touch the Super Admin, and gets a reminder email about every receipt that is stuck. Needs the API (4000), the seeded users and the MySQL tools of XAMPP.
// Usage: node e2e/admin-role.mjs
import { spawnSync } from 'node:child_process';
import { B, H, call, checker, login, loginAll, makeDraft } from './payment-helpers.mjs';

const { ok, done } = checker();
const U = await loginAll();
const boss = await login('manager@example.com');
const sql = (q) => { const r = spawnSync(process.env.MYSQL ?? 'C:/xampp/mysql/bin/mysql.exe', ['-uroot', 'reimsys', '-e', q], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); };
const stamp = Date.now().toString().slice(-6);

console.log('What the Admin is');
const me = (await call(boss, 'GET', '/me')).d;
const perms = new Set(me.permissions);
ok('the role is called Admin and ranks below the Super Admin', me.user.role.name === 'Admin');
for (const p of ['user.manage', 'receipt.view_all', 'audit.view', 'category.manage', 'settings.manage', 'report.generate', 'reminder.overview']) ok(`has ${p}`, perms.has(p));
for (const p of ['role.manage', 'review.check', 'review.decide', 'payment.mark', 'receipt.create']) ok(`does not have ${p}`, !perms.has(p));
const roles = (await call(boss, 'GET', '/roles')).d.roles;
ok('both Admin and Super Admin are in the list of roles', ['Admin', 'Super Admin'].every((n) => roles.some((r) => r.name === n)));

console.log('\nPeople');
const users = await call(boss, 'GET', '/users');
ok('can see the list of users', users.s === 200 && users.d.users.length > 5);
const medrole = roles.find((r) => r.name === 'Med Ref');
const superRole = roles.find((r) => r.name === 'Super Admin');
const adminRole = roles.find((r) => r.name === 'Admin');
const mk = await call(boss, 'POST', '/users', { name: 'Boss Made ' + stamp, email: `boss.made.${stamp}@example.com`, roleId: medrole.id });
ok('can add a person as a Med Ref', mk.s === 201, JSON.stringify(mk.d?.error ?? ''));
ok('can switch them off again', mk.s === 201 && (await call(boss, 'PATCH', `/users/${mk.d.user.id}`, { isActive: false })).s === 200);
ok('can add another Admin', (await call(boss, 'POST', '/users', { name: 'Second Admin ' + stamp, email: `second.admin.${stamp}@example.com`, roleId: adminRole.id })).s === 201);
ok('cannot make anyone a Super Admin', (await call(boss, 'POST', '/users', { name: 'Sneaky ' + stamp, email: `sneaky.${stamp}@example.com`, roleId: superRole.id })).s === 403);
const superUser = users.d.users.find((u) => u.email === 'admin@example.com');
ok('cannot change, switch off or reset the Super Admin', (await call(boss, 'PATCH', `/users/${superUser.id}`, { isActive: false })).s === 403 && (await call(boss, 'POST', `/users/${superUser.id}/reset-password`)).s === 403);
ok('cannot promote themselves', (await call(boss, 'PATCH', `/users/${me.user.id}`, { roleId: superRole.id })).s >= 400);

console.log('\nRoles and rights');
ok('cannot create a role', (await call(boss, 'POST', '/roles', { code: 'x' + stamp, name: 'X ' + stamp, rank: 10 })).s === 403);
ok('cannot change what a role may do', (await call(boss, 'PUT', `/roles/${medrole.id}/permissions`, { permissions: ['receipt.create'] })).s === 403);

console.log('\nSeeing everything, changing nothing');
const list = await call(boss, 'GET', '/receipts?pageSize=5');
ok('can open the list of receipts', list.s === 200);
const tax = await call(boss, 'GET', '/dashboard/tax-impact');
ok('sees every employee in the tax figures', tax.s === 200 && tax.d.scope === 'all');
ok('can browse the audit log and the email log', (await call(boss, 'GET', '/audit')).s === 200 && (await call(boss, 'GET', '/email-log')).s === 200);
ok('can edit categories, where to charge and the settings', (await call(boss, 'POST', '/charge-locations', { name: 'Admin Test ' + stamp })).s === 201 && (await call(boss, 'GET', '/settings/mail')).s === 200);
const r = await (async () => { const d = await makeDraft(U, 'ana', 'Admin sees', 120); const s = await call(U.ana, 'POST', `/receipts/${d.id}/submit`, { version: d.version }); return s.d.receipt; })();
ok('can open evidence of someone else\'s receipt', (await fetch(`${B}/receipts/${r.id}/evidence/${r.evidence[0].id}/file?mode=view`, { headers: H(boss, false) })).status === 200);
ok('cannot check, approve or pay it', (await call(boss, 'POST', `/receipts/${r.id}/check`, { version: r.version, seen: { company: true, tin: true, address: true } })).s === 403 && (await call(boss, 'POST', `/receipts/${r.id}/approve`, { version: r.version })).s === 403);
ok('cannot encode receipts of their own', (await call(boss, 'POST', '/receipts', { birInvoice: false })).s === 403);
ok('the Med Ref who made the receipt cannot use the Admin pages', (await call(U.ana, 'GET', '/users')).s === 403);

console.log('\nThe daily reminder of everything stuck');
// One receipt waiting to be checked for 6 days, one returned and waiting for its owner for 6 days.
const stuck = r;
const fix = await (async () => { const d = await makeDraft(U, 'ana', 'Admin sees fix', 130); const s = await call(U.ana, 'POST', `/receipts/${d.id}/submit`, { version: d.version }); await fetch(`${B}/receipts/${d.id}/evidence/${d.evidence[0].id}/file?mode=view`, { headers: H(U.liza, false) }); return (await call(U.liza, 'POST', `/receipts/${d.id}/return`, { version: s.d.receipt.version, note: 'Retake the photo.' })).d.receipt; })();
sql(`UPDATE receipt SET submittedAt = UTC_TIMESTAMP(3) - INTERVAL 6 DAY WHERE id = ${stuck.id}; UPDATE receipt SET updatedAt = UTC_TIMESTAMP(3) - INTERVAL 6 DAY WHERE id = ${fix.id};`);
const before = (await call(boss, 'GET', '/email-log?pageSize=100')).d.total;
const now = await call(U.admin, 'POST', '/email-log/reminders-now');
ok('the reminders go out', now.s === 200 && now.d.sent >= 1);
await new Promise((res) => setTimeout(res, 2500));
const log = (await call(boss, 'GET', '/email-log?pageSize=100')).d;
const mine = (log.items ?? []).filter((e) => e.to === 'manager@example.com' && /reminder/.test(e.template ?? ''));
ok('the Admin got a reminder email', mine.length >= 1, `emails before ${before}, after ${log.total}`);
const notice = (await call(boss, 'GET', '/notifications')).d;
const text = JSON.stringify(notice);
ok('and a notice in the bell that names both stuck receipts, whatever their step', text.includes(stuck.refNo) && text.includes(fix.refNo), text.slice(0, 300));

done();
