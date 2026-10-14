// Draws the logo into the PNG icons used when someone adds REIMSIS to a phone's home screen.
// Run again if the logo in packages/shared/src/brand.ts changes:  node e2e/make-icons.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const pub = path.resolve('apps/web/public');
const svg = fs.readFileSync(path.join(pub, 'favicon.svg'), 'utf8');
// Phone icon masks round the corners themselves, so those icons are full-bleed squares.
const full = svg.replace('rx="16"', 'rx="0"');

const b = await chromium.launch({ channel: 'chrome' });
for (const [file, size, markup] of [
  ['apple-touch-icon.png', 180, full],
  ['icon-192.png', 192, full],
  ['icon-512.png', 512, full],
  ['favicon-32.png', 32, svg],
]) {
  const p = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await p.setContent(`<html><body style="margin:0;background:transparent">${markup.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await p.screenshot({ path: path.join(pub, file), omitBackground: true });
  await p.close();
  console.log('wrote', file);
}
await b.close();

fs.writeFileSync(path.join(pub, 'manifest.webmanifest'), JSON.stringify({
  name: 'REIMSIS',
  short_name: 'REIMSIS',
  description: 'Reimbursement management',
  start_url: '/',
  display: 'standalone',
  background_color: '#f9fbfb',
  theme_color: '#0c7480',
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
  ],
}, null, 2) + '\n');
console.log('wrote manifest.webmanifest');
