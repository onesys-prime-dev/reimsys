// Two bugs seen on staging:
//  1. Number boxes accepted "e" (and "+", "-", and "." in whole-number boxes). They must take digits only, by typing and by pasting.
//  2. When the page is newer than the server (the web page updated, the API not restarted), the Settings page looked as if it saved but dropped the new
//     settings. It must say so and refuse to save. This script stands in for the older server by removing the newer settings from the answer.
// Needs the API (4000) and web app (5173). Usage: node e2e/settings-input.mjs
import { chromium } from 'playwright';
const WEB = process.env.WEB ?? 'http://localhost:5173';
let failed = 0;
const ok = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : x); if (!c) failed++; };
const NEW_KEYS = ['privacyRetention', 'privacyContact', 'privacyVersion', 'retentionMonths'];

const b = await chromium.launch({ channel: 'chrome' });
const login = async (email) => {
  const p = await (await b.newContext({ viewport: { width: 1280, height: 860 }, baseURL: WEB })).newPage();
  await p.goto('/'); await p.fill('input[type=email]', email); await p.fill('input[type=password]', 'Reimsys#2026'); await p.click('button[type=submit]'); await p.waitForSelector('.shell');
  return p;
};
const typeInto = async (p, sel, text) => { await p.locator(sel).first().click(); await p.keyboard.press('Control+A'); await p.keyboard.press('Delete'); for (const ch of text) await p.keyboard.press(ch); return p.locator(sel).first().inputValue(); };

console.log('Number boxes take digits only');
{
  const p = await login('admin@example.com');
  await p.goto('/access'); await p.click('.tabs button:has-text("Settings")'); await p.waitForSelector('input[aria-label="Point out finished records older than"]');
  const kp = await typeInto(p, 'input[aria-label="Point out finished records older than"]', '1e+-2.5');
  ok('a whole-number box (keeping period) ignores e + - and . (1e+-2.5 leaves 125)', kp === '125', 'got ' + JSON.stringify(kp));
  ok('a decimal box (VAT rate) keeps digits and the point but ignores e + -', (await typeInto(p, 'input[aria-label="VAT rate"]', '1e+-2.5')) === '12.5');
  ok('the box that said "must be a number" for the letter e no longer shows it', (await p.locator('text=must be a number').count()) === 0);
  const pasted = (text, sel) => p.locator(sel).first().evaluate((el, t) => { const dt = new DataTransfer(); dt.setData('text', t); const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }); el.dispatchEvent(ev); return ev.defaultPrevented; }, text);
  ok('pasting "1e5" into a whole-number box is refused', await pasted('1e5', 'input[aria-label="Point out finished records older than"]') === true);
  ok('pasting "36" into it is allowed', await pasted('36', 'input[aria-label="Point out finished records older than"]') === false);
  ok('pasting "-4" is refused', await pasted('-4', 'input[aria-label="VAT rate"]') === true);
  await p.click('.tabs button:has-text("Email")'); await p.waitForSelector('input[type=number]');
  ok('the mail port takes digits only', (await typeInto(p, 'input[type=number]', '5e8.7')) === '587');
  await p.context().close();
}
{
  const p = await login('ana.reyes@example.com');
  await p.goto('/receipts/new'); await p.waitForSelector('.steps');
  await p.getByRole('radio', { name: /^No/ }).first().click(); await p.click('button:has-text("Next")');
  const amount = p.getByLabel(/Amount paid to vendor/);
  await amount.click(); await amount.fill('');
  for (const ch of '1e+-2.50') await p.keyboard.press(ch);
  ok('an amount box keeps digits and the decimal point only', (await amount.inputValue()) === '12.50', await amount.inputValue());
  await p.context().close();
}

console.log('\nA page newer than its server');
{
  const p = await login('admin@example.com');
  const sent = [];
  const strip = (j) => { for (const k of NEW_KEYS) { delete j.settings[k]; delete j.defaults[k]; } return j; };
  await p.route('**/api/app-settings', async (route) => {
    const req = route.request();
    if (req.method() === 'PUT') {
      sent.push(JSON.parse(req.postData() ?? '{}'));
      // answer like an older server would, without touching the real settings
      const get = await (await p.request.get('http://localhost:4000/api/app-settings')).json();
      return route.fulfill({ json: strip(get) });
    }
    const r = await route.fetch(); await route.fulfill({ response: r, json: strip(await r.json()) });
  });
  await p.goto('/access'); await p.click('.tabs button:has-text("Settings")'); await p.waitForSelector('text=This page is newer than the server');
  const t = await p.locator('.callout.bad').first().innerText();
  ok('it says the page is newer than the server and lists the settings the server does not know', /newer than the server/.test(t) && /How long records are kept/.test(t) && /Notice version/.test(t) && /Point out finished records/.test(t), t.slice(0, 300));
  ok('it tells people what to do (update and restart the API)', /restart/i.test(t));
  ok('the settings the server does not know are hidden, not shown as empty "Required" boxes', (await p.locator('h3:has-text("Privacy notice")').count()) === 0 && (await p.locator('h3:has-text("Keeping records")').count()) === 0 && (await p.locator('text=Preview now').count()) === 0 && (await p.locator('.err').count()) === 0);
  ok('the other settings are still there', (await p.locator('input[aria-label="VAT rate"]').count()) === 1 && (await p.locator('input[aria-label="Sign out after no activity for"]').count()) === 1);
  await p.fill('input[aria-label="VAT rate"]', '13');
  ok('and they can still be saved', await p.locator('button:has-text("Save settings")').isEnabled());
  await p.click('button:has-text("Save settings")');
  await p.waitForTimeout(800);
  ok('saving sends the change the person made', sent.length === 1 && Number(sent[0].vatRate) === 13, JSON.stringify(sent[0] ?? null).slice(0, 120));
  await p.context().close();
}
{
  const p = await login('admin@example.com');
  await p.goto('/access'); await p.click('.tabs button:has-text("Settings")'); await p.waitForSelector('input[aria-label="VAT rate"]');
  ok('with a current server there is no such warning', (await p.locator('text=This page is newer than the server').count()) === 0);
  await p.fill('input[aria-label="VAT rate"]', '12.5');
  ok('and Save settings works as before', await p.locator('button:has-text("Save settings")').isEnabled());
  await p.context().close();
}
await b.close();
console.log(failed ? `\n${failed} FAILED` : '\nBoth problems fixed.');
process.exit(failed ? 1 : 0);
