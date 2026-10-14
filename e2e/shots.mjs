import { chromium } from 'playwright';
const out = process.argv[2];
const b = await chromium.launch({ channel: 'chrome' });
async function session(email, size, shots) {
  const ctx = await b.newContext({ viewport: size, baseURL: 'http://localhost:5173' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  p.on('pageerror', e => errs.push(String(e)));
  await p.goto('/');
  await p.fill('input[type=email]', email);
  await p.fill('input[type=password]', 'Reimsys#2026');
  await p.click('button[type=submit]');
  await p.waitForSelector('.shell');
  for (const [path, name, action] of shots) {
    await p.goto(path); await p.waitForSelector('.page'); await p.waitForTimeout(700);
    if (action) await action(p);
    await p.screenshot({ path: `${out}/${name}.png` });
  }
  console.log(email, size.width, 'errors:', errs);
  await ctx.close();
}
await session('admin@example.com', { width: 1280, height: 800 }, [
  ['/', 'a-dash'], ['/access', 'a-users'],
  ['/access', 'a-perms', async p => { await p.click('text=Roles and permissions'); await p.waitForTimeout(500); }],
  ['/audit', 'a-audit'], ['/profile', 'a-profile'],
]);
await session('ana.reyes@example.com', { width: 390, height: 800 }, [['/', 'm-dash'], ['/profile', 'm-profile']]);
await session('admin@example.com', { width: 390, height: 800 }, [['/access', 'm-users']]);
await b.close();
