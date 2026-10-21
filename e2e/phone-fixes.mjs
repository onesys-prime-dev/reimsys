// Checks three problems seen on a real phone: the date box sticking out of the form card, the scan windows having invisible text when they open on top
// of the live camera screen, and a tall photo pushing the bottom corner dots off the screen. Needs the API (4000) and web app (5173).
// Usage: node e2e/phone-fixes.mjs [screenshot-dir]
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fillQuickForm } from './form-helpers.mjs';

const OUT = process.argv[2] ?? path.join(os.tmpdir(), 'reimsys-phone-fixes');
fs.mkdirSync(OUT, { recursive: true });
let failed = 0;
const ok = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : x); if (!c) failed++; };
const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, baseURL: process.env.WEB ?? 'http://localhost:5173', hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const p = await ctx.newPage();
p.errors = [];
p.on('pageerror', (e) => p.errors.push(String(e)));
await p.goto('/'); await p.fill('input[type=email]', 'ana.reyes@example.com'); await p.fill('input[type=password]', 'Reimsys#2026'); await p.click('button[type=submit]');
await p.waitForSelector('.shell');

console.log('The date box');
await p.goto('/receipts/new');
await p.waitForSelector('.steps');
await p.getByRole('radio', { name: /^No/ }).first().click();
await p.click('button:has-text("Next")');
await p.waitForSelector('input[type=date]');
const fit = await p.evaluate(() => {
  const card = document.querySelector('.steps ~ .card, .card');
  const cards = [...document.querySelectorAll('.card')].filter((c) => c.querySelector('input[type=date]'));
  const c = cards[0].getBoundingClientRect(), d = document.querySelector('input[type=date]').getBoundingClientRect(), t = document.querySelector('input[type=text]').getBoundingClientRect();
  return { cardRight: Math.round(c.right), dateRight: Math.round(d.right), dateLeft: Math.round(d.left), textRight: Math.round(t.right), textLeft: Math.round(t.left), overflowX: document.documentElement.scrollWidth > innerWidth + 1, hasCard: !!card };
});
ok('the date box stays inside the card', fit.dateRight <= fit.cardRight, JSON.stringify(fit));
ok('the date box is as wide as the other boxes', Math.abs(fit.dateRight - fit.textRight) <= 2 && Math.abs(fit.dateLeft - fit.textLeft) <= 2, JSON.stringify(fit));
ok('the page does not scroll sideways', !fit.overflowX);
await p.screenshot({ path: path.join(OUT, '1-date.png') });

console.log('Scan windows over the live camera screen');
const colours = await p.evaluate(() => {
  const wrap = document.createElement('div'); wrap.className = 'live-scan'; wrap.style.cssText = 'position:fixed;inset:0;z-index:999';
  wrap.innerHTML = '<div class="scrim"><div class="modal scan"><h2>Adjust page</h2><div class="btns"><button class="btn">Cancel</button><button class="btn bad">Delete page</button><button class="btn pri">Save page</button></div></div></div>';
  document.body.appendChild(wrap);
  const col = (s) => getComputedStyle(wrap.querySelector(s)).color;
  const out = { h2: col('h2'), cancel: col('.btn:not(.bad):not(.pri)'), del: col('.btn.bad'), save: col('.btn.pri') };
  wrap.remove();
  return out;
});
const isWhite = (c) => /^rgb\(255, 255, 255\)$/.test(c);
ok('the window title is not white on white', !isWhite(colours.h2), colours.h2);
ok('the Cancel button text is not white on white', !isWhite(colours.cancel), colours.cancel);
ok('Delete page is red and Save page is white on teal', !isWhite(colours.del) && isWhite(colours.save), JSON.stringify(colours));

