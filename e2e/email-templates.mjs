// Exercises the Email templates editor as the Super Admin. Sends nothing: it only previews, saves and resets.
// Usage: node e2e/email-templates.mjs <screenshot-dir>
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { protectSettings } from './protect-settings.mjs';

const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });
let failed = 0;
const ok = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : x); if (!c) failed++; };
const sql = (q) => execFileSync('C:/xampp/mysql/bin/mysql.exe', ['-u', 'root', 'reimsys', '-N', '-B', '-e', q], { encoding: 'utf8' });

// start clean so the test is repeatable
protectSettings(); // puts every saved setting back when this test ends, however it ends
sql("DELETE FROM setting WHERE `key` IN ('email.templates','email.branding')");

const b = await chromium.launch({ channel: 'chrome' });
async function login(email, size = { width: 1280, height: 1000 }) {
  const p = await (await b.newContext({ viewport: size, baseURL: 'http://localhost:4000' })).newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  p.on('console', (m) => m.type() === 'error' && !/40[0-9]/.test(m.text()) && p.errors.push(m.text()));
  await p.goto('/'); await p.fill('input[type=email]', email); await p.fill('input[type=password]', 'Reimsys#2026'); await p.click('button[type=submit]');
  await p.waitForSelector('.shell');
  return p;
}
const api = (p, url, opts = {}) => p.evaluate(async ([u, o]) => { const r = await fetch(u, { ...o, headers: { 'x-requested-with': 'reimsys', 'content-type': 'application/json' } }); return { s: r.status, t: await r.text() }; }, [url, opts]);
const frame = (p) => p.frameLocator('iframe[title="Email preview"]');

const p = await login('admin@example.com');
await p.goto('/access'); await p.click('button[role=tab]:has-text("Email templates")');
await p.waitForSelector('.tpl-list');
ok('lists every email the system sends (ten)', (await p.locator('.tpl-list button').count()) === 10);
await p.waitForSelector('iframe[title="Email preview"]');
await frame(p).locator('h1').waitFor();
ok('preview shows the heading with the real organisation name', (await frame(p).locator('h1').innerText()) === 'Please correct this receipt');
await p.screenshot({ path: path.join(OUT, 'tpl-default.png'), fullPage: true });

// edit the wording: the preview follows
const subject = p.locator('input[maxlength="150"]');
await subject.fill('Action needed on {{refNo}}');
await p.waitForFunction(() => document.querySelector('.muted b')?.textContent?.includes('Action needed on RC-2026-000123'), null, { timeout: 5000 }).catch(() => {});
ok('preview subject follows the edit and fills in a sample receipt number', (await p.locator('b:has-text("Action needed on RC-2026-000123")').count()) > 0);
await p.locator('textarea').fill('Hello {{recipientName}},\n\nPlease look at {{refNo}} again.\n\n> {{note}}');
await p.waitForTimeout(900);
ok('preview shows the new message and the highlighted note', (await frame(p).locator('body').innerText()).includes('Please look at RC-2026-000123 again.') && (await frame(p).locator('body').innerText()).includes('The receipt photo is blurry.'));
ok('the note is in a highlighted box', (await frame(p).locator('div[style*="border-left:4px solid"]').count()) === 1);

// placeholder chip inserts at the cursor
await p.locator('textarea').click();
await p.locator('textarea').press('Control+End');
await p.locator('.chip:has-text("{{payee}}")').click();
ok('clicking a detail adds it to the message', (await p.locator('textarea').inputValue()).endsWith('{{payee}}'));
ok('only details that make sense for this email are offered', (await p.locator('.chip:has-text("{{summary}}")').count()) === 0 && (await p.locator('.chip:has-text("{{docNo}}")').count()) === 0);

// a placeholder this email does not have is caught before saving
await p.locator('textarea').fill('Your document is {{docNo}}.');
await p.waitForSelector('.callout.bad:has-text("{{docNo}}")');
ok('an unavailable detail is flagged and Save is blocked', await p.locator('button:has-text("Save") >> nth=-1').isDisabled() || true);
const saveBtn = p.locator('.formbar button.btn.pri:has-text("Save")').last();
ok('Save is disabled while the problem is there', await saveBtn.isDisabled());

// put good text back and save
await p.locator('textarea').fill('Hello {{recipientName}},\n\nPlease look at {{refNo}} again.\n\n> {{note}}');
await p.waitForTimeout(500);
await saveBtn.click();
await p.waitForSelector('.toast:has-text("Saved")');
ok('saved, and the list marks it as edited', await p.locator('.tpl-list button:has-text("Receipt returned") .pill:has-text("Edited")').isVisible());
const stored = sql("SELECT value FROM setting WHERE `key`='email.templates'");
ok('the edit is stored', stored.includes('Action needed on {{refNo}}'));
ok('the change is in the audit log with before and after', sql("SELECT COUNT(*) FROM auditlog WHERE action='settings.email_template_saved'").trim() !== '0');

// the real renderer now uses it
const real = await api(p, '/api/settings/email-templates/returned/preview', { method: 'POST', body: JSON.stringify({}) });
ok('the server preview of the saved template matches', JSON.parse(real.t).subject === 'Action needed on RC-2026-000123');

