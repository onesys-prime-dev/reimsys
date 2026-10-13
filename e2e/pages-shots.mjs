// Full-page screenshots of every screen for every role, plus a rough measure of empty space.
// Usage: node e2e/pages-shots.mjs <dir> [phone]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2];
const phone = process.argv[3] === 'phone';
const size = phone ? { width: 390, height: 800 } : { width: 1280, height: 800 };
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });

const ROLES = {
  medref: ['ana.reyes@example.com', ['/', '/receipts', '/receipts/new', '/receipts/import', '/reports', '/profile']],
  checker: ['liza.santos@example.com', ['/', '/receipts', '/reports']],
  approver: ['paolo.v@example.com', ['/', '/receipts', '/reports']],
  admin: ['admin@example.com', ['/', '/receipts', '/reports', '/access', '/audit', '/profile']],
};

for (const [role, [email, pages]] of Object.entries(ROLES)) {
  const ctx = await browser.newContext({ viewport: size, baseURL: 'http://localhost:5173' });
  const p = await ctx.newPage();
  await p.goto('/'); await p.fill('input[type=email]', email); await p.fill('input[type=password]', 'Reimsis#2026'); await p.click('button[type=submit]');
  await p.waitForSelector('.shell');
  const list = [...pages];
  // one receipt detail and one report view
  const api = async (u) => p.evaluate(async (x) => (await fetch(x, { headers: { 'x-requested-with': 'reimsis' } })).json(), u);
  const rs = await api('/api/receipts?pageSize=100');
  const pick = (st) => rs.items.find((r) => r.status === st);
  for (const st of ['approved', 'checked', 'submitted', 'returned']) { const r = pick(st); if (r) { list.push('/receipts/' + r.id); break; } }
  const reps = await api('/api/reports');
  if (reps.reports?.length) list.push('/reports/' + reps.reports.find((r) => r.status === 'ready').id);
  for (const u of list) {
    await p.goto(u); await p.waitForSelector('.page'); await p.waitForTimeout(900);
    const name = `${role}${u.replace(/\//g, '_') || '_home'}${phone ? '-phone' : ''}`;
    await p.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true });
    // blank-space probe: tallest card vs its row neighbour, empty bottom area of the page
    const probe = await p.evaluate(() => {
      const out = [];
      document.querySelectorAll('.grid2, .dgrid').forEach((g) => {
        const kids = [...g.children].filter((c) => c.getBoundingClientRect().height > 0);
        if (kids.length < 2) return;
        // only meaningful when side by side
        const r0 = kids[0].getBoundingClientRect(), r1 = kids[1].getBoundingClientRect();
        if (Math.abs(r0.top - r1.top) > 4) return;
        for (const k of kids) {
          const kb = k.getBoundingClientRect();
          const inner = [...k.children].reduce((m, c) => Math.max(m, c.getBoundingClientRect().bottom), kb.top);
          const gap = Math.round(kb.bottom - inner);
          if (gap > 80) out.push(`${k.className || k.tagName} has ${gap}px empty at the bottom`);
        }
      });
      return out;
    });
    if (probe.length) console.log(`${name}: ${probe.join('; ')}`);
  }
  await ctx.close();
}
await browser.close();
console.log('done');