console.log('A tall photo');
await p.goto('/receipts/new');
await fillQuickForm(p, { payee: 'Phone fix ' + Date.now().toString().slice(-6), amount: '55' });
// a tall phone photo: 1500 x 3000 with a receipt in it
const photo = Buffer.from((await p.evaluate(() => {
  const c = document.createElement('canvas'); c.width = 1500; c.height = 3000;
  const g = c.getContext('2d'); g.fillStyle = '#d8cdb8'; g.fillRect(0, 0, 1500, 3000);
  g.fillStyle = '#f4f1ea'; g.fillRect(380, 500, 760, 2200);
  g.fillStyle = '#333'; for (let i = 0; i < 40; i++) g.fillRect(450, 600 + i * 50, 600 - (i % 5) * 40, 14);
  return c.toDataURL('image/jpeg', 0.9);
})).split(',')[1], 'base64');
await p.setInputFiles('input[aria-label="Scan a receipt photo"]', { name: 'tall.jpg', mimeType: 'image/jpeg', buffer: photo });
const dlg = p.locator('.modal.scan');
await dlg.waitFor({ timeout: 8000 });
await dlg.locator('circle').first().waitFor();
await p.waitForTimeout(400);
const view = await p.evaluate(() => {
  const pts = [...document.querySelectorAll('.modal.scan circle')].map((c) => { const r = c.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; });
  const body = document.querySelector('.scan-body').getBoundingClientRect();
  const title = getComputedStyle(document.querySelector('.modal.scan h2')).color;
  return { pts, bodyTop: Math.round(body.top), bodyBottom: Math.round(body.bottom), vh: innerHeight, title };
});
ok('all four corner dots are on the screen', view.pts.length === 4 && view.pts.every((q) => q.y > 0 && q.y < view.vh && q.x > 0 && q.x < 390), JSON.stringify(view));
ok('they are inside the editor area, not hidden behind its edge', view.pts.every((q) => q.y >= view.bodyTop && q.y <= view.bodyBottom), JSON.stringify(view));
await p.screenshot({ path: path.join(OUT, '2-tall-photo.png') });

console.log('A tall picture in the preview windows');
// 1. the scan editor's "page as it will be saved" preview of the tall photo above
const prev = await p.evaluate(() => { const z = document.querySelector('.modal.scan .scanzp'); const c = z && z.querySelector('canvas'); if (!z || !c) return null; const zr = z.getBoundingClientRect(), cr = c.getBoundingClientRect(); return { fits: cr.height <= zr.height + 1 && cr.width <= zr.width + 1, box: [Math.round(zr.width), Math.round(zr.height)], canvas: [Math.round(cr.width), Math.round(cr.height)] }; });
ok('the scan editor shows the whole saved page of a tall photo, not just its top', !!prev && prev.fits, JSON.stringify(prev));
await dlg.locator('button:has-text("Use scan")').click();
await dlg.waitFor({ state: 'detached' });
// 2. the file preview (eye button) of a very tall picture
const tall = Buffer.from((await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 800; c.height = 2400; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 800, 2400); g.fillStyle = '#c00'; g.fillRect(0, 0, 800, 120); g.fillStyle = '#00c'; g.fillRect(0, 2280, 800, 120); return c.toDataURL('image/png'); })).split(',')[1], 'base64');
await p.setInputFiles('input[type=file][multiple]', { name: 'tall.png', mimeType: 'image/png', buffer: tall });
await p.waitForSelector('button[aria-label="Preview tall.png"]');
await p.click('button[aria-label="Preview tall.png"]');
await p.waitForSelector('.zp.pvz img');
await p.waitForFunction(() => { const i = document.querySelector('.zp.pvz img'); return i && i.complete && i.naturalWidth > 0; });
await p.waitForTimeout(300);
const pv = await p.evaluate(() => { const z = document.querySelector('.zp.pvz').getBoundingClientRect(), i = document.querySelector('.zp.pvz img').getBoundingClientRect(); return { fits: i.height <= z.height + 1 && i.width <= z.width + 1, box: [Math.round(z.width), Math.round(z.height)], img: [Math.round(i.width), Math.round(i.height)] }; });
ok('the file preview shows a very tall picture whole (top and bottom both in view)', pv.fits, JSON.stringify(pv));
ok('no errors in the browser', p.errors.length === 0, p.errors.join(' | '));
await b.close();
console.log(failed ? `\n${failed} FAILED` : `\nAll checks passed. Screenshots in ${OUT}`);
process.exit(failed ? 1 : 0);