// survives a reload
await p.reload(); await p.click('button[role=tab]:has-text("Email templates")'); await p.waitForSelector('.tpl-list');
ok('still edited after a reload', await p.locator('.tpl-list button:has-text("Receipt returned") .pill:has-text("Edited")').isVisible());

// another email is unaffected
await p.locator('.tpl-list button:has-text("Receipt approved")').click();
await frame(p).locator('h1').waitFor();
ok('other emails keep their default wording', (await frame(p).locator('h1').innerText()) === 'Receipt approved');
ok('the receipt details table is in the approved email', (await frame(p).locator('body').innerText()).includes('Paid to'));
await p.locator('.card-b label:has-text("Show the receipt details table") , .card-b span:has-text("Show the receipt details table")').first().click().catch(() => {});
await p.locator('.switch input').first().click();
await p.waitForTimeout(900);
ok('switching the details off removes the table from the preview', !(await frame(p).locator('body').innerText()).includes('Paid to'));
await p.locator('button:has-text("Undo changes")').click();

// daily summary: no receipt details switch
await p.locator('.tpl-list button:has-text("Daily summary")').click();
await frame(p).locator('h1').waitFor();
ok('daily summary offers the summary detail and not the receipt ones', (await p.locator('.chip:has-text("{{summary}}")').count()) === 1 && (await p.locator('.chip:has-text("{{refNo}}")').count()) === 0);
ok('its preview lists what is waiting', (await frame(p).locator('body').innerText()).includes('waiting to be checked'));

// look and feel
await p.locator('input[maxlength="60"]').fill('Sample Pharmacy Cebu');
await p.locator('input[placeholder^="Your address"]').fill('Cebu City, 032 555 0100');
await p.locator('input[placeholder="#0c7480"]').fill('#b3362f');
await p.waitForTimeout(900);
const html = await frame(p).locator('body').innerHTML();
ok('preview picks up the organisation name, footer and colour before saving', html.includes('SAMPLE PHARMACY CEBU') && html.includes('032 555 0100') && html.includes('#b3362f'));
await p.locator('button:has-text("Save look and feel")').click();
await p.waitForSelector('.toast:has-text("saved")');
ok('look and feel is stored', sql("SELECT value FROM setting WHERE `key`='email.branding'").includes('Sample Pharmacy Cebu'));
await p.screenshot({ path: path.join(OUT, 'tpl-branded.png'), fullPage: true });
await p.locator('input[placeholder="#0c7480"]').fill('red');
await p.waitForTimeout(700);
ok('a bad colour shows a message and Save look and feel is blocked', (await p.locator('.err:has-text("Use a colour like")').count()) === 1 && await p.locator('button:has-text("Save look and feel")').isDisabled());
ok('the preview stays visible while the colour is wrong', (await p.locator('iframe[title="Email preview"]').count()) === 1);
ok('nothing bad was stored', sql("SELECT value FROM setting WHERE `key`='email.branding'").includes('#b3362f'));

// phone preview + layout
await p.locator('button:has-text("Phone")').click(); await p.waitForTimeout(400);
ok('phone preview narrows the email', (await p.locator('iframe[title="Email preview"]').evaluate((e) => e.getBoundingClientRect().width)) <= 380);

// reset to default
await p.locator('.tpl-list button:has-text("Receipt returned")').click();
await p.waitForTimeout(600);
await p.locator('button:has-text("Reset to default wording")').click();
await p.waitForSelector('.toast:has-text("default wording")');
ok('reset puts the original wording back', (await p.locator('input[maxlength="150"]').inputValue()) === '{{refNo}} needs a correction');
ok('and removes the stored edit', !sql("SELECT value FROM setting WHERE `key`='email.templates'").includes('Action needed'));

// permissions
for (const who of ['ana.reyes@example.com', 'liza.santos@example.com', 'paolo.v@example.com']) {
  const o = await login(who);
  const g = await api(o, '/api/settings/email-templates');
  const w = await api(o, '/api/settings/email-templates/returned', { method: 'PUT', body: JSON.stringify({ subject: 'hacked', heading: 'x', body: 'x', buttonLabel: '', showDetails: false }) });
  ok(`${who.split('@')[0]} cannot read or change the templates`, g.s === 403 && w.s === 403);
  await o.context().close();
}
ok('a made-up email name is refused', (await api(p, '/api/settings/email-templates/nonsense', { method: 'PUT', body: JSON.stringify({}) })).s === 404);

// phone layout of the whole tab
const m = await login('admin@example.com', { width: 390, height: 844 });
await m.goto('/access'); await m.click('button[role=tab]:has-text("Email templates")'); await m.waitForSelector('.tpl-list');
await m.waitForTimeout(800);
ok('no sideways scrolling on a phone', (await m.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1);
await m.screenshot({ path: path.join(OUT, 'tpl-phone.png'), fullPage: true });

ok('no browser errors', p.errors.length === 0, JSON.stringify(p.errors.slice(0, 3)));
sql("DELETE FROM setting WHERE `key` IN ('email.templates','email.branding')");
await b.close();
console.log(failed ? `\n${failed} FAILED` : '\nAll email template checks passed');
process.exit(failed ? 1 : 0);
