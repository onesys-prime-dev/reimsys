// Screenshots of the logo: a size sheet (tab icon size up to large) and the real pages.
// Usage: node e2e/logo-shots.mjs <dir>
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
const svg = fs.readFileSync('apps/web/public/favicon.svg', 'utf8');
const at = (n) => svg.replace('<svg ', `<svg width="${n}" height="${n}" `);

const b = await chromium.launch({ channel: 'chrome' });

// size sheet
const sheet = await b.newPage({ viewport: { width: 760, height: 330 }, deviceScaleFactor: 2 });
const row = (bg, fg) => `<div style="background:${bg};color:${fg};padding:22px 26px;display:flex;align-items:flex-end;gap:26px;font:12px Arial">${[16, 24, 32, 48, 72, 112].map((n) => `<div style="text-align:center">${at(n)}<div style="margin-top:6px;opacity:.7">${n}px</div></div>`).join('')}</div>`;
await sheet.setContent(`<body style="margin:0">${row('#ffffff', '#12232b')}${row('#0c1519', '#e6eef0')}</body>`);
await sheet.screenshot({ path: path.join(out, 'sizes.png') });

// real pages
const ctx = await b.newContext({ baseURL: 'http://localhost:4000', viewport: { width: 1280, height: 760 } });
const p = await ctx.newPage();
await p.goto('/'); await p.waitForSelector('.lcard');
await p.screenshot({ path: path.join(out, 'login.png') });
await p.fill('input[type=email]', 'admin@example.com'); await p.fill('input[type=password]', 'Reimsis#2026'); await p.click('button[type=submit]');
await p.waitForSelector('.shell');
await p.screenshot({ path: path.join(out, 'app.png'), clip: { x: 0, y: 0, width: 640, height: 300 } });
await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
await p.screenshot({ path: path.join(out, 'app-dark.png'), clip: { x: 0, y: 0, width: 640, height: 300 } });

// the browser tab icon and phone home-screen files really load
const res = {};
for (const f of ['/favicon.svg', '/favicon-32.png', '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest']) {
  const r = await p.evaluate(async (u) => { const x = await fetch(u); return [x.status, x.headers.get('content-type')]; }, f);
  res[f] = r.join(' ');
}
console.log(res);
const manifest = await p.evaluate(async () => (await fetch('/manifest.webmanifest')).json());
console.log('manifest name:', manifest.name, '| theme:', manifest.theme_color, '| icons:', manifest.icons.length);
const head = await p.evaluate(() => [...document.querySelectorAll('link[rel~=icon],link[rel=manifest],link[rel=apple-touch-icon],meta[name=theme-color]')].map((e) => e.outerHTML.slice(0, 90)));
console.log(head.join('\n'));

// phone
const m = await b.newPage({ viewport: { width: 390, height: 640 }, deviceScaleFactor: 2 });
await m.goto('http://localhost:4000/'); await m.waitForSelector('.lcard');
await m.screenshot({ path: path.join(out, 'login-phone.png') });
await b.close();
