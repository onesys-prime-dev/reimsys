// Checks that a receipt photo can be looked at closely and moved around, and that a WHITE receipt on a light desk is outlined by itself.
// Needs the API (4000) and web app (5173). Usage: node e2e/zoom-ui.mjs [screenshot-dir]
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fillQuickForm } from './form-helpers.mjs';

const OUT = process.argv[2] ?? path.join(os.tmpdir(), 'reimsys-zoom-shots');
fs.mkdirSync(OUT, { recursive: true });
let failed = 0;
const ok = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : x); if (!c) failed++; };

const b = await chromium.launch({ channel: 'chrome' });
const open = async (size) => {
  const p = await (await b.newContext({ viewport: size, baseURL: process.env.WEB ?? 'http://localhost:5173' })).newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  p.on('console', (m) => m.type() === 'error' && !/40[0-9]|Failed to load resource/.test(m.text()) && p.errors.push(m.text()));
  await p.goto('/'); await p.fill('input[type=email]', 'ana.reyes@example.com'); await p.fill('input[type=password]', 'Reimsys#2026'); await p.click('button[type=submit]');
  await p.waitForSelector('.shell');
  return p;
};
const tf = (p) => p.locator('.zp-in').evaluate((e) => { const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/.exec(e.style.transform); return { x: Number(m[1]), y: Number(m[2]), s: Number(m[3]) }; });

// A receipt photo: a white receipt with print on a slightly darker white desk (the hard case), 1200 x 900.
const TRUTH = [[330, 130], [820, 160], [790, 800], [300, 770]];
const makePhoto = (p, deskGrey, paperGrey) => p.evaluate(([t, desk, paper]) => {
  const c = document.createElement('canvas'); c.width = 1200; c.height = 900;
  const g = c.getContext('2d'); g.fillStyle = `rgb(${desk},${desk},${desk})`; g.fillRect(0, 0, 1200, 900);
  g.fillStyle = `rgb(${paper},${paper},${paper})`; g.beginPath(); g.moveTo(...t[0]); for (const q of t.slice(1)) g.lineTo(...q); g.closePath(); g.fill();
  g.fillStyle = '#444'; for (let i = 0; i < 16; i++) g.fillRect(380 + i * 4, 220 + i * 32, 330 - i * 6, 7);
  return c.toDataURL('image/jpeg', 0.92);
}, [TRUTH, deskGrey, paperGrey]).then((u) => Buffer.from(u.split(',')[1], 'base64'));

for (const [label, size] of [['computer', { width: 1280, height: 860 }], ['phone', { width: 390, height: 780 }]]) {
  console.log('\n' + label);
  const p = await open(size);
  await p.goto('/receipts/new');
  await fillQuickForm(p, { payee: 'Zoom test ' + Date.now().toString().slice(-6), amount: '77' });

  /* a white receipt on a light desk is outlined by itself */
  await p.setInputFiles('input[aria-label="Scan a receipt photo"]', { name: 'white.jpg', mimeType: 'image/jpeg', buffer: await makePhoto(p, 226, 237) });
  const dlg = p.locator('.modal.scan');
  await dlg.waitFor({ timeout: 8000 });
  await dlg.locator('circle').first().waitFor();
  const corners = await dlg.locator('circle').evaluateAll((els) => els.map((e) => [Number(e.getAttribute('cx')), Number(e.getAttribute('cy'))]));
  const worst = Math.max(...corners.map(([x, y], i) => Math.hypot(x - TRUTH[i][0], y - TRUTH[i][1])));
  ok(`a white receipt on a light desk is outlined (worst corner ${Math.round(worst)} px off)`, corners.length === 4 && worst < 45, JSON.stringify(corners));
  await p.screenshot({ path: path.join(OUT, `${label}-1-scan-white.png`) });

  /* the page preview inside the scan editor can be zoomed and moved */
  const out = dlg.locator('.scanzp');
  ok('the scanned page preview can be zoomed and moved', await out.count() === 1);
  const box = await out.boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.wheel(0, -500);
  await p.waitForTimeout(150);
  const z1 = await dlg.locator('.scanzp .zp-in').evaluate((e) => Number(/scale\(([\d.]+)\)/.exec(e.style.transform)[1]));
  ok('the wheel zooms the scanned page', z1 > 1.5, String(z1));
  await dlg.locator('button:has-text("Use scan")').click();
  await dlg.waitFor({ state: 'detached' });

  /* the preview opened from the file list */
  const eye = p.locator('button[aria-label^="Preview scan-"]').first();
  ok('the scanned file has a preview button', (await eye.count()) === 1);
  await eye.click();
  await p.waitForSelector('.zp.pvz img');
  await p.waitForFunction(() => { const i = document.querySelector('.zp.pvz img'); return i && i.complete && i.naturalWidth > 0; });
  const zp = p.locator('.zp.pvz');
  const bb = await zp.boundingBox();
  ok('the preview starts showing the whole picture', (await tf(p)).s === 1);
  ok('Zoom out and Fit are off until you zoom in', await p.locator('.zp-bar button[aria-label="Zoom out"]').isDisabled() && await p.locator('.zp-bar button[aria-label="Fit the whole picture"]').isDisabled());
  await p.click('.zp-bar button[aria-label="Zoom in"]');
  const a = await tf(p);
  ok('the + button zooms in', a.s > 1.3, JSON.stringify(a));
  await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await p.mouse.wheel(0, -700);
  await p.waitForTimeout(150);
  const c1 = await tf(p);
  ok('the mouse wheel zooms further', c1.s > a.s, JSON.stringify(c1));
  await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await p.mouse.down();
  await p.mouse.move(bb.x + bb.width / 2 + 60, bb.y + bb.height / 2 + 40, { steps: 6 });
  await p.mouse.up();
  const c2 = await tf(p);
  ok('dragging moves the picture', Math.abs(c2.x - c1.x) > 20 || Math.abs(c2.y - c1.y) > 20, JSON.stringify([c1, c2]));
  ok('it cannot be dragged out of sight', c2.x <= 0 && c2.y <= 0);
  await p.screenshot({ path: path.join(OUT, `${label}-2-zoomed.png`) });
  await p.click('.zp-bar button[aria-label="Fit the whole picture"]');
  const f = await tf(p);
  ok('Fit brings the whole picture back', f.s === 1 && f.x === 0 && f.y === 0, JSON.stringify(f));
  await p.mouse.dblclick(bb.x + bb.width / 2, bb.y + bb.height / 2);
  ok('double-click zooms in', (await tf(p)).s > 2);
  await p.mouse.dblclick(bb.x + bb.width / 2, bb.y + bb.height / 2);
  ok('double-click again goes back', (await tf(p)).s === 1);
  await p.keyboard.press('Escape');
  ok('Escape closes the preview', (await p.locator('.zp.pvz').count()) === 0);
  ok('no errors in the browser', p.errors.length === 0, p.errors.join(' | '));
  await p.context().close();
}
await b.close();
console.log(failed ? `\n${failed} FAILED` : `\nAll checks passed. Screenshots in ${OUT}`);
process.exit(failed ? 1 : 0);
