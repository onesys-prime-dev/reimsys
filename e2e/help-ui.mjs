// The Help page: every role sees the basics and ONLY the guides for what it may do; the links work; it fits a phone. Needs the API (4000) and web app (5173).
// Usage: node e2e/help-ui.mjs
import { chromium } from 'playwright';
const WEB = process.env.WEB ?? 'http://localhost:5173';
let failed = 0;
const ok = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : x); if (!c) failed++; };
const GUIDES = { medref: 'Med Ref: sending in a receipt', checker: 'Checker: verifying receipts', approver: 'Approver: deciding', accounting: 'Accounting: paying', admin: 'Super Admin: running the system' };
const WHO = [
  ['Med Ref', 'ana.reyes@example.com', ['medref']],
  ['Checker', 'liza.santos@example.com', ['checker']],
  ['Approver', 'paolo.v@example.com', ['approver']],
  ['Accounting', 'accounting@example.com', ['accounting']],
  ['Super Admin', 'admin@example.com', ['admin']],
];
const b = await chromium.launch({ channel: 'chrome' });
for (const [label, size] of [['computer', { width: 1280, height: 860 }], ['phone', { width: 390, height: 780 }]]) {
  console.log('\n' + label);
  for (const [role, email, mine] of WHO) {
    const p = await (await b.newContext({ viewport: size, baseURL: WEB })).newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto('/'); await p.fill('input[type=email]', email); await p.fill('input[type=password]', 'Reimsys#2026'); await p.click('button[type=submit]'); await p.waitForSelector('.shell');
    // reach it the way a person would: the Help button in the top bar
    await p.click('button[aria-label="Help"]');
    await p.waitForSelector('h1:has-text("Help")');
    const heads = await p.locator('section.card .card-h h2').allInnerTexts();
    ok(`${role}: sees the basics and their own account section`, heads.includes('The basics') && heads.includes('Your account'));
    for (const [key, title] of Object.entries(GUIDES)) {
      const has = heads.includes(title);
      ok(`${role}: ${mine.includes(key) ? 'has' : 'does not have'} the "${title.split(':')[0]}" guide`, has === mine.includes(key), heads.join(' | '));
    }
    const navLinks = await p.locator('.helpnav a').count();
    ok(`${role}: the link bar matches the guides shown (${navLinks})`, navLinks === 2 + mine.length, String(navLinks));
    if (label === 'computer') {
      const target = mine[0];
      await p.click(`.helpnav a[href="#${target}"]`);
      await p.waitForTimeout(400);
      const top = await p.locator(`#${target}`).evaluate((e) => Math.round(e.getBoundingClientRect().top));
      ok(`${role}: the link jumps to the guide, below the top bar (top at ${top}px)`, top >= 60 && top < 400, String(top));
    }
    ok(`${role}: nothing runs off the side of the screen`, !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));
    ok(`${role}: no errors in the browser`, errors.length === 0, errors.join(' | '));
    if (role === 'Med Ref' || role === 'Super Admin') await p.screenshot({ path: process.env.TEMP + `/help-${role.replace(' ', '')}-${label}.png`, fullPage: true });
    await p.context().close();
  }
}
await b.close();
console.log(failed ? `\n${failed} FAILED` : '\nHelp works for every role.');
process.exit(failed ? 1 : 0);
