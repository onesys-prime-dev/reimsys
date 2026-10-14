// Writes a ready-to-use logo kit: the icon (SVG and PNG) and the icon with the name (light and dark).
// Usage: node e2e/export-logo-kit.mjs <folder>
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
const svg = fs.readFileSync('apps/web/public/favicon.svg', 'utf8');
fs.writeFileSync(path.join(out, 'REIMSYS logo.svg'), svg);

const mark = (n) => svg.replace('<svg ', `<svg width="${n}" height="${n}" `);
const lockup = (bg, fg, pad, accent) => `<html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700&display=swap"></head>
<body style="margin:0;background:${bg}"><div id="l" style="display:inline-flex;align-items:center;gap:26px;padding:${pad}px ${pad * 1.4}px;background:${bg}">${mark(160)}
<span style="font:700 112px 'Bricolage Grotesque',Arial,sans-serif;letter-spacing:.03em;color:${fg}">REIMS<span style="color:${accent}">Y</span>S</span></div></body></html>`;

const b = await chromium.launch({ channel: 'chrome' });
const png = async (name, html, sel, transparent) => {
  const p = await b.newPage({ viewport: { width: 1400, height: 500 }, deviceScaleFactor: 1 });
  await p.setContent(html);
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(600);
  await (sel ? p.locator(sel) : p).screenshot({ path: path.join(out, name), omitBackground: transparent });
  await p.close();
  console.log('wrote', name);
};
await png('REIMSYS logo 512.png', `<body style="margin:0;background:transparent">${mark(512)}</body>`, 'svg', true);
await png('REIMSYS logo with name.png', lockup('#ffffff', '#12232b', 40, '#0c7480'), '#l', false);
await png('REIMSYS logo with name (dark background).png', lockup('#0c1519', '#e6eef0', 40, '#4fc0cc'), '#l', false);
await b.close();
