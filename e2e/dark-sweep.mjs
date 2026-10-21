// Opens every screen as every role in DARK mode (computer and phone), measures the contrast of all visible text against what it sits on, and takes
// screenshots. Text below the WCAG minimum (4.5, or 3 for large text) is listed. Puts each account's theme back to Light afterwards.
// Needs the API (4000) and web app (5173). Usage: node e2e/dark-sweep.mjs [screenshot-dir] [--light]   (--light runs the same check in light mode)
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const API = process.env.API ?? 'http://localhost:4000/api';
const WEB = process.env.WEB ?? 'http://localhost:5173';
const LIGHT = process.argv.includes('--light');
const OUT = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? path.join(os.tmpdir(), LIGHT ? 'reimsys-light-sweep' : 'reimsys-dark-sweep');
fs.mkdirSync(OUT, { recursive: true });

const ROLES = [
  ['admin', 'admin@example.com', ['/', '/receipts', '/reports', '/access|Users', '/access|Roles and permissions', '/access|Settings', '/access|Company', '/access|Email', '/access|Email templates', '/audit', '/audit|Emails', '/profile', '/profile|Security', '/profile|Notifications', '/profile|My access', '/profile|Appearance', '/profile|Activity', '/privacy']],
  ['checker', 'liza.santos@example.com', ['/', '/receipts', '/receipt', '/reports', '/report']],
  ['approver', 'paolo.v@example.com', ['/', '/receipts', '/receipt']],
  ['accounting', 'accounting@example.com', ['/', '/pay', '/receipts', '/receipt', '/reports']],
  ['medref', 'ana.reyes@example.com', ['/', '/receipts', '/receipt', '/receipts/new', '/receipts/import', '/reports']],
];

const call = async (cookie, m, p, b) => {
  const r = await fetch(API + p, { method: m, headers: { 'x-requested-with': 'reimsys', origin: new URL(API).origin, cookie, ...(b ? { 'content-type': 'application/json' } : {}) }, body: b ? JSON.stringify(b) : undefined });
  return { s: r.status, d: await r.json().catch(() => null), cookie: r.headers.get('set-cookie')?.split(';')[0] };
};
const login = async (email) => (await call('', 'POST', '/auth/login', { email, password: 'Reimsys#2026' })).cookie;

/** Runs inside the page: every piece of visible text, its colour, what it sits on, and the contrast between them. */
const MEASURE = () => {
  const parse = (c) => {
    let m = /^rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[,/ ]+([\d.]+))?\)/.exec(c);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
    m = /^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.e-]+))?\)/.exec(c);
    if (m) return [Number(m[1]) * 255, Number(m[2]) * 255, Number(m[3]) * 255, m[4] === undefined ? 1 : Number(m[4])];
    return null;
  };
  const over = (top, bottom) => { const a = top[3]; return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a), 1]; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const bgOf = (el) => {
    const chain = [];
    for (let e = el; e; e = e.parentElement) { const bg = parse(getComputedStyle(e).backgroundColor); if (bg && bg[3] > 0) { chain.push(bg); if (bg[3] >= 1) break; } }
    let base = parse(getComputedStyle(document.body).backgroundColor) ?? [255, 255, 255, 1];
    if (base[3] < 1) base = [255, 255, 255, 1];
    return chain.reverse().reduce((under, c) => over(c, under), base.length ? base : [255, 255, 255, 1]);
  };
  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.nodeValue.trim();
    if (t.length < 2) continue;
    const el = n.parentElement;
    if (!el || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'OPTION'].includes(el.tagName) || el.closest('.sr')) continue;
    if (el.closest(':disabled, [aria-disabled="true"]')) continue; // disabled controls are dimmed on purpose and exempt
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const range = document.createRange(); range.selectNodeContents(n); const tr = range.getBoundingClientRect();
    if (tr.width < 2 || tr.bottom < 0 || tr.top > innerHeight * 6) continue;
    // ignore text covered by something else (a window open on top, a scrolled-away area)
    const probe = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, tr.left + tr.width / 2)), Math.min(innerHeight - 1, Math.max(0, tr.top + tr.height / 2)));
    if (tr.top >= 0 && tr.bottom <= innerHeight && probe && !el.contains(probe) && !probe.contains(el)) continue;
    let fg = parse(cs.color); if (!fg) continue;
    const bg = bgOf(el);
    if (fg[3] < 1) fg = over(fg, bg);
    const op = (() => { let o = 1; for (let e = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity); return o; })();
    if (op < 1) fg = [fg[0] * op + bg[0] * (1 - op), fg[1] * op + bg[1] * (1 - op), fg[2] * op + bg[2] * (1 - op), 1];
    const size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const cr = ratio(fg, bg);
    const need = large ? 3 : 4.5;
    if (cr < need) {
      const tag = el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
      const key = tag + '|' + t.slice(0, 20);
      if (seen.has(key)) continue; seen.add(key);
      out.push({ tag, text: t.slice(0, 40), ratio: Math.round(cr * 100) / 100, need, fg: fg.slice(0, 3).map(Math.round).join(','), bg: bg.slice(0, 3).map(Math.round).join(',') });
    }
  }
  return out;
};

