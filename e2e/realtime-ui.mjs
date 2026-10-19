// Live updates in real browsers. Nobody reloads. One person acts; another person's already-open screen must change by itself.
// Usage: WEB=http://localhost:4000 node e2e/realtime-ui.mjs <screenshot-dir>
import { chromium } from 'playwright';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
// The reimbursement form's answers for a receipt with no BIR invoice: the shortest valid receipt.
const F = { birInvoice: false, vendorAddress: 'Test Street, Test City', reasonForSpending: 'Test receipt', classification: 'fuel' };

const WEB = process.env.WEB ?? 'http://localhost:4000';
const out = path.resolve(process.argv[2] ?? 'storage/realtime');
fs.mkdirSync(out, { recursive: true });
let bad = 0;
const ok = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : x); if (!c) bad++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = Date.now();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/* ---- quick API helpers for the person who ACTS (the watchers are real browsers) ---- */
const H = (c) => ({ cookie: c, 'x-requested-with': 'reimsys', origin: WEB, 'content-type': 'application/json' });
const api = async (c, m, p, b) => { const r = await fetch(WEB + '/api' + p, { method: m, headers: H(c), body: b ? JSON.stringify(b) : undefined }); return { status: r.status, data: await r.json().catch(() => null), cookie: r.headers.get('set-cookie')?.split(';')[0] }; };
const login = async (e, pw = 'Reimsys#2026') => (await api('', 'POST', '/auth/login', { email: e, password: pw })).cookie;
async function makeReceipt(c, tag) {
  const cat = (await api(c, 'GET', '/categories')).data.categories[0].id;
  let r = (await api(c, 'POST', '/receipts', { payee: tag, receiptDate: '2026-10-11', amount: 88, ...F })).data.receipt;
  const f = new FormData(); f.append('files', new Blob([Buffer.concat([PNG, Buffer.from(tag + Math.random())])], { type: 'image/png' }), 'r.png');
  r = (await (await fetch(`${WEB}/api/receipts/${r.id}/evidence`, { method: 'POST', headers: { cookie: c, 'x-requested-with': 'reimsys', origin: WEB }, body: f })).json()).receipt;
  return r;
}
const view = (c, r) => fetch(`${WEB}/api/receipts/${r.id}/evidence/${r.evidence[0].id}/file?mode=view`, { headers: { cookie: c } });

const b = await chromium.launch({ channel: 'chrome' });
const errs = [];
async function watcher(email, startPath, size = { width: 1280, height: 860 }, pw = 'Reimsys#2026') {
  const ctx = await b.newContext({ viewport: size, baseURL: WEB });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('console', (m) => m.type() === 'error' && !/40[0-9]|ERR_CONNECTION_(RESET|REFUSED)|ERR_EMPTY_RESPONSE/.test(m.text()) && errs.push(m.text())); // the test restarts the server on purpose
  await p.goto('/'); await p.fill('input[type=email]', email); await p.fill('input[type=password]', pw); await p.click('button[type=submit]'); await p.waitForSelector('.shell');
  if (startPath !== '/') await p.goto(startPath);
  await p.waitForSelector('.live.live', { timeout: 10000 });
  await p.evaluate(() => { window.__noReload = 'still-here'; }); // a reload would wipe this
  return p;
}
const eventually = async (fn, ms = 9000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return true; } catch { /* keep trying */ } await sleep(250); } return false; };
const num = async (p, label) => Number((await p.locator(`.tile:has-text("${label}") b`).first().innerText()).replace(/[^0-9]/g, ''));

const [ana, liza, paolo, admin] = await Promise.all(['ana.reyes@example.com', 'liza.santos@example.com', 'paolo.v@example.com', 'admin@example.com'].map((e) => login(e)));
let server = null;
let permsToRestore = null; // put back in the finally block whatever happens

