// Forgot-password and invitation links, end to end in a browser.
// It points the app at a local test mailbox for the duration (your saved mail account is backed up first and put back exactly after).
// Usage: WEB=http://localhost:4000 node e2e/password-links.mjs <work-dir>
import { chromium } from 'playwright';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const WEB = process.env.WEB ?? 'http://localhost:4000';
const dir = path.resolve(process.argv[2] ?? 'storage/pw-test');
const box = path.join(dir, 'mailbox');
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(box, { recursive: true });
const sql = (q) => execFileSync('C:/xampp/mysql/bin/mysql.exe', ['-u', 'root', 'reimsys', '-N', '-B', '-e', q], { encoding: 'utf8' }).trim();
let bad = 0;
const ok = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : x); if (!c) bad++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(400); } return null; };

/* ---- point the app at the local test mailbox, remembering what was there ---- */
const backup = sql("SELECT value FROM setting WHERE `key`='mail'");
fs.writeFileSync(path.join(dir, 'mail-setting.backup.json'), backup);
const catcher = spawn(process.execPath, ['e2e/smtp-catcher.mjs', box], { stdio: 'ignore' });
await sleep(1500);
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
sql(`REPLACE INTO setting (\`key\`, value, updatedAt) VALUES ('mail', '${esc(JSON.stringify({ host: 'localhost', port: 1025, secure: false, user: '', passEnc: null, fromName: 'REIMSYS', fromAddress: 'no-reply@reimsys.test', testRedirect: '' }))}', UTC_TIMESTAMP())`);
await sleep(16000); // the app re-reads mail settings every 15 seconds

const mails = () => fs.readdirSync(box).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(box, f), 'utf8')));
// The email carries the app's public address; this PC's browser reaches the app through localhost instead.
const linkIn = (m) => {
  const found = (m.text.match(/https?:\/\/\S+\/reset\?token=[A-Za-z0-9_%-]+/) ?? [])[0];
  return found && found.replace(/^https?:\/\/[^/]+/, WEB);
};

const H = (c) => ({ cookie: c, 'x-requested-with': 'reimsys', origin: WEB, 'content-type': 'application/json' });
const api = async (c, m, p, b) => { const r = await fetch(WEB + '/api' + p, { method: m, headers: H(c), body: b ? JSON.stringify(b) : undefined }); return { status: r.status, data: await r.json().catch(() => null), cookie: r.headers.get('set-cookie')?.split(';')[0] }; };
const loginApi = async (email, password) => api('', 'POST', '/auth/login', { email, password });

const b = await chromium.launch({ channel: 'chrome' });
const errs = [];
const page = async (size = { width: 1100, height: 800 }) => { const p = await (await b.newContext({ viewport: size, baseURL: WEB })).newPage(); p.on('pageerror', (e) => errs.push(String(e))); p.on('console', (m) => m.type() === 'error' && !/40[0-9]|42[0-9]/.test(m.text()) && errs.push(m.text())); return p; };

