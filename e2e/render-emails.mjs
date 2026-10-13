// Renders each email exactly as the server builds it (sample data) and screenshots it, no sending.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({ baseURL: 'http://localhost:4000' });
const p = await ctx.newPage();
await p.goto('/'); await p.fill('input[type=email]', 'admin@example.com'); await p.fill('input[type=password]', 'Reimsis#2026'); await p.click('button[type=submit]'); await p.waitForSelector('.shell');
for (const key of ['returned', 'approved', 'disapproved', 'reserved', 'released', 'digest', 'test']) {
  const r = await p.evaluate(async (k) => (await fetch(`/api/settings/email-templates/${k}/preview`, { method: 'POST', headers: { 'x-requested-with': 'reimsis', 'content-type': 'application/json' }, body: '{}' })).json(), key);
  for (const [name, w] of [['desktop', 680], ['phone', 390]]) {
    const pg = await b.newPage({ viewport: { width: w, height: 700 } });
    await pg.setContent(r.html);
    await pg.screenshot({ path: path.join(out, `${key}-${name}.png`), fullPage: true });
    await pg.close();
  }
  console.log(key, '|', r.subject);
}
await b.close();