try {
  /* ============ 1. a receipt is submitted: the checker's screens fill in by themselves ============ */
  console.log('A receipt is submitted');
  const lizaDash = await watcher('liza.santos@example.com', '/');
  const lizaList = await watcher('liza.santos@example.com', '/receipts');
  ok('the live light is green on a signed-in page', await lizaDash.locator('.live.live').count() === 1);
  const toCheck0 = await num(lizaDash, 'To check');
  const bell0 = Number((await lizaDash.locator('button[aria-label^="Notifications"] .badge').first().innerText().catch(() => '0')).replace(/\D/g, '') || 0);
  const tag1 = 'Live One ' + stamp;
  let r1 = await makeReceipt(ana, tag1);
  r1 = (await api(ana, 'POST', `/receipts/${r1.id}/submit`, { version: r1.version })).data.receipt;
  ok('the checker\'s dashboard count goes up without a refresh', await eventually(async () => (await num(lizaDash, 'To check')) === toCheck0 + 1), `was ${toCheck0}`);
  // The dashboard queue shows only the six oldest waiting receipts, so a new one is visible there only when fewer than six are waiting.
  if (toCheck0 < 6) ok('the receipt appears in the checker\'s queue', await eventually(() => lizaDash.locator(`.row:has-text("${tag1}")`).count().then((n) => n === 1)));
  else console.log("  note: six or more receipts were already waiting, so the new one is not in the dashboard queue; the count above proves the live update");
  ok('the checker\'s open receipt list gets the new row by itself', await eventually(() => lizaList.locator(`a.row:has-text("${tag1}")`).count().then((n) => n === 1)));
  ok('the bell on the checker\'s screen lights up by itself', await eventually(async () => Number((await lizaDash.locator('button[aria-label^="Notifications"] .badge').first().innerText().catch(() => '0')).replace(/\D/g, '') || 0) > bell0 || bell0 >= 99));
  await lizaDash.screenshot({ path: path.join(out, '1-checker-dashboard.png') });

  /* ============ 2. the checker checks it: the approver's screen updates ============ */
  console.log('\nThe checker checks it');
  const paoloDash = await watcher('paolo.v@example.com', '/');
  const toDecide0 = await num(paoloDash, 'To decide');
  await view(liza, r1);
  r1 = (await api(liza, 'POST', `/receipts/${r1.id}/check`, { version: r1.version, note: 'ok' })).data.receipt;
  ok('the approver\'s "To decide" count goes up without a refresh', await eventually(async () => (await num(paoloDash, 'To decide')) === toDecide0 + 1), `was ${toDecide0}`);
  if (toDecide0 < 6) ok('the receipt shows in the approver\'s queue', await eventually(() => paoloDash.locator(`.row:has-text("${tag1}")`).count().then((n) => n === 1)));
  else console.log("  note: six or more receipts were already waiting for a decision, so the new one is not in the dashboard queue; the count above proves the live update");
  ok('the checker\'s own list moves it out of "waiting" by itself', await eventually(() => lizaList.locator(`a.row:has-text("${tag1}") .pill:has-text("Checked")`).count().then((n) => n === 1)));

  /* ============ 3. the approver approves: the Med Ref watching the receipt sees it happen ============ */
  console.log('\nThe approver approves while the Med Ref is looking at the receipt');
  const anaDetail = await watcher('ana.reyes@example.com', `/receipts/${r1.id}`);
  ok('the Med Ref sees it as Checked', await anaDetail.locator('.pill:has-text("Checked")').count() === 1);
  await view(paolo, r1);
  r1 = (await api(paolo, 'POST', `/receipts/${r1.id}/approve`, { version: r1.version, note: 'Approved.' })).data.receipt;
  ok('the status flips to Approved on their screen by itself', await eventually(() => anaDetail.locator('.pill:has-text("Approved")').count().then((n) => n >= 1)));
  ok('the reimbursement document appears by itself', await eventually(() => anaDetail.locator('text=Reimbursement document').count().then((n) => n >= 1), 12000));
  ok('the new history lines appear by themselves', await eventually(() => anaDetail.locator('text=approved the record').count().then((n) => n >= 1)));
  await anaDetail.screenshot({ path: path.join(out, '2-medref-sees-approval.png') });
  ok('the document is downloadable once it appears', await eventually(() => anaDetail.locator('a:has-text("Download")').count().then((n) => n >= 1)));

  /* ============ 4. a comment ============ */
  console.log('\nA comment is posted');
  const tag2 = 'Live Two ' + stamp;
  let r2 = await makeReceipt(ana, tag2); r2 = (await api(ana, 'POST', `/receipts/${r2.id}/submit`, { version: r2.version })).data.receipt;
  const anaDetail2 = await watcher('ana.reyes@example.com', `/receipts/${r2.id}`);
  await api(liza, 'POST', `/receipts/${r2.id}/comments`, { body: 'Is this the whole receipt?' });
  ok('a comment from the checker shows up on the Med Ref\'s open page', await eventually(() => anaDetail2.locator('.cmt:has-text("Is this the whole receipt?")').count().then((n) => n === 1)));

  /* ============ 5. permissions ============ */
  console.log('\nAn administrator changes what a role may do');
  const roles = (await api(admin, 'GET', '/roles')).data.roles;
  const medref = roles.find((r) => r.code === 'medref');
  const current = ((await api(admin, 'GET', '/permissions')).data.grants ?? {})[medref.id] ?? [];
  if (!current.includes('report.generate')) throw new Error('Could not read the Med Ref permissions, so the permission check was skipped to protect them: ' + JSON.stringify(current));
  permsToRestore = { id: medref.id, codes: current };
  ok('Ana can see Reports in her menu', await anaDetail2.locator('.nav a:has-text("Reports")').count() === 1);
  await api(admin, 'PUT', `/roles/${medref.id}/permissions`, { codes: current.filter((c) => c !== 'report.generate') });
  ok('the Reports link disappears from her open screen by itself', await eventually(() => anaDetail2.locator('.nav a:has-text("Reports")').count().then((n) => n === 0)));
  await api(admin, 'PUT', `/roles/${medref.id}/permissions`, { codes: current });
  ok('and comes back when it is given back', await eventually(() => anaDetail2.locator('.nav a:has-text("Reports")').count().then((n) => n === 1)));

  /* ============ 6. someone is switched off while signed in ============ */
  console.log('\nAn account is switched off while its owner is signed in');
  const email = `live.${stamp}@example.com`;
  const made = await api(admin, 'POST', '/users', { name: 'Live Watcher', email, roleId: medref.id });
  const ck = await login(email, made.data.temporaryPassword);
  await api(ck, 'POST', '/me/password', { currentPassword: made.data.temporaryPassword, newPassword: 'LiveWatch12345' });
  const gone = await watcher(email, '/', { width: 1280, height: 860 }, 'LiveWatch12345');
  await api(admin, 'PATCH', `/users/${made.data.user.id}`, { isActive: false });
  ok('their screen returns to the sign-in page by itself', await eventually(() => gone.locator('input[type=password]').count().then((n) => n === 1)));
  await gone.screenshot({ path: path.join(out, '3-switched-off.png') });

  /* ============ 7. the connection drops and comes back ============ */
  console.log('\nThe server restarts');
  const env = { ...process.env, WEB_ORIGIN: `${WEB},http://localhost:4000` };
  execFileSync('powershell.exe', ['-NoProfile', '-Command', "Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"]);
  ok('the light turns to "Offline" while the server is down', await eventually(() => lizaDash.locator('.live.offline').count().then((n) => n === 1), 12000));
  await lizaDash.screenshot({ path: path.join(out, '4-offline.png') });
  await sleep(800); // let the old process let go of the port
  const logFd = fs.openSync(path.join(out, 'restarted-server.log'), 'w');
  server = spawn(process.execPath, ['dist/server.js'], { cwd: path.resolve('apps/api'), env, stdio: ['ignore', logFd, logFd], detached: true });
  server.unref();
  let up = false;
  for (let i = 0; i < 40 && !up; i++) { up = await fetch(WEB + '/api/health').then((r) => r.ok).catch(() => false); if (!up) await sleep(500); }
  ok('the server comes back after a restart', up);
  ok('and back to "Live" by itself when it returns', await eventually(() => lizaDash.locator('.live.live').count().then((n) => n === 1), 25000));
  const tag3 = 'Live Three ' + stamp;
  const [ana2, liza2] = await Promise.all([login('ana.reyes@example.com'), login('liza.santos@example.com')]);
  let r3 = await makeReceipt(ana2, tag3); r3 = (await api(ana2, 'POST', `/receipts/${r3.id}/submit`, { version: r3.version })).data.receipt;
  void liza2;
  ok('updates keep arriving after the restart', await eventually(() => lizaList.locator(`a.row:has-text("${tag3}")`).count().then((n) => n === 1), 12000));

  /* ============ 8. nothing reloaded, nothing broke, phone fits ============ */
  console.log('\nOverall');
  const markers = await Promise.all([lizaDash, lizaList, paoloDash, anaDetail, anaDetail2].map((p) => p.evaluate(() => window.__noReload)));
  ok('not one of those pages was reloaded', markers.every((m) => m === 'still-here'), JSON.stringify(markers));
  const ph = await watcher('liza.santos@example.com', '/', { width: 390, height: 800 });
  ok('on a phone the light is a small dot and nothing overflows', (await ph.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1 && (await ph.locator('.live-t').isHidden()));
  await ph.screenshot({ path: path.join(out, '5-phone.png') });
  ok('no browser errors', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
} finally {
  await b.close();
  if (permsToRestore) {
    const a = await login('admin@example.com').catch(() => null);
    if (a) await api(a, 'PUT', `/roles/${permsToRestore.id}/permissions`, { codes: permsToRestore.codes }).catch(() => null);
  }
  execFileSync('C:/xampp/mysql/bin/mysql.exe', ['-u', 'root', 'reimsys', '-e', `DELETE FROM receipt WHERE payee LIKE 'Live % ${stamp}'`]);
}
console.log(bad ? `\n${bad} FAILED` : '\nAll live-update checks passed');
process.exit(bad ? 1 : 0);
