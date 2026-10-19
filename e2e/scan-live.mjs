// The live "Scan receipt" camera, tested with a pretend camera (Chrome plays a clip of a receipt). Needs the API (4000) and web app (5173).
// Usage: node e2e/scan-live.mjs [screenshot-dir]
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fillQuickForm } from './form-helpers.mjs';

// Absolute, because Chrome is started from another folder and must find the clip.
const OUT = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'reimsys-live-shots'));
fs.mkdirSync(OUT, { recursive: true });
let failed = 0;
const ok = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : x); if (!c) failed++; };

/** The pretend camera: a clip of a tilted receipt on a dark table, as a motion-JPEG file Chrome can play as a webcam. */
async function makeClip(browser, name = 'receipt-clip', look = { table: '#1d2226', paper: '#ecece6', shadow: false }) {
  const p = await browser.newPage();
  const b64 = await p.evaluate((look) => {
    const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
    const g = c.getContext('2d'); g.fillStyle = look.table; g.fillRect(0, 0, 1280, 720);
    const [a, b, cc, d] = look.corners ?? [[430, 70], [880, 110], [850, 650], [400, 610]];
    g.fillStyle = look.paper; g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.lineTo(...cc); g.lineTo(...d); g.closePath(); g.fill();
    if (!look.corners) { g.fillStyle = '#2a2a2a'; for (let i = 0; i < 14; i++) g.fillRect(480 + i * 2, 170 + i * 30, 300 - i * 4, 8); }
    if (look.shadow) { const s = g.createLinearGradient(0, 0, 1280, 0); s.addColorStop(0, 'rgba(0,0,0,0)'); s.addColorStop(1, 'rgba(0,0,0,.35)'); g.fillStyle = s; g.fillRect(0, 0, 1280, 720); }
    return c.toDataURL('image/jpeg', 0.85).split(',')[1];
  }, look);
  await p.close();
  const file = path.join(OUT, name + '.mjpeg');
  fs.writeFileSync(file, Buffer.concat(Array.from({ length: 30 }, () => Buffer.from(b64, 'base64'))));
  return file;
}

const tmp = await chromium.launch({ channel: 'chrome' });
const clip = await makeClip(tmp);
const lightClip = await makeClip(tmp, 'light-desk-clip', { table: '#d6d2c8', paper: '#f3f2ec', shadow: true });
// A long narrow shop receipt seen from further away, in a wide picture: it fills under a tenth of the frame.
const NARROW = [[575, 60], [715, 66], [705, 660], [565, 654]];
const narrowClip = await makeClip(tmp, 'narrow-clip', { table: '#3a3f44', paper: '#efefe9', shadow: false, corners: NARROW });
// A white receipt on a white desk: barely lighter than the desk.
const FAINT = [[440, 90], [860, 120], [835, 640], [415, 615]];
const faintClip = await makeClip(tmp, 'faint-clip', { table: '#dededa', paper: '#e9e9e5', shadow: false, corners: FAINT });
await tmp.close();

