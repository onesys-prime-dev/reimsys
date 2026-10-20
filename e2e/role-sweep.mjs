// Signs in as each demo account in Chrome (computer and phone), opens every screen it can reach and reports what it found:
// the menu, permissions, pages that fail, console errors, failed requests, sideways scrolling on the phone, empty pages.
// Needs the API (4000) and web app (5173). Usage: node e2e/role-sweep.mjs [screenshot-dir]
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WEB = process.env.WEB ?? 'http://localhost:5173';
const OUT = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'reimsys-role-sweep'));
fs.mkdirSync(OUT, { recursive: true });
const PW = 'Reimsys#2026';
const ACCOUNTS = [
  ['Super Admin', 'admin@example.com'],
  ['Approver', 'paolo.v@example.com'],
  ['Checker', 'liza.santos@example.com'],
  ['Accounting', 'accounting@example.com'],
  ['Med Ref', 'ana.reyes@example.com'],
  ['Med Ref 2', 'mark.dc@example.com'],
];
const ALL_PAGES = ['/', '/receipts', '/receipts/new', '/receipts/import', '/pay', '/reports', '/access', '/audit', '/profile', '/privacy'];

const browser = await chromium.launch({ channel: 'chrome' });
const report = [];

for (const [role, email] of ACCOUNTS) {
  for (const [label, size] of [['computer', { width: 1280, height: 860 }], ['phone', { width: 390, height: 780 }]]) {
    const ctx = await browser.newContext({ viewport: size, baseURL: WEB });
    const p = await ctx.newPage();
    const problems = [];
    p.on('pageerror', (e) => problems.push('script error: ' + String(e).slice(0, 120)));
    p.on('console', (m) => m.type() === 'error' && !/40[0-9]|Failed to load resource/.test(m.text()) && problems.push('console: ' + m.text().slice(0, 120)));
    p.on('response', (r) => { if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`); });
    await p.goto('/');
    await p.fill('input[type=email]', email);
    await p.fill('input[type=password]', PW);
    await p.click('button[type=submit]');
    try { await p.waitForSelector('.shell', { timeout: 15000 }); } catch { problems.push('could not sign in / app did not open'); report.push({ role, label, email, problems }); await ctx.close(); continue; }

    const menu = await p.$$eval(label === 'computer' ? '.side nav a' : '.bnav a', (as) => as.map((a) => a.textContent.trim()));
    const pages = {};
    for (const pg of ALL_PAGES) {
      await p.goto(pg);
      await p.waitForTimeout(700);
      const landed = new URL(p.url()).pathname;
      const text = (await p.locator('main.page').innerText().catch(() => '')).trim();
      const overflow = label === 'phone' ? await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1) : false;
      pages[pg] = { landed, chars: text.length, overflow, title: await p.locator('.top .t').innerText().catch(() => '') };
      if (overflow) problems.push(`sideways scroll on ${pg}`);
      if (landed === pg && text.length < 20) problems.push(`${pg} looks empty`);
      if (label === 'computer' && ['/', '/receipts', '/reports', '/access', '/pay', '/audit'].includes(pg) && landed === pg) await p.screenshot({ path: path.join(OUT, `${role.replace(/ /g, '')}-${pg === '/' ? 'dashboard' : pg.slice(1).replace(/\//g, '-')}.png`) });
    }
    // The first receipt this person can see
    await p.goto('/receipts');
    await p.waitForTimeout(800);
    const rows = await p.locator('main.page table tbody tr, main.page .rlist > *, main.page .rcard').count().catch(() => 0);
    const firstLink = p.locator('main.page a[href^="/receipts/"]').first();
    let opened = 'none to open';
    if (await firstLink.count()) {
      await firstLink.click();
      await p.waitForTimeout(900);
      const buttons = await p.$$eval('main.page button', (bs) => bs.map((b) => b.textContent.trim()).filter(Boolean).slice(0, 14));
      opened = `${new URL(p.url()).pathname} buttons: ${buttons.join(' | ')}`;
      if (label === 'computer') await p.screenshot({ path: path.join(OUT, `${role.replace(/ /g, '')}-receipt.png`), fullPage: true });
    }
    const me = await p.evaluate(async () => (await fetch('/api/me', { credentials: 'same-origin' })).json());
    report.push({ role, label, email, menu, permissions: me.permissions, pages, rows, opened, problems });
    await ctx.close();
  }
}
await browser.close();
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));

for (const r of report.filter((x) => x.label === 'computer')) {
  console.log(`\n=== ${r.role} (${r.email})`);
  console.log('menu:', (r.menu ?? []).join(', '));
  console.log('permissions:', (r.permissions ?? []).length, '-', (r.permissions ?? []).join(' '));
  const redirected = Object.entries(r.pages ?? {}).filter(([pg, v]) => v.landed !== pg).map(([pg, v]) => `${pg}→${v.landed}`);
  console.log('cannot open (redirected):', redirected.join(', ') || 'none');
  console.log('first receipt:', r.opened);
}
console.log('\n=== problems');
let n = 0;
for (const r of report) for (const pr of r.problems) { n++; console.log(`${r.role} (${r.label}): ${pr}`); }
if (!n) console.log('none');
console.log('\nscreenshots + report.json in', OUT);
