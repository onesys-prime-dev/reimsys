// Changes a profile photo twice with a big picture (a 3000 x 2000 BMP, about 18 MB) and checks that it is shrunk and accepted, and that the
// sidebar, top bar and profile avatars all show the new picture straight away. Needs the API (4000) and web app (5173).
// Usage: node e2e/profile-photo.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const W = 3000, H = 2000;
const bmp = (r, g, b) => {
  const row = W * 3, size = 54 + row * H, buf = Buffer.alloc(size);
  buf.write('BM', 0); buf.writeUInt32LE(size, 2); buf.writeUInt32LE(54, 10); buf.writeUInt32LE(40, 14); buf.writeInt32LE(W, 18); buf.writeInt32LE(H, 22);
  buf.writeUInt16LE(1, 26); buf.writeUInt16LE(24, 28); buf.writeUInt32LE(row * H, 34);
  for (let i = 54; i < size; i += 3) { buf[i] = b; buf[i + 1] = g; buf[i + 2] = r; }
  return buf;
};
let failed = 0;
const ok = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : x); if (!c) failed++; };
const browser = await chromium.launch({ channel: 'chrome' });
const p = await (await browser.newContext({ viewport: { width: 1280, height: 860 }, baseURL: process.env.WEB ?? 'http://localhost:5173' })).newPage();
const avatars = path.resolve('apps/api/storage/avatars');
const newestKB = () => { const f = fs.readdirSync(avatars).filter((n) => n.startsWith('2-')).map((n) => ({ n, t: fs.statSync(path.join(avatars, n)).mtimeMs, s: fs.statSync(path.join(avatars, n)).size })).sort((a, b) => b.t - a.t)[0]; return f ? Math.round(f.s / 1024) : -1; };
await p.goto('/'); await p.fill('input[type=email]', 'mark.dc@example.com'); await p.fill('input[type=password]', 'Reimsys#2026'); await p.click('button[type=submit]'); await p.waitForSelector('.shell');
await p.goto('/profile'); await p.waitForSelector('button:has-text("Change photo")');
const avatarInfo = () => p.evaluate(async () => {
  const imgs = [...document.querySelectorAll('img.av')];
  const out = [];
  for (const i of imgs) { await i.decode().catch(() => {}); const c = document.createElement('canvas'); c.width = c.height = 4; const x = c.getContext('2d'); x.drawImage(i, 0, 0, 4, 4); const d = x.getImageData(1, 1, 1, 1).data; out.push({ src: i.getAttribute('src'), rgb: [d[0], d[1], d[2]] }); }
  return out;
});
for (const [label, rgb] of [['red', [220, 40, 40]], ['blue', [40, 60, 220]]]) {
  await p.setInputFiles('input[type=file]', { name: `big-${label}.bmp`, mimeType: 'image/bmp', buffer: bmp(...rgb) });
  await p.waitForSelector('text=Photo updated.', { timeout: 30000 });
  await p.waitForTimeout(600);
  const av = await avatarInfo();
  const kb = newestKB();
  ok(`${label}: the picture was shrunk before sending (saved file ${kb} KB; the original was about 17,000 KB)`, kb > 0 && kb < 400);
  ok(`${label}: sidebar, top bar and profile all show a picture (${av.length} avatars)`, av.length >= 3);
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 40);
  ok(`${label}: every avatar shows the NEW colour right away`, av.length >= 3 && av.every((a) => near(a.rgb, rgb)), JSON.stringify(av));
}
await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nPhoto change works everywhere.');
process.exit(failed ? 1 : 0);