const browser = await chromium.launch({ channel: 'chrome' });
const findings = new Map();
let screens = 0;
const theme = LIGHT ? 'light' : 'dark';
for (const [role, email, routes] of ROLES) {
  const cookie = await login(email);
  await call(cookie, 'PATCH', '/me/preferences', { theme });
  for (const [label, size] of [['computer', { width: 1366, height: 860 }], ['phone', { width: 390, height: 800 }]]) {
    const ctx = await browser.newContext({ viewport: size, baseURL: WEB });
    const p = await ctx.newPage();
    await p.goto('/'); await p.fill('input[type=email]', email); await p.fill('input[type=password]', 'Reimsys#2026'); await p.click('button[type=submit]'); await p.waitForSelector('.shell');
    for (const spec of routes) {
      let [route, tab] = spec.split('|');
      if (route === '/receipt' || route === '/report') {
        await p.goto(route === '/receipt' ? '/receipts' : '/reports'); await p.waitForTimeout(900);
        const a = p.locator(route === '/receipt' ? 'a.row' : 'a[href^="/reports/"]').first();
        if (!(await a.count())) continue;
        route = await a.getAttribute('href');
      }
      await p.goto(route); await p.waitForTimeout(1100);
      if (tab) { const b = p.locator(`.tabs button:has-text("${tab}")`).first(); if (await b.count()) { await b.click(); await p.waitForTimeout(700); } }
      const items = await p.evaluate(MEASURE);
      screens++;
      const name = `${role}-${label}-${(route + (tab ? '-' + tab : '')).replace(/[^a-z0-9]+/gi, '_')}`;
      if (items.length) { for (const it of items) { const k = `${it.tag} “${it.text}” ${it.fg} on ${it.bg}`; if (!findings.has(k)) findings.set(k, { ...it, where: [] }); findings.get(k).where.push(`${role}/${label}${route}${tab ? ' ' + tab : ''}`); } }
      if (label === 'computer' || items.length) await p.screenshot({ path: path.join(OUT, name + '.png'), animations: 'disabled', timeout: 20000 }).catch((e) => console.log('  (no screenshot for ' + name + ')'));
    }
    await ctx.close();
  }
  await call(cookie, 'PATCH', '/me/preferences', { theme: 'light' });
}
await browser.close();

const list = [...findings.values()].sort((a, b) => a.ratio - b.ratio);
console.log(`${LIGHT ? 'Light' : 'Dark'} mode: ${screens} screens checked, ${list.length} kinds of low-contrast text.`);
for (const f of list.slice(0, 60)) console.log(`  ${f.ratio} (needs ${f.need})  ${f.tag}  “${f.text}”  text ${f.fg} on ${f.bg}   e.g. ${f.where[0]}${f.where.length > 1 ? ` (+${f.where.length - 1} more)` : ''}`);
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(list, null, 2));
console.log(`Screenshots and report.json in ${OUT}`);
process.exit(list.length ? 1 : 0);