const b = await chromium.launch({ channel: 'chrome', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${clip}`] });
async function open(size = { width: 1280, height: 860 }, init) {
  const ctx = await b.newContext({ viewport: size, baseURL: process.env.WEB ?? 'http://localhost:5173', permissions: ['camera'] });
  if (init) await ctx.addInitScript(init);
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  p.on('console', (m) => m.type() === 'error' && !/40[0-9]/.test(m.text()) && p.errors.push(m.text()));
  await p.goto('/'); await p.fill('input[type=email]', 'ana.reyes@example.com'); await p.fill('input[type=password]', 'Reimsys#2026'); await p.click('button[type=submit]');
  await p.waitForSelector('.shell');
  await p.goto('/receipts/new');
  await fillQuickForm(p, { payee: 'Live scan ' + Date.now().toString().slice(-6), amount: '31' });
  return p;
}

const p = await open();
console.log('The live camera');
await p.getByRole('button', { name: 'Scan receipt' }).click();
const live = p.locator('.live-scan');
await live.waitFor({ timeout: 8000 });
await live.locator('video').evaluate((v) => new Promise((r) => (v.videoWidth ? r() : v.addEventListener('loadeddata', () => r(), { once: true }))));
ok('the live camera opens with the camera picture', await live.locator('video').evaluate((v) => v.videoWidth > 0 && !v.paused));
const poly = live.locator('polygon.live-poly');
await poly.waitFor({ timeout: 8000 });
ok('it draws an outline around the receipt', (await poly.getAttribute('points'))?.split(' ').length === 4);
await p.waitForTimeout(500);
ok('it says the receipt is found and to press the button', /Receipt found\. Press the button/.test(await live.locator('.live-hint').innerText()), await live.locator('.live-hint').innerText());
ok('the outline turns green once the receipt is found', await poly.evaluate((e) => e.classList.contains('steady')));
ok('there is no auto-capture switch', (await live.getByRole('button', { name: 'Auto capture' }).count()) === 0);
await p.screenshot({ path: path.join(OUT, 'live-1-outline.png') });
// watch for the page freezing while the camera looks for the receipt
await p.evaluate(() => { window.__long = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: false }); });
await p.waitForTimeout(4000);
ok('nothing is taken by itself, even with the receipt held still for 4 seconds', (await live.getByRole('button', { name: /^Page \d/ }).count()) === 0);
const longs = await p.evaluate(() => window.__long);
ok('looking for the receipt never freezes the page (no task over 100 ms)', longs.every((d) => d <= 100), JSON.stringify(longs));
const t0 = Date.now();
await live.getByRole('button', { name: 'Take picture' }).click();
await live.getByRole('button', { name: 'Page 1' }).waitFor();
const took = Date.now() - t0;
ok('the shutter takes the page at once (under 700 ms to the thumbnail)', took < 700, took + ' ms');
ok('and offers Done with the page count', await live.getByRole('button', { name: 'Done (1)' }).isVisible());
await p.screenshot({ path: path.join(OUT, 'live-2-first-page.png') });
await p.waitForTimeout(400);
await live.getByRole('button', { name: 'Take picture' }).click();
await live.getByRole('button', { name: 'Page 2' }).waitFor();
ok('the shutter button takes another page', await live.getByRole('button', { name: 'Done (2)' }).isVisible());

await live.getByRole('button', { name: 'Page 1' }).click();
const ed = p.locator('.modal.scan');
await ed.waitFor();
ok('tapping a page opens it to adjust, with its corners found', (await ed.locator('circle').count()) === 4 && /Adjust page/.test(await ed.locator('h2').innerText()));
await ed.getByRole('radio', { name: 'Black & white' }).click();
await ed.locator('button:has-text("Save page")').click();
await ed.waitFor({ state: 'detached' });
ok('saving goes back to the camera and keeps the page', (await live.getByRole('button', { name: /^Page \d/ }).count()) === 2);

await live.getByRole('button', { name: 'Page 2' }).click();
await ed.waitFor();
await ed.locator('button:has-text("Delete page")').click();
await ed.waitFor({ state: 'detached' });
ok('a page can be deleted', (await live.getByRole('button', { name: /^Page \d/ }).count()) === 1 && await live.getByRole('button', { name: 'Done (1)' }).isVisible());

await live.getByRole('button', { name: 'Done (1)' }).click();
await live.waitFor({ state: 'detached' });
const row = p.locator('.file', { hasText: 'scan-' });
await row.first().waitFor({ timeout: 8000 }).catch(() => undefined); // the page is turned into a JPEG for a moment after Done
ok('Done adds the page to the receipt as a JPEG', (await row.count()) === 1 && /scan-.*\.jpg/.test(await row.innerText()));
const stopped = await p.evaluate(() => !document.querySelector('video'));
ok('the camera is switched off afterwards', stopped);

console.log('Closing without keeping anything');
await p.getByRole('button', { name: 'Scan receipt' }).click();
await live.waitFor();
await live.locator('polygon.live-poly').waitFor({ timeout: 8000 });
await live.getByRole('button', { name: 'Take picture' }).click();
await live.getByRole('button', { name: 'Page 1' }).waitFor();
await live.getByRole('button', { name: 'Close camera' }).click();
ok('closing asks before throwing away scanned pages', await live.getByText(/Discard 1 page/).isVisible());
await p.waitForTimeout(500); // the shutter ignores a second tap straight after a picture
await live.getByRole('button', { name: 'Take picture' }).click();
await live.getByRole('button', { name: 'Page 2' }).waitFor();
ok('changing your mind (taking another picture) takes the question away', (await live.getByText(/Discard/).count()) === 0);
await live.getByRole('button', { name: 'Close camera' }).click();
ok('and closing asks again, now for both pages', await live.getByText(/Discard 2 pages/).isVisible());
await live.getByRole('button', { name: 'Close camera' }).click();
await live.waitFor({ state: 'detached' });
ok('and then adds nothing', (await p.locator('.file', { hasText: 'scan-' }).count()) === 1);

console.log('Phone screen');
const m = await open({ width: 390, height: 800 });
await m.getByRole('button', { name: 'Scan receipt' }).click();
await m.locator('.live-scan').waitFor();
await m.locator('polygon.live-poly').waitFor({ timeout: 8000 });
const shut = await m.getByRole('button', { name: 'Take picture' }).boundingBox();
const done = await m.locator('.live-scan button', { hasText: /^Done/ }).boundingBox();
ok('on a phone the shutter and Done are on screen', !!shut && !!done && shut.y + shut.height <= 800 && done.y + done.height <= 800 && shut.y >= 0, JSON.stringify([shut, done]));
ok('on a phone nothing scrolls sideways', (await m.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1);
await m.screenshot({ path: path.join(OUT, 'live-3-phone.png') });

console.log('No camera available');
const n = await open({ width: 1280, height: 860 }, () => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError')); });
await n.getByRole('button', { name: 'Scan receipt' }).click();
await n.waitForSelector('.toast');
ok('if the camera cannot open it says so and does not break', /camera/i.test(await n.locator('.toast').last().innerText()) && (await n.locator('.live-scan').count()) === 0);
const chooser = n.waitForEvent('filechooser', { timeout: 4000 });
await n.getByRole('button', { name: 'Scan receipt' }).click();
await chooser;
ok('and the next press uses the phone\'s own camera app instead', true);

console.log('A white receipt on a light desk, with a shadow');
await b.close();
const b2 = await chromium.launch({ channel: 'chrome', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${lightClip}`] });
const lctx = await b2.newContext({ viewport: { width: 1280, height: 860 }, baseURL: process.env.WEB ?? 'http://localhost:5173', permissions: ['camera'] });
const l = await lctx.newPage();
l.errors = [];
l.on('pageerror', (e) => l.errors.push(String(e)));
await l.goto('/'); await l.fill('input[type=email]', 'ana.reyes@example.com'); await l.fill('input[type=password]', 'Reimsys#2026'); await l.click('button[type=submit]'); await l.waitForSelector('.shell');
await l.goto('/receipts/new');
await fillQuickForm(l, { payee: 'Light desk ' + Date.now().toString().slice(-6), amount: '7' });
await l.getByRole('button', { name: 'Scan receipt' }).click();
const lpoly = l.locator('.live-scan polygon.live-poly');
await lpoly.waitFor({ timeout: 10000 });
const pts = (await lpoly.getAttribute('points')).split(' ').map((s) => s.split(',').map(Number));
const TRUE = [[430, 70], [880, 110], [850, 650], [400, 610]];
ok('the outline sits on the receipt even on a light desk in shadow', pts.length === 4 && pts.every(([x, y], i) => Math.hypot(x - TRUE[i][0], y - TRUE[i][1]) < 30), JSON.stringify(pts));
await l.screenshot({ path: path.join(OUT, 'live-4-light-desk.png') });
ok('no browser errors on the light desk', l.errors.length === 0);
await b2.close();

