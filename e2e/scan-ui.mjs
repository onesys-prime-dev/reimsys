// Drives the evidence step of the receipt form: the preview button and "Scan receipt". Needs the API (4000) and web app (5173).
// Usage: node e2e/scan-ui.mjs [screenshot-dir]
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fillQuickForm, toLastStep } from './form-helpers.mjs';

const OUT = process.argv[2] ?? path.join(os.tmpdir(), 'reimsys-scan-shots');
fs.mkdirSync(OUT, { recursive: true });
let failed = 0;
const ok = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : x); if (!c) failed++; };
const TRUTH = [[180, 80], [640, 130], [600, 520], [130, 470]];
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');

const b = await chromium.launch({ channel: 'chrome' });
async function open(size = { width: 1280, height: 860 }) {
  const ctx = await b.newContext({ viewport: size, baseURL: process.env.WEB ?? 'http://localhost:5173' });
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  p.on('console', (m) => m.type() === 'error' && !/40[0-9]/.test(m.text()) && p.errors.push(m.text()));
  await p.goto('/'); await p.fill('input[type=email]', 'ana.reyes@example.com'); await p.fill('input[type=password]', 'Reimsys#2026'); await p.click('button[type=submit]');
  await p.waitForSelector('.shell');
  return p;
}
/** A photo of a tilted receipt lying on a dark table, drawn in the page and returned as JPEG bytes. */
const photo = async (p) => Buffer.from((await p.evaluate((t) => {
  const c = document.createElement('canvas'); c.width = 800; c.height = 600;
  const g = c.getContext('2d'); g.fillStyle = '#202428'; g.fillRect(0, 0, 800, 600);
  g.fillStyle = '#ebebe6'; g.beginPath(); g.moveTo(...t[0]); for (const q of t.slice(1)) g.lineTo(...q); g.closePath(); g.fill();
  g.fillStyle = '#222'; for (let i = 0; i < 12; i++) g.fillRect(230 + i * 3, 160 + i * 28, 300 - i * 5, 6);
  return c.toDataURL('image/jpeg', 0.9);
}, TRUTH)).split(',')[1], 'base64');

const p = await open();
await p.goto('/receipts/new');
await fillQuickForm(p, { payee: 'Scan test ' + Date.now().toString().slice(-6), amount: '88' });

console.log('The upload step');
ok('"Scan receipt" replaces "Take photo"', await p.locator('button:has-text("Scan receipt")').isVisible() && (await p.locator('button:has-text("Take photo")').count()) === 0);
ok('the scan input asks the phone for its rear camera', (await p.locator('input[aria-label="Scan a receipt photo"]').getAttribute('capture')) === 'environment');

console.log('Scanning');
await p.setInputFiles('input[aria-label="Scan a receipt photo"]', { name: 'IMG_0001.jpg', mimeType: 'image/jpeg', buffer: await photo(p) });
const dlg = p.locator('.modal.scan');
await dlg.waitFor({ timeout: 8000 });
await dlg.locator('circle').first().waitFor();
const corners = await dlg.locator('circle').evaluateAll((els) => els.map((e) => [Number(e.getAttribute('cx')), Number(e.getAttribute('cy'))]));
ok('it found the four corners of the receipt by itself', corners.length === 4 && corners.every(([x, y], i) => Math.hypot(x - TRUTH[i][0], y - TRUTH[i][1]) < 14), JSON.stringify(corners));
ok('it offers Document, Original and Black & white, with Document chosen', (await dlg.getByRole('radio', { name: 'Document' }).getAttribute('aria-checked')) === 'true' && await dlg.getByRole('radio', { name: 'Original' }).isVisible() && await dlg.getByRole('radio', { name: 'Black & white' }).isVisible());
await p.screenshot({ path: path.join(OUT, 'scan-1-dialog.png') });
await dlg.getByRole('radio', { name: 'Black & white' }).click();
const onlyBW = await dlg.locator('canvas.result').evaluate((c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 4) if (d[i] !== 0 && d[i] !== 255) return false; return d.length > 0; });
ok('Black & white shows only black and white', onlyBW);
await dlg.getByRole('radio', { name: 'Document' }).click();
await dlg.locator('button:has-text("Use scan")').click();
await dlg.waitFor({ state: 'detached' });
const row = p.locator('.file', { hasText: 'scan-' });
ok('the scan is added to the receipt as a JPEG', (await row.count()) === 1 && /scan-.*\.jpg/.test(await row.innerText()));

