// On a phone, the "Adjust page" window must not trap a swipe: starting on the photo with the corner dots, or on the saved-page preview, a swipe
// still scrolls the window (it used to be almost impossible to scroll back up). The corner dots, a pinch, and a zoomed-in picture keep their touch.
// Uses real touch events. Needs the API (4000) and web app (5173). Usage: node e2e/scan-scroll.mjs
import { chromium } from 'playwright';
import { fillQuickForm } from './form-helpers.mjs';
let failed = 0;
const ok = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : x); if (!c) failed++; };
const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, baseURL: process.env.WEB ?? 'http://localhost:5173', hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
await p.goto('/'); await p.fill('input[type=email]', 'ana.reyes@example.com'); await p.fill('input[type=password]', 'Reimsys#2026'); await p.click('button[type=submit]'); await p.waitForSelector('.shell');
await p.goto('/receipts/new'); await fillQuickForm(p, { payee: 'Scan scroll ' + Date.now().toString().slice(-6), amount: '5' });
const photo = Buffer.from((await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 1200; c.height = 1600; const g = c.getContext('2d'); g.fillStyle = '#202428'; g.fillRect(0, 0, 1200, 1600); g.fillStyle = '#ebebe6'; g.fillRect(250, 250, 700, 1100); g.fillStyle = '#222'; for (let i = 0; i < 20; i++) g.fillRect(300, 320 + i * 45, 500, 10); return c.toDataURL('image/jpeg', 0.9); })).split(',')[1], 'base64');
await p.setInputFiles('input[aria-label="Scan a receipt photo"]', { name: 'a.jpg', mimeType: 'image/jpeg', buffer: photo });
await p.waitForSelector('.modal.scan circle'); await p.waitForTimeout(500);

const cdp = await ctx.newCDPSession(p);
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
const swipe = async (x, y, dy) => { await touch('touchStart', [[x, y]]); for (let i = 1; i <= 12; i++) { await touch('touchMove', [[x, y + (dy * i) / 12]]); await p.waitForTimeout(16); } await touch('touchEnd', []); await p.waitForTimeout(500); };
const top = () => p.locator('.scan-body').evaluate((e) => Math.round(e.scrollTop));
const setTop = (v) => p.locator('.scan-body').evaluate((e, t) => { e.scrollTop = t === 'end' ? e.scrollHeight : t; }, v);
const centre = async (sel) => { await p.locator(sel).first().scrollIntoViewIfNeeded(); const r = await p.locator(sel).first().boundingBox(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; };

ok('the editor has room to scroll', (await p.locator('.scan-body').evaluate((e) => e.scrollHeight - e.clientHeight)) > 100);

console.log('\nA swipe scrolls the window from anywhere');
await setTop('end');
let pv = await centre('.scanzp'); let t0 = await top(); await swipe(pv.x, pv.y, 250); let t1 = await top();
ok(`scrolling back UP by swiping on the saved-page preview works (${t0} -> ${t1})`, t1 < t0 - 100);
await setTop(0);
const ph = await centre('.scan-photo canvas'); t0 = await top(); await swipe(ph.x, ph.y - 100, -250); t1 = await top();
ok(`scrolling DOWN by swiping on the photo works (${t0} -> ${t1})`, t1 > t0 + 100);
await setTop('end');
const seg = await centre('.modal.scan .seg'); t0 = await top(); await swipe(seg.x, seg.y, 250); t1 = await top();
ok(`and from the buttons, as before (${t0} -> ${t1})`, t1 < t0 - 100);

console.log('\nWhat needs touch still gets it');
await setTop(0);
const dot0 = await p.locator('.scan-photo circle').first().evaluate((c) => [Number(c.getAttribute('cx')), Number(c.getAttribute('cy'))]);
const dc = await centre('.scan-photo circle'); t0 = await top();
await swipe(dc.x, dc.y, 40);
const dot1 = await p.locator('.scan-photo circle').first().evaluate((c) => [Number(c.getAttribute('cx')), Number(c.getAttribute('cy'))]);
ok(`dragging a corner dot moves the dot (${dot0.map(Math.round)} -> ${dot1.map(Math.round)})`, Math.hypot(dot1[0] - dot0[0], dot1[1] - dot0[1]) > 10);
ok('and does not scroll the window at the same time', Math.abs((await top()) - t0) < 8, `${t0} -> ${await top()}`);

await setTop('end');
pv = await centre('.scanzp');
const scale = () => p.locator('.scanzp .zp-in').evaluate((e) => Number(/scale\(([\d.]+)\)/.exec(e.style.transform)[1]));
await touch('touchStart', [[pv.x - 20, pv.y], [pv.x + 20, pv.y]]);
for (let i = 1; i <= 10; i++) { await touch('touchMove', [[pv.x - 20 - i * 8, pv.y], [pv.x + 20 + i * 8, pv.y]]); await p.waitForTimeout(16); }
await touch('touchEnd', []); await p.waitForTimeout(300);
const z = await scale();
ok(`pinching the preview zooms it (scale ${z})`, z > 1.5);
ok('once zoomed in, it is marked so a one-finger drag moves the picture', await p.locator('.scanzp.zoomed').count() === 1);
const tz = await top(); const x0 = await p.locator('.scanzp .zp-in').evaluate((e) => e.style.transform);
await swipe(pv.x, pv.y, 60); // a drag on a zoomed picture pans it
ok('a drag on the zoomed picture moves the picture, not the window', (await p.locator('.scanzp .zp-in').evaluate((e) => e.style.transform)) !== x0 && Math.abs((await top()) - tz) < 8);
await p.click('.scanzp button:has-text("Fit")'); await p.waitForTimeout(200);
t0 = await top(); pv = await centre('.scanzp'); await swipe(pv.x, pv.y, 250); t1 = await top();
ok(`after Fit a swipe on the preview scrolls the window again (${t0} -> ${t1})`, t1 < t0 - 100);
ok('no errors in the browser', errors.length === 0, errors.join(' | '));
await b.close();
console.log(failed ? `\n${failed} FAILED` : '\nThe adjust window can always be scrolled on a phone.');
process.exit(failed ? 1 : 0);
