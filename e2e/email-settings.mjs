// Exercises the Email settings page as the Super Admin against the pretend mail server (e2e/smtp-catcher.mjs on port 1025).
// Usage: node e2e/email-settings.mjs <screenshot-dir> <mailbox-dir>
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [OUT, BOX] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const SECRET = 'S3cret-App-Pass-9';
let failed = 0;
const ok = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : x); if (!c) failed++; };
const sql = (q) => execFileSync('C:/xampp/mysql/bin/mysql.exe', ['-u', 'root', 'reimsis', '-N', '-B', '-e', q], { encoding: 'utf8' });

const b = await chromium.launch({ channel: 'chrome' });
async function login(email, size = { width: 1280, height: 900 }) {
  const p = await (await b.newContext({ viewport: size, baseURL: 'http://localhost:4000' })).newPage();
  await p.goto('/'); await p.fill('input[type=email]', email); await p.fill('input[type=password]', 'Reimsis#2026'); await p.click('button[type=submit]');
  await p.waitForSelector('.shell');
  return p;
}
const api = (p, url, opts = {}) => p.evaluate(async ([u, o]) => { const r = await fetch(u, { ...o, headers: { 'x-requested-with': 'reimsis', 'content-type': 'application/json' } }); return { s: r.status, t: await r.text() }; }, [url, opts]);

sql("DELETE FROM Setting WHERE `key`='mail'");
const p = await login('admin@example.com');
await p.goto('/access'); await p.click('button[role=tab]:has-text("Email")');
await p.waitForSelector('text=Email account');
ok('starts with no account set up', await p.locator('text=No email account is set up yet').isVisible());
ok('test email is disabled until an account is saved', await p.locator('button:has-text("Send test email")').isDisabled());

// validation
await p.click('button[type=submit]:has-text("Save")');
ok('empty form shows plain-language errors', (await p.locator('.err').allInnerTexts()).join(' ').includes('Enter the mail server address.'));

// wrong password first
await p.click('.seg button:has-text("Other")');
await p.fill('input[placeholder="smtp.gmail.com"]', 'localhost');
await p.fill('input[type=number]', '1025');
await p.fill('input[placeholder="you@gmail.com"] >> nth=0', 'reimsis-mail');
await p.fill('input[type=password]', 'wrong');
await p.fill('input[placeholder="Your Organisation"]', 'REIMSIS');
await p.fill('input[type=email] >> nth=0', 'no-reply@reimsis.test');
await p.click('button:has-text("Test connection")');
await p.waitForSelector('.callout.bad');
const bad = await p.locator('.callout.bad').innerText();
ok('wrong password gives a clear message', /username or password/i.test(bad), bad);
await p.screenshot({ path: path.join(OUT, 'mail-wrong-password.png'), fullPage: true });

// right password
await p.fill('input[type=password]', SECRET);
await p.click('button:has-text("Test connection")');
await p.waitForSelector('.callout.ok:has-text("Connection works")');
ok('correct password connects', true);
await p.click('button[type=submit]:has-text("Save")');
await p.waitForSelector('.toast:has-text("Email account saved")');
await p.waitForSelector('text=Sending through localhost');
ok('banner shows the saved account', true);
await p.waitForTimeout(800); // give any late refresh a chance to wipe the form, which used to happen
ok('the form keeps its values after saving', (await p.inputValue('input[placeholder="smtp.gmail.com"]')) === 'localhost' && (await p.inputValue('input[placeholder="you@gmail.com"] >> nth=0')) === 'reimsis-mail' && (await p.inputValue('input[type=email] >> nth=0')) === 'no-reply@reimsis.test');
ok('password box is cleared and says it is saved', (await p.inputValue('input[type=password]')) === '' && await p.locator('text=Saved. Leave blank to keep it').isVisible());
await p.screenshot({ path: path.join(OUT, 'mail-saved.png'), fullPage: true });

// reload: password must never come back
await p.reload(); await p.click('button[role=tab]:has-text("Email")'); await p.waitForSelector('text=Sending through localhost');
ok('after a reload the password field is still empty', (await p.inputValue('input[type=password]')) === '');
const got = await api(p, '/api/settings/mail');
ok('the API never returns the password', !got.t.includes(SECRET) && JSON.parse(got.t).mail.hasPassword === true, got.t);

// stored encrypted
const stored = sql("SELECT value FROM Setting WHERE `key`='mail'");
ok('the password is encrypted in the database', stored.includes('"passEnc":"v1:') && !stored.includes(SECRET));
ok('the audit log never contains the password', !sql("SELECT CONCAT_WS(' ', summary, `before`, `after`) FROM AuditLog WHERE action LIKE 'settings.%'").includes(SECRET));
ok('the audit log recorded the change', sql("SELECT COUNT(*) FROM AuditLog WHERE action='settings.mail_saved'").trim() !== '0');

// real send, using the saved account
await p.fill('input[aria-label="Test email address"]', 'onesysprimedev@gmail.com');
await p.click('button:has-text("Send test email")');
await p.waitForSelector('.toast:has-text("Test email queued")');
let delivered = null;
for (let i = 0; i < 20 && !delivered; i++) {
  await new Promise((r) => setTimeout(r, 500));
  delivered = fs.readdirSync(BOX).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(BOX, f), 'utf8'))).find((m) => /onesysprimedev/.test(m.to ?? '') && m.authUser === 'reimsis-mail');
}
ok('the test email arrived, signed in with the saved username', !!delivered, JSON.stringify(delivered));
ok('it was sent from the address you set', !!delivered && /REIMSIS/.test(delivered.from) && /no-reply@reimsis.test/.test(delivered.from), delivered?.from);

// leaving the password blank keeps it
await p.fill('input[placeholder="Your Organisation"]', 'REIMSIS Cebu');
await p.click('button[type=submit]:has-text("Save")'); await p.waitForSelector('.toast:has-text("Email account saved")');
const again = sql("SELECT value FROM Setting WHERE `key`='mail'");
ok('saving with a blank password keeps the saved one', again.includes('"passEnc":"v1:') && again.includes('REIMSIS Cebu'));

// Emails tab shows it
await p.goto('/audit'); await p.click('button[role=tab]:has-text("Emails")');
await p.waitForSelector('.callout.ok:has-text("Sending through localhost")');
ok('the Emails tab reports the saved account and the send', await p.locator('.pill:has-text("sent")').first().isVisible());

// others cannot see it
for (const who of ['ana.reyes@example.com', 'liza.santos@example.com', 'paolo.v@example.com']) {
  const o = await login(who);
  const r = await api(o, '/api/settings/mail');
  ok(`${who.split('@')[0]} cannot read or change the mail settings`, r.s === 403 && (await api(o, '/api/settings/mail', { method: 'PUT', body: '{}' })).s === 403);
  await o.context().close();
}

// phone layout
const m = await login('admin@example.com', { width: 390, height: 844 });
await m.goto('/access'); await m.click('button[role=tab]:has-text("Email")'); await m.waitForSelector('text=Email account');
ok('no sideways scrolling on a phone', (await m.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1);
await m.screenshot({ path: path.join(OUT, 'mail-phone.png'), fullPage: true });

await b.close();
console.log(failed ? `\n${failed} FAILED` : '\nAll email settings checks passed');
process.exit(failed ? 1 : 0);