console.log('Preview');
await p.setInputFiles('input[type=file][multiple]', { name: 'invoice.pdf', mimeType: 'application/pdf', buffer: PDF });
const scanName = (await row.locator('b').innerText()).trim();
await p.getByRole('button', { name: `Preview ${scanName}` }).click();
const pv = p.locator('.modal.wide');
await pv.waitFor();
const img = pv.locator('img');
await img.waitFor();
const size = await img.evaluate((e) => new Promise((r) => (e.complete ? r([e.naturalWidth, e.naturalHeight]) : e.addEventListener('load', () => r([e.naturalWidth, e.naturalHeight])))));
ok('the preview shows the straightened receipt, not the whole photo', Math.abs(size[0] - 467) < 40 && Math.abs(size[1] - 391) < 40, JSON.stringify(size));
await p.screenshot({ path: path.join(OUT, 'scan-2-preview.png') });
await p.keyboard.press('Escape');
ok('Escape closes the preview', (await p.locator('.modal.wide').count()) === 0);
await p.getByRole('button', { name: 'Preview invoice.pdf' }).click();
ok('a PDF previews in a frame', await p.locator('.modal.wide iframe').isVisible());
await p.locator('.modal.wide button:has-text("Close")').click();
ok('Close closes it', (await p.locator('.modal.wide').count()) === 0);

console.log('A saved file');
await p.click('button:has-text("Save draft")');
await p.waitForURL(/\/receipts\/\d+$/);
await p.goto(p.url() + '/edit');
await p.waitForSelector('.steps');
await toLastStep(p);
await p.getByRole('button', { name: `Preview ${scanName}` }).click();
const saved = p.locator('.modal.wide img');
await saved.waitFor();
ok('a file that is already saved previews too', await saved.evaluate((e) => new Promise((r) => (e.complete ? r(e.naturalWidth > 100) : e.addEventListener('load', () => r(e.naturalWidth > 100))))));
await p.keyboard.press('Escape');

console.log('Phone screen');
const m = await open({ width: 390, height: 800 });
await m.goto('/receipts/new');
await fillQuickForm(m, { payee: 'Scan phone ' + Date.now().toString().slice(-6), amount: '12' });
await m.setInputFiles('input[aria-label="Scan a receipt photo"]', { name: 'IMG_0002.jpg', mimeType: 'image/jpeg', buffer: await photo(m) });
await m.locator('.modal.scan').waitFor();
await m.locator('.modal.scan circle').first().waitFor();
const useBox = await m.locator('.modal.scan button:has-text("Use scan")').boundingBox();
ok('on a phone the scanner fits the width and "Use scan" is on screen without scrolling', (await m.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1 && !!useBox && useBox.y + useBox.height <= 800 && useBox.y >= 0, JSON.stringify(useBox));
const phoneBox = await m.locator('.modal.scan').boundingBox();
ok('on a phone the whole scanner stays inside the screen', !!phoneBox && phoneBox.y >= 0 && phoneBox.y + phoneBox.height <= 800, JSON.stringify(phoneBox));
await m.screenshot({ path: path.join(OUT, 'scan-3-phone.png') });

ok('no browser errors', p.errors.length === 0 && m.errors.length === 0, JSON.stringify([...p.errors, ...m.errors].slice(0, 3)));
await b.close();
console.log(failed ? `\n${failed} FAILED. Screenshots in ${OUT}` : `\nAll checks passed. Screenshots in ${OUT}`);
process.exit(failed ? 1 : 0);
