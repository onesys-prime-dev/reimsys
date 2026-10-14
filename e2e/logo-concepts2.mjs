// Second round of logo concepts, built from the name. node e2e/logo-concepts2.mjs <out-dir>
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const GRAD = '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#14909d"/><stop offset="1" stop-color="#095964"/></linearGradient></defs>';
const SQUARE = '<rect width="64" height="64" rx="16" fill="url(#g)"/>';
const FOLDED = '<path d="M16 0 H50 L64 14 V48 Q64 64 48 64 H16 Q0 64 0 48 V16 Q0 0 16 0 Z" fill="url(#g)"/><path d="M50 0 V10 Q50 14 54 14 H64 Z" fill="#fff" fill-opacity=".28"/>';
const MINT = '#9ff0d4';

const concepts = {
  'D1. Fork Y on a folded tile': `${GRAD}${FOLDED}
    <g fill="none" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
      <path d="M45 16.5 L30 38" stroke="${MINT}"/><path d="M17 22 L30 38 L30 51" stroke="#fff"/></g>`,
  'D2. Fork Y, plain tile': `${GRAD}${SQUARE}
    <g fill="none" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
      <path d="M46 15 L32 37" stroke="${MINT}"/><path d="M18 15 L32 37 L32 51" stroke="#fff"/></g>`,
  'D3. Capsule with a torn receipt edge': `${GRAD}${SQUARE}
    <g transform="rotate(45 32 32)">
      <path d="M21 21 A11 11 0 0 1 43 21 V32 L37.5 29.5 L32 32 L26.5 29.5 L21 32 Z" fill="#fff"/>
      <path d="M21 32 L26.5 29.5 L32 32 L37.5 29.5 L43 32 V43 A11 11 0 0 1 21 43 Z" fill="${MINT}"/></g>`,
};

const cell = (svg, n) => `<svg xmlns="http://www.w3.org/2000/svg" width="${n}" height="${n}" viewBox="0 0 64 64">${svg}</svg>`;
const row = (label, svg, bg, fg) => `<div style="display:flex;align-items:flex-end;gap:22px;padding:16px 22px;background:${bg};color:${fg}">
  <div style="width:170px;font:600 13px Arial;align-self:center">${label}</div>
  ${[112, 56, 32, 20, 16].map((n) => `<div style="text-align:center">${cell(svg, n)}<div style="font:11px Arial;opacity:.6;margin-top:5px">${n}px</div></div>`).join('')}</div>`;

const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport: { width: 760, height: 700 }, deviceScaleFactor: 1.5 });
const rows = [
  ...Object.entries(concepts).map(([k, s]) => row(k, s, '#ffffff', '#12232b')),
  ...Object.entries(concepts).map(([k, s]) => row(k, s, '#0c1519', '#e6eef0')),
];
await p.setContent(`<body style="margin:0;font-family:Arial">${rows.join('')}</body>`);
await p.screenshot({ path: path.join(out, 'concepts2.png'), fullPage: true });
await b.close();
console.log('wrote concepts2.png');
