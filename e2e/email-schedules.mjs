// Your own reminder emails (Access -> Email schedules): creating them, who may, the 30-minute floor, who is told about what, and the screen.
// Needs the API (4000) and web app (5173). Usage: node e2e/email-schedules.mjs
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { call, loginAll, login, makeDraft, B, H } from './payment-helpers.mjs';

const U = await loginAll();
const boss = await login('manager@example.com');
let failed = 0;
const ok = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : x); if (!c) failed++; };
const codes = (r) => (r.d?.error?.issues ?? []).map((i) => i.path[0]);
const sql = (q) => execFileSync('C:/xampp/mysql/bin/mysql.exe', ['-u', 'root', 'reimsys', '-N', '-B', '-e', q], { encoding: 'utf8' }).trim();
const step = async (c, r, a, body = {}) => { const x = await call(c, 'POST', `/receipts/${r.id}/${a}`, { version: r.version, ...body }); if (x.s !== 200) throw new Error(`${a} ${x.s} ${JSON.stringify(x.d)}`); return x.d.receipt; };
const look = (c, r) => fetch(`${B}/receipts/${r.id}/evidence/${r.evidence[0].id}/file?mode=view`, { headers: H(c, false) });

const choices = (await call(U.admin, 'GET', '/email-schedules/choices')).d;
const idOf = (name) => choices.people.find((p) => p.name === name)?.id;
const bossId = choices.people.find((p) => p.name === 'Office Admin')?.id;
const roleId = (n) => choices.roles.find((r) => r.name === n)?.id;
const stamp = Date.now();
const good = { name: 'Test hourly ' + stamp, steps: ['check', 'pay'], minDays: 0, roleIds: [], userIds: [bossId], intervalMinutes: 60, startTime: '00:00', endTime: '23:59', days: [0, 1, 2, 3, 4, 5, 6], timeZone: 'Asia/Manila' };
const made = [];
const cleanup = async () => { for (const id of made) await call(U.admin, 'DELETE', `/email-schedules/${id}`); };