try {
  const stamp = Date.now();
  const email = `reset.${stamp}@example.com`;

  /* ---- an administrator invites someone ---- */
  const admin = (await loginApi('admin@example.com', 'Reimsys#2026')).cookie;
  const roles = (await api(admin, 'GET', '/roles')).data.roles;
  const created = await api(admin, 'POST', '/users', { name: 'Reset Tester', email, roleId: roles.find((r) => r.code === 'medref').id });
  ok('the new user is created and still gets a temporary password', created.status === 201 && !!created.data.temporaryPassword);
  const invite = await until(() => mails().find((m) => m.to?.includes(email) && /Welcome/.test(m.subject)));
  ok('an invitation email arrives', !!invite, JSON.stringify(mails().map((m) => m.subject)));
  const inviteLink = invite && linkIn(invite);
  ok('the invitation carries a link even though the app is on a plain address', !!inviteLink, invite?.text);

  const p1 = await page();
  await p1.goto(inviteLink);
  await p1.waitForSelector('text=Welcome, Reset');
  await p1.screenshot({ path: path.join(dir, 'invite-page.png') });
  await p1.fill('input[autocomplete="new-password"] >> nth=0', 'abc');
  await p1.fill('input[autocomplete="new-password"] >> nth=1', 'abc');
  await p1.click('button:has-text("Save password")');
  await p1.waitForSelector('.err');
  ok('a weak password is refused with a plain message', /8 characters/.test(await p1.locator('.err').innerText()), await p1.locator('.err').innerText());
  await p1.fill('input[autocomplete="new-password"] >> nth=0', 'InviteOne123');
  await p1.fill('input[autocomplete="new-password"] >> nth=1', 'InviteTwo123');
  await p1.click('button:has-text("Save password")');
  await p1.waitForSelector('.err');
  ok('two different passwords are refused', /do not match/.test(await p1.locator('.err').innerText()));
  await p1.fill('input[autocomplete="new-password"] >> nth=1', 'InviteOne123');
  await p1.click('button:has-text("Save password")');
  await p1.waitForSelector('text=Password saved');
  ok('the invitation link lets them choose a password', true);
  ok('and they can sign in with it, without being forced to change it again', (await loginApi(email, 'InviteOne123')).data?.user?.mustChangePassword === false);
  ok('the temporary password no longer works', (await loginApi(email, created.data.temporaryPassword)).status === 401);
  await p1.goto(inviteLink); await p1.waitForSelector('text=no longer works');
  ok('the same link cannot be used twice', true);

  /* ---- forgot password ---- */
  const sess = (await loginApi(email, 'InviteOne123')).cookie;
  ok('a signed-in session exists before the reset', (await api(sess, 'GET', '/me')).status === 200);

  const p2 = await page();
  await p2.goto('/'); await p2.fill('input[type=email]', 'x'); // sign-in page first, to use the real "Forgot your password?" link
  await p2.click('text=Forgot your password?'); await p2.waitForSelector('text=Forgot your password?');
  await p2.fill('input[type=email]', 'nobody.' + stamp + '@example.com'); await p2.click('button:has-text("Send me a link")');
  await p2.waitForSelector('text=Check your email');
  const unknownText = await p2.locator('.lcard').innerText();
  await sleep(2500);
  ok('an unknown address gets the same answer, and no email', mails().filter((m) => m.to?.includes('nobody.' + stamp)).length === 0);

  const p3 = await page();
  await p3.goto('/forgot'); await p3.fill('input[type=email]', email); await p3.click('button:has-text("Send me a link")');
  await p3.waitForSelector('text=Check your email');
  const knownText = await p3.locator('.lcard').innerText();
  ok('a real address gets the same kind of answer, so nobody can probe for accounts', unknownText.replace(/\S+@\S+/, '') === knownText.replace(/\S+@\S+/, ''), unknownText + ' | ' + knownText);
  const first = await until(() => mails().find((m) => m.to?.includes(email) && /new password/.test(m.subject)));
  ok('the reset email arrives', !!first, JSON.stringify(mails().map((m) => m.subject)));
  const link1 = first && linkIn(first);

  await p3.goto('/forgot'); await p3.fill('input[type=email]', email); await p3.click('button:has-text("Send me a link")'); await p3.waitForSelector('text=Check your email');
  const second = await until(() => mails().filter((m) => m.to?.includes(email) && /new password/.test(m.subject)).length >= 2 && mails().filter((m) => m.to?.includes(email) && /new password/.test(m.subject))[1]);
  const link2 = second && linkIn(second);
  const p4 = await page(); await p4.goto(link1); await p4.waitForSelector('text=no longer works');
  ok('asking again cancels the earlier link', true);
  await p4.screenshot({ path: path.join(dir, 'old-link.png') });

  sql(`UPDATE passwordtoken SET expiresAt = UTC_TIMESTAMP() - INTERVAL 1 MINUTE WHERE userId = (SELECT id FROM user WHERE email='${email}') AND usedAt IS NULL`);
  await p4.goto(link2); await p4.waitForSelector('text=no longer works');
  ok('an expired link is refused', true);
  sql(`UPDATE passwordtoken SET expiresAt = UTC_TIMESTAMP() + INTERVAL 30 MINUTE WHERE userId = (SELECT id FROM user WHERE email='${email}') AND usedAt IS NULL`);

  await p4.goto(link2); await p4.waitForSelector('text=Choose a new password');
  await p4.screenshot({ path: path.join(dir, 'reset-page.png') });
  await p4.fill('input[autocomplete="new-password"] >> nth=0', 'FreshStart456'); await p4.fill('input[autocomplete="new-password"] >> nth=1', 'FreshStart456');
  await p4.click('button:has-text("Save password")'); await p4.waitForSelector('text=Password saved');
  ok('the emailed link lets them choose a new password', true);
  ok('the new password works', (await loginApi(email, 'FreshStart456')).status === 200);
  ok('the old password does not', (await loginApi(email, 'InviteOne123')).status === 401);
  ok('every older sign-in was ended', (await api(sess, 'GET', '/me')).status === 401);
  ok('the reset is in the audit log', Number(sql("SELECT COUNT(*) FROM auditlog WHERE action IN ('auth.reset_requested','auth.password_reset')")) >= 3);
  ok('the token is stored hashed, never as the link', sql('SELECT COUNT(*) FROM passwordtoken WHERE tokenHash LIKE \'%reset%\'') === '0' && !JSON.stringify(sql('SELECT tokenHash FROM passwordtoken ORDER BY id DESC LIMIT 1')).includes(link2.split('token=')[1]));

  /* ---- rate limit on asking for links ---- */
  let limited = false;
  for (let i = 0; i < 8 && !limited; i++) limited = (await api('', 'POST', '/auth/forgot', { email })).status === 429;
  ok('asking for links over and over is slowed down', limited);

  /* ---- phone ---- */
  const ph = await page({ width: 390, height: 800 });
  await ph.goto('/forgot'); await ph.waitForSelector('h1');
  ok('no sideways scrolling on a phone', (await ph.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1);
  await ph.screenshot({ path: path.join(dir, 'forgot-phone.png') });
  ok('no browser errors', errs.length === 0, JSON.stringify(errs));
} finally {
  await b.close();
  catcher.kill();
  // put the saved mail account back exactly as it was
  if (backup) sql(`REPLACE INTO setting (\`key\`, value, updatedAt) VALUES ('mail', '${esc(backup)}', UTC_TIMESTAMP())`);
  else sql("DELETE FROM setting WHERE `key`='mail'");
  const after = sql("SELECT value FROM setting WHERE `key`='mail'");
  console.log(after === backup ? '\nSaved mail account restored exactly.' : '\nWARNING: the saved mail account differs from the backup, see ' + path.join(dir, 'mail-setting.backup.json'));
  sql("DELETE FROM session WHERE userId IN (SELECT id FROM user WHERE email LIKE 'reset.%@example.com')");
  sql("DELETE FROM user WHERE email LIKE 'reset.%@example.com'");
}
console.log(bad ? `\n${bad} FAILED` : '\nAll password-link checks passed');
process.exit(bad ? 1 : 0);
