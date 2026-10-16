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
async function makeClip(browser) {
  const p = await browser.newPage();
  const b64 = await p.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
    const g = c.getContext('2d'); g.fillStyle = '#1d2226'; g.fillRect(0, 0, 1280, 720);
    g.fillStyle = '#ecece6'; g.beginPath(); g.moveTo(430, 70); g.lineTo(880, 110); g.lineTo(850, 650); g.lineTo(400, 610); g.closePath(); g.fill();
    g.fillStyle = '#2a2a2a'; for (let i = 0; i < 14; i++) g.fillRect(480 + i * 2, 170 + i * 30, 300 - i * 4, 8);
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  });
  await p.close();
  const file = path.join(OUT, 'receipt-clip.mjpeg');
  fs.writeFileSync(file, Buffer.concat(Array.from({ length: 30 }, () => Buffer.from(b64, 'base64'))));
  return file;
}

const tmp = await chromium.launch({ channel: 'chrome' });
const clip = await makeClip(tmp);
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
// While the picture is not yet taken the hint must pass through "Hold still", and the progress bar must fill.
const seen = new Set();
let widest = 0;
for (let i = 0; i < 40 && !seen.has('Got it. Show the next page, or press Done.'); i++) {
  seen.add((await live.locator('.live-hint').innerText().catch(() => '')).trim());
  widest = Math.max(widest, await live.locator('.live-bar i').evaluate((e) => e.getBoundingClientRect().width).catch(() => 0));
  if (seen.has('Hold still…') && i === 1) await p.screenshot({ path: path.join(OUT, 'live-1-outline.png') });
  await p.waitForTimeout(100);
}
ok('it says "Hold still" while it waits, and the progress bar fills', seen.has('Hold still…') && widest > 20, JSON.stringify([...seen, widest]));
await live.getByRole('button', { name: 'Page 1' }).waitFor({ timeout: 12000 });
ok('it takes the picture by itself once the receipt is steady', (await live.getByRole('button', { name: /^Page \d/ }).count()) === 1);
ok('and offers Done with the page count', await live.getByRole('button', { name: 'Done (1)' }).isVisible());
await p.waitForTimeout(3500);
ok('it does not keep taking the same receipt over and over', (await live.getByRole('button', { name: /^Page \d/ }).count()) === 1);
await p.screenshot({ path: path.join(OUT, 'live-2-first-page.png') });

await live.getByRole('button', { name: 'Take picture' }).click();
await live.getByRole('button', { name: 'Page 2' }).waitFor();
ok('the shutter button takes another page by hand', await live.getByRole('button', { name: 'Done (2)' }).isVisible());

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
await live.getByRole('button', { name: 'Page 1' }).waitFor({ timeout: 12000 });
await live.getByRole('button', { name: 'Close camera' }).click();
ok('closing asks before throwing away scanned pages', await live.getByText(/Discard 1 page/).isVisible());
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

ok('no browser errors', [p, m, n].every((x) => x.errors.length === 0), JSON.stringify([p, m, n].flatMap((x) => x.errors).slice(0, 3)));
await b.close();
console.log(failed ? `\n${failed} FAILED. Screenshots in ${OUT}` : `\nAll checks passed. Screenshots in ${OUT}`);
process.exit(failed ? 1 : 0);
