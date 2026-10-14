// Draws logo concepts side by side so they can be compared at real sizes. node e2e/logo-concepts.mjs <out-dir>
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const GRAD = '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#14909d"/><stop offset="1" stop-color="#095964"/></linearGradient></defs><rect width="64" height="64" rx="16" fill="url(#g)"/>';
const RING = (r, w) => `<path d="M${32 + r * Math.cos((-20 * Math.PI) / 180)} ${32 + r * Math.sin((-20 * Math.PI) / 180)} A${r} ${r} 0 1 1 ${32 + r * Math.cos((-80 * Math.PI) / 180)} ${32 + r * Math.sin((-80 * Math.PI) / 180)}" fill="none" stroke="#fff" stroke-width="${w}" stroke-linecap="round"/>`;
const HEAD = '<polygon points="41.6,16.5 32.2,21.4 34.4,8.6" fill="#fff" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/>';

const concepts = {
  'A. Peso loop': `${GRAD}${RING(17.5, 5)}${HEAD}
    <g fill="none" stroke="#fff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M29 41 V23.5 H33.6 a5 5 0 0 1 0 10 H29"/><path d="M25 28.2 H37.5 M25 32 H37.5"/></g>`,
  'B. Receipt and return badge': `${GRAD}
    <g transform="translate(-4 -4) scale(0.92)"><path d="M18.56 8.6 H45.44 Q47.68 8.6 47.68 10.84 V52.28 L43.76 48.36 L39.84 52.28 L35.92 48.36 L32 52.28 L28.08 48.36 L24.16 52.28 L20.24 48.36 L16.32 52.28 V10.84 Q16.32 8.6 18.56 8.6 Z" fill="#fff" transform="translate(6 6)"/>
    <line x1="29" y1="27" x2="45" y2="27" stroke="#0c7480" stroke-opacity=".4" stroke-width="2.6" stroke-linecap="round"/><line x1="29" y1="33" x2="45" y2="33" stroke="#0c7480" stroke-opacity=".4" stroke-width="2.6" stroke-linecap="round"/><line x1="29" y1="39" x2="38" y2="39" stroke="#0c7480" stroke-opacity=".4" stroke-width="2.6" stroke-linecap="round"/></g>
    <circle cx="45.5" cy="45.5" r="13.5" fill="#f5a524" stroke="#0e7886" stroke-width="3"/>
    <g transform="translate(45.5 45.5) scale(0.42) translate(-32 -32)">${RING(15, 6.5)}${HEAD.replace('stroke-width="1.4"', 'stroke-width="2"')}</g>`,
  'C. Loop and check': `${GRAD}${RING(17.5, 5)}${HEAD}
    <polyline points="24.5,32.5 30,38 40,26.5" fill="none" stroke="#fff" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round"/>`,
};

const user = fs.readFileSync('C:/Users/Stanley/Desktop/REIMSIS SYSTEM PLAN/fabicon.svg');
const userImg = `<img width="@" height="@" src="data:image/svg+xml;base64,${user.toString('base64')}" style="border-radius:22%;background:#fff">`;

const cell = (svg, n) => `<svg xmlns="http://www.w3.org/2000/svg" width="${n}" height="${n}" viewBox="0 0 64 64">${svg}</svg>`;
const row = (label, make, bg, fg) => `<div style="display:flex;align-items:flex-end;gap:22px;padding:16px 22px;background:${bg};color:${fg}">
  <div style="width:150px;font:600 13px Arial;align-self:center">${label}</div>
  ${[112, 56, 32, 20].map((n) => `<div style="text-align:center">${make(n)}<div style="font:11px Arial;opacity:.6;margin-top:5px">${n}px</div></div>`).join('')}</div>`;

const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport: { width: 760, height: 780 }, deviceScaleFactor: 1.5 });
const rows = [
  row('Your design (for reference)', (n) => userImg.replaceAll('@', String(n)), '#f4f7f8', '#12232b'),
  ...Object.entries(concepts).map(([k, s]) => row(k, (n) => cell(s, n), '#ffffff', '#12232b')),
  ...Object.entries(concepts).map(([k, s]) => row(k + ' (dark)', (n) => cell(s, n), '#0c1519', '#e6eef0')),
];
await p.setContent(`<body style="margin:0;font-family:Arial">${rows.join('')}</body>`);
await p.screenshot({ path: path.join(out, 'concepts.png'), fullPage: true });
await b.close();
console.log('wrote concepts.png');