try {
  console.log('Who may');
  ok('the choices list roles and people', choices.roles.length >= 5 && choices.people.length >= 6 && bossId);
  ok('a Med Ref cannot open the schedules', (await call(U.ana, 'GET', '/email-schedules')).s === 403);
  ok('nor create one', (await call(U.ana, 'POST', '/email-schedules', good)).s === 403);
  ok('nor the Checker', (await call(U.liza, 'GET', '/email-schedules')).s === 403);
  ok('nobody signed out', (await call('', 'GET', '/email-schedules')).s === 401);

  console.log('\nCreating and the rules');
  const c = await call(boss, 'POST', '/email-schedules', good);
  ok('the Admin creates one', c.s === 201 && c.d.schedule.recipientCount === 1 && c.d.schedule.intervalMinutes === 60, JSON.stringify(c.d).slice(0, 200));
  const sid = c.d.schedule.id; made.push(sid);
  for (const [label, o, key] of [
    ['15 minutes', { intervalMinutes: 15 }, 'intervalMinutes'], ['5 minutes', { intervalMinutes: 5 }, 'intervalMinutes'], ['0 minutes', { intervalMinutes: 0 }, 'intervalMinutes'], ['45 minutes (not a choice)', { intervalMinutes: 45 }, 'intervalMinutes'],
    ['no name', { name: '' }, 'name'], ['no step', { steps: [] }, 'steps'], ['nobody to send to', { roleIds: [], userIds: [] }, 'userIds'], ['no day', { days: [] }, 'days'],
    ['an end before the start', { startTime: '10:00', endTime: '09:00' }, 'endTime'], ['a bad time', { startTime: '8am' }, 'startTime'], ['a time zone that does not exist', { timeZone: 'Mars/Base' }, 'timeZone'], ['a negative wait', { minDays: -1 }, 'minDays'],
  ]) { const r = await call(U.admin, 'POST', '/email-schedules', { ...good, ...o }); ok(`${label} is refused`, r.s === 400 && codes(r).includes(key), JSON.stringify(r.d).slice(0, 160)); }
  ok('30 minutes is the lowest allowed', (await call(U.admin, 'PATCH', `/email-schedules/${sid}`, { intervalMinutes: 30 })).s === 200);
  ok('the list has it', (await call(U.admin, 'GET', '/email-schedules')).d.schedules.some((s) => s.id === sid && s.intervalMinutes === 30));

  console.log('\nWho is told about what');
  const mk = async (name, amt) => step(U.ana, await makeDraft(U, 'ana', name, amt), 'submit');
  const toCheck = await mk('Sched check ' + stamp, 111);   // waiting to be checked, Ana's own
  const toPay = await (async () => { let r = await mk('Sched pay ' + stamp, 222); await look(U.liza, r); r = await step(U.liza, r, 'check'); await look(U.paolo, r); return step(U.paolo, r, 'approve'); })();
  const prev = (await call(U.admin, 'POST', `/email-schedules/${sid}/preview`, {})).d;
  const me = prev.wouldSend.find((w) => w.id === bossId);
  ok('the preview says the Admin would be emailed about both', me && me.receipts >= 2, JSON.stringify(prev).slice(0, 300));
  const fresh = await call(U.admin, 'PATCH', `/email-schedules/${sid}`, { steps: ['decide'], userIds: [idOf('Ana Reyes'), idOf('Liza Santos')] });
  const p2 = (await call(U.admin, 'POST', `/email-schedules/${sid}/preview`, {})).d;
  ok('only the chosen step is listed: nothing waits for a decision from this test', fresh.s === 200 && !p2.wouldSend.some((w) => w.first.some((l) => l.includes('Sched'))), JSON.stringify(p2).slice(0, 300));
  await call(U.admin, 'PATCH', `/email-schedules/${sid}`, { steps: ['check'], roleIds: [roleId('Med Ref'), roleId('Checker')], userIds: [] });
  const p3 = (await call(U.admin, 'POST', `/email-schedules/${sid}/preview`, {})).d;
  ok('a whole role is added: the Checkers are told', p3.wouldSend.some((w) => w.name === 'Liza Santos' && w.first.concat([]).length >= 0 && w.receipts >= 1));
  ok("Ana is not told about her own receipt", !p3.wouldSend.some((w) => w.name === 'Ana Reyes' && w.first.some((l) => l.includes('Sched check'))));
  ok("Mark, a Med Ref, is told about it", p3.wouldSend.some((w) => w.name === 'Mark Dela Cruz'));
  await call(U.admin, 'PATCH', `/email-schedules/${sid}`, { minDays: 30 });
  ok('with a long minimum wait nobody is told about new receipts', (await call(U.admin, 'POST', `/email-schedules/${sid}/preview`, {})).d.wouldSend.length === 0);
  await call(U.admin, 'PATCH', `/email-schedules/${sid}`, { minDays: 0, roleIds: [], userIds: [bossId], steps: ['check', 'pay'] });

  console.log('\nSending');
  const before = Number(sql(`SELECT COUNT(*) FROM emaillog WHERE template='reminder' AND toEmail='manager@example.com'`));
  const sent = await call(U.admin, 'POST', `/email-schedules/${sid}/send-now`, {});
  ok('send now queues an email for the Admin', sent.s === 200 && sent.d.sent === 1, JSON.stringify(sent.d));
  const after = Number(sql(`SELECT COUNT(*) FROM emaillog WHERE template='reminder' AND toEmail='manager@example.com'`));
  ok('it is in the email log', after === before + 1);
  ok('send now does not use up the schedule', (await call(U.admin, 'GET', '/email-schedules')).d.schedules.find((s) => s.id === sid).lastSentAt === null);
  ok('a person switched off is not emailed', await (async () => { const created = await call(U.admin, 'POST', '/users', { name: 'Gone Person ' + stamp, email: `gone${stamp}@example.com`, roleId: roleId('Med Ref') }); const gid = created.d?.user?.id; if (!gid) return false; await call(U.admin, 'PATCH', `/users/${gid}`, { isActive: false }); await call(U.admin, 'PATCH', `/email-schedules/${sid}`, { userIds: [bossId, gid] }); const r = await call(U.admin, 'GET', '/email-schedules'); return r.d.schedules.find((s) => s.id === sid).recipientCount === 1; })());
  await call(U.admin, 'PATCH', `/email-schedules/${sid}`, { userIds: [bossId] });

  console.log('\nThe worker sends it on time, once per interval');
  const w = await call(U.admin, 'POST', '/email-schedules', { ...good, name: 'Worker ' + stamp, intervalMinutes: 60 }); made.push(w.d.schedule.id);
  const countW = () => Number(sql(`SELECT COUNT(*) FROM emaillog WHERE template='reminder' AND toEmail='manager@example.com'`));
  const c0 = countW();
  let c1 = c0; for (let i = 0; i < 30 && c1 === c0; i++) { await new Promise((r) => setTimeout(r, 2000)); c1 = countW(); }
  ok('within a minute or so the due schedule sends by itself', c1 > c0, `${c0} -> ${c1}`);
  const stamped = (await call(U.admin, 'GET', '/email-schedules')).d.schedules.find((s) => s.id === w.d.schedule.id);
  ok('it records when it last sent', !!stamped.lastSentAt && stamped.lastCount === 1, JSON.stringify(stamped));
  await new Promise((r) => setTimeout(r, 70_000));
  ok('and does not send again the next minute', countW() === c1, `${c1} -> ${countW()}`);
  ok('a switched-off schedule never sends', await (async () => { await call(U.admin, 'PATCH', `/email-schedules/${w.d.schedule.id}`, { isOn: false }); sql(`UPDATE email_schedule SET lastSentAt = NULL WHERE id = ${w.d.schedule.id}`); const k = countW(); await new Promise((r) => setTimeout(r, 65_000)); return countW() === k; })());

  console.log('\nThe screen');
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, baseURL: process.env.WEB ?? 'http://localhost:5173' })).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto('/'); await p.fill('input[type=email]', 'manager@example.com'); await p.fill('input[type=password]', 'Reimsys#2026'); await p.click('button[type=submit]'); await p.waitForSelector('.shell');
  await p.goto('/access'); await p.getByRole('tab', { name: 'Email schedules' }).click(); await p.waitForSelector('[data-testid=schedule-card]');
  ok('the Admin has the tab and sees the schedules in words', /Lists receipts/.test(await p.locator('[data-testid=schedule-card]').first().innerText()));
  await p.getByRole('button', { name: 'New schedule' }).click();
  ok('Save is blocked until it is filled in', await p.getByRole('button', { name: 'Save schedule' }).isDisabled());
  await p.getByPlaceholder(/Hourly reminder/).fill('Boss and Liza ' + stamp);
  await p.getByLabel('Find a person').fill('Liza'); await p.getByRole('group', { name: 'People' }).getByLabel(/Liza/).check();
  ok('a person can be found and ticked', await p.getByRole('group', { name: 'People' }).getByLabel(/Liza/).isChecked());
  ok('every 30 minutes is offered, nothing shorter', (await p.getByRole('combobox').first().locator('option').allInnerTexts())[0] === 'Every 30 minutes' && (await p.locator('option', { hasText: /minutes/ }).count()) === 1);
  await p.getByRole('combobox').first().selectOption('120');
  await p.locator('label.field', { hasText: 'Until' }).locator('input').fill('07:00');
  ok('an end before the start is explained next to its box', (await p.locator('.err').allInnerTexts()).some((t) => /after the start/i.test(t)));
  await p.locator('label.field', { hasText: 'Until' }).locator('input').fill('17:00');
  const sentence = await p.locator('[data-testid=schedule-sentence]').innerText();
  ok('it says in words what it will do', /Every 2 hours, 08:00 to 17:00/.test(sentence), sentence);
  await p.getByRole('button', { name: 'Save schedule' }).click(); await p.waitForSelector('text=Boss and Liza ' + stamp);
  const mine = (await call(U.admin, 'GET', '/email-schedules')).d.schedules.find((s) => s.name === 'Boss and Liza ' + stamp); if (mine) made.push(mine.id);
  ok('it is saved and listed', !!mine && mine.userIds.length === 1 && mine.intervalMinutes === 120);
  const card = p.locator('[data-testid=schedule-card]', { hasText: 'Boss and Liza ' + stamp });
  await card.getByRole('button', { name: 'Preview' }).click(); await p.waitForSelector('[role=dialog]');
  ok('Preview opens', /Preview: Boss and Liza/.test(await p.locator('[role=dialog]').innerText())); await p.keyboard.press('Escape');
  await card.getByRole('button', { name: 'Delete' }).click(); await p.getByRole('button', { name: 'Delete', exact: true }).last().click();
  await p.waitForSelector('text=Boss and Liza ' + stamp, { state: 'detached' });
  ok('and can be deleted', true);
  ok('nothing scrolls sideways', (await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1);
  ok('no errors in the browser', errs.length === 0, errs.join(' | '));
  await b.close();
  const log = (await call(U.admin, 'GET', '/audit?action=emailschedule&pageSize=50')).d.items.map((e) => e.action);
  ok('creating, changing, sending and deleting are in the audit log', ['emailschedule.created', 'emailschedule.updated', 'emailschedule.sent_now', 'emailschedule.deleted'].every((a) => log.includes(a)), JSON.stringify(log));
} finally {
  await cleanup();
}
console.log(failed ? `\n${failed} FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