/** Opens the scanner on a pretend camera playing `clip`, and returns the outline it settles on (null if none) and the hint. */
async function outlineFor(clip, name) {
  const br = await chromium.launch({ channel: 'chrome', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${clip}`] });
  const ctx = await br.newContext({ viewport: { width: 1280, height: 860 }, baseURL: process.env.WEB ?? 'http://localhost:5173', permissions: ['camera'] });
  const pg = await ctx.newPage();
  await pg.goto('/'); await pg.fill('input[type=email]', 'ana.reyes@example.com'); await pg.fill('input[type=password]', 'Reimsys#2026'); await pg.click('button[type=submit]'); await pg.waitForSelector('.shell');
  await pg.goto('/receipts/new');
  await fillQuickForm(pg, { payee: name + ' ' + Date.now().toString().slice(-6), amount: '9' });
  await pg.getByRole('button', { name: 'Scan receipt' }).click();
  const pl = pg.locator('.live-scan polygon.live-poly');
  const there = await pl.waitFor({ timeout: 10000 }).then(() => true, () => false);
  await pg.waitForTimeout(700); // let the outline glide into place
  const pts = there ? (await pl.getAttribute('points')).split(' ').map((s) => s.split(',').map(Number)) : null;
  const hint = await pg.locator('.live-hint').innerText();
  await pg.screenshot({ path: path.join(OUT, `live-${name}.png`) });
  await br.close();
  return { pts, hint };
}
const near = (pts, truth, tol) => !!pts && pts.length === 4 && pts.every(([x, y], i) => Math.hypot(x - truth[i][0], y - truth[i][1]) < tol);

console.log('A long narrow receipt further away');
const nar = await outlineFor(narrowClip, 'narrow');
ok('a narrow receipt filling under a tenth of the picture is still found', near(nar.pts, NARROW, 25), JSON.stringify(nar.pts));
ok('and it suggests moving closer', /closer/.test(nar.hint), nar.hint);

console.log('A white receipt on a white desk');
const fa = await outlineFor(faintClip, 'faint');
ok('a receipt barely lighter than the desk is found', near(fa.pts, FAINT, 25), JSON.stringify(fa.pts));

ok('no browser errors', [p, m, n].every((x) => x.errors.length === 0), JSON.stringify([p, m, n].flatMap((x) => x.errors).slice(0, 3)));
console.log(failed ? `\n${failed} FAILED. Screenshots in ${OUT}` : `\nAll checks passed. Screenshots in ${OUT}`);
process.exit(failed ? 1 : 0);
