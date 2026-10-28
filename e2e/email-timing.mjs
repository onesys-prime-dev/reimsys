// The settings for when the daily emails go out: saving, refusing bad values, who may change them, and the Settings screen. Needs the API (4000) and web app (5173).
// Usage: node e2e/email-timing.mjs
import { chromium } from 'playwright';
import { call, loginAll } from './payment-helpers.mjs';

const U = await loginAll();
let failed = 0;
const ok = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : x); if (!c) failed++; };
const codes = (r) => (r.d?.error?.issues ?? []).map((i) => i.path[0]);

const cur = (await call(U.admin, 'GET', '/app-settings')).d;
try {
  ok('the defaults are 08:00 and 09:00, Monday to Saturday, Manila, 3 hours late', cur.defaults.digestTime === '08:00' && cur.defaults.reminderTime === '09:00' && cur.defaults.emailDays === '1,2,3,4,5,6' && cur.defaults.emailTimeZone === 'Asia/Manila' && cur.defaults.emailLateHours === 3 && cur.defaults.digestOn === true && cur.defaults.reminderOn === true);

  console.log('\nSaving');
  const next = { ...cur.settings, digestTime: '07:30', reminderTime: '10:15', emailDays: '1,2,3,4,5', emailLateHours: 2, reminderOn: false };
  const saved = await call(U.admin, 'PUT', '/app-settings', next);
  ok('the Super Admin saves new times', saved.s === 200 && saved.d.settings.digestTime === '07:30' && saved.d.settings.reminderTime === '10:15' && saved.d.settings.emailDays === '1,2,3,4,5' && saved.d.settings.emailLateHours === 2 && saved.d.settings.reminderOn === false, JSON.stringify(saved.d).slice(0, 200));
  const boss = await (await import('./payment-helpers.mjs')).login('manager@example.com');
  const bossSave = await call(boss, 'PUT', '/app-settings', { ...next, digestTime: '06:45' });
  ok('the Admin can change them too', bossSave.s === 200 && bossSave.d.settings.digestTime === '06:45', JSON.stringify(bossSave.d).slice(0, 160));
  ok('a Med Ref cannot', (await call(U.ana, 'PUT', '/app-settings', next)).s === 403);
  ok('nor the Checker', (await call(U.liza, 'PUT', '/app-settings', next)).s === 403);

  console.log('\nBad values are refused');
  for (const [label, o, key] of [
    ['a time that is not a time', { digestTime: '25:00' }, 'digestTime'],
    ['a time without the zero', { reminderTime: '9:00' }, 'reminderTime'],
    ['no day at all', { emailDays: '' }, 'emailDays'],
    ['a day that does not exist', { emailDays: '1,7' }, 'emailDays'],
    ['a time zone that does not exist', { emailTimeZone: 'Mars/Base' }, 'emailTimeZone'],
    ['a late window over 12 hours', { emailLateHours: 13 }, 'emailLateHours'],
    ['a negative late window', { emailLateHours: -1 }, 'emailLateHours'],
  ]) {
    const r = await call(U.admin, 'PUT', '/app-settings', { ...next, ...o });
    ok(`${label} is refused`, r.s === 400 && codes(r).includes(key), JSON.stringify(r.d).slice(0, 160));
  }
  ok('nothing bad was saved', (await call(U.admin, 'GET', '/app-settings')).d.settings.digestTime === '06:45');

  console.log('\n"Send now" ignores the schedule');
  await call(U.admin, 'PUT', '/app-settings', { ...next, reminderOn: false, digestOn: false });
  ok('reminders can still be sent now with the reminders switched off', (await call(U.admin, 'POST', '/email-log/reminders-now', {})).s === 200);
  ok('and the daily summary', (await call(U.admin, 'POST', '/email-log/digest-now', { userId: 1 })).s === 200);

  console.log('\nThe Settings screen');
  await call(U.admin, 'PUT', '/app-settings', { ...cur.settings, digestTime: '08:00', reminderTime: '09:00' });
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, baseURL: process.env.WEB ?? 'http://localhost:5173' })).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto('/'); await p.fill('input[type=email]', 'admin@example.com'); await p.fill('input[type=password]', 'Reimsys#2026'); await p.click('button[type=submit]'); await p.waitForSelector('.shell');
  await p.goto('/access'); await p.getByRole('tab', { name: /Settings/ }).click(); await p.waitForSelector('text=When emails go out');
  ok('the group is there with its two switches, two times and the days', (await p.getByLabel('Daily summary time').count()) === 1 && (await p.getByLabel('Reminder time').count()) === 1 && (await p.getByRole('group', { name: 'Days they are sent' }).getByRole('button').count()) === 7);
  const sentence = await p.locator('[data-testid=email-schedule]').innerText();
  ok('it says in words when each goes out', /daily summary goes out at 8:00 AM \(Asia\/Manila\), Monday to Saturday/i.test(sentence) && /reminder goes out at 9:00 AM/i.test(sentence), sentence);
  await p.getByLabel('Daily summary time').fill('17:30');
  await p.getByRole('group', { name: 'Days they are sent' }).getByRole('button', { name: 'Sat' }).click();
  const after = await p.locator('[data-testid=email-schedule]').innerText();
  ok('the words follow what is being changed', /5:30 PM/.test(after) && /Monday to Friday/.test(after), after);
  await p.getByRole('group', { name: 'Days they are sent' }).getByRole('button', { name: 'Mon' }).click();
  for (const d of ['Tue', 'Wed', 'Thu', 'Fri']) await p.getByRole('group', { name: 'Days they are sent' }).getByRole('button', { name: d }).click();
  await p.getByLabel('Time zone').fill('Mars/Base');
  ok('a time zone that does not exist is explained next to its box', (await p.locator('.err').allInnerTexts()).some((t) => /not a time zone/i.test(t)));
  ok('and with no day chosen, saving is blocked and it says why', (await p.getByRole('button', { name: 'Save settings' }).isDisabled()) && (await p.locator('.err').allInnerTexts()).some((t) => /at least one day/i.test(t)));
  await p.getByRole('button', { name: 'Undo my edits' }).click();
  ok('Undo puts it back', /8:00 AM/.test(await p.locator('[data-testid=email-schedule]').innerText()));
  ok('nothing scrolls sideways', (await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1);
  ok('no errors in the browser', errs.length === 0, errs.join(' | '));
  await b.close();
} finally {
  await call(U.admin, 'PUT', '/app-settings', cur.settings); // put the settings back as they were
}
console.log(failed ? `\n${failed} FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
