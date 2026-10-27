// The tax figures on the dashboard (a small row) and on their own page (everything), as management and as a Med Ref, on a computer and on a phone.
// Needs the API (4000) and web app (5173). Usage: node e2e/tax-dashboard-ui.mjs
import { chromium } from 'playwright';

const b = await chromium.launch({ channel: 'chrome' });
let failed = 0;
const ok = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : x); if (!c) failed++; };

async function open(email, size) {
  const p = await (await b.newContext({ viewport: size, baseURL: process.env.WEB ?? 'http://localhost:5173' })).newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  await p.goto('/'); await p.fill('input[type=email]', email); await p.fill('input[type=password]', 'Reimsys#2026'); await p.click('button[type=submit]'); await p.waitForSelector('.shell');
  return p;
}
const noSideways = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

for (const [label, size] of [['computer', { width: 1366, height: 800 }], ['phone', { width: 390, height: 800 }]]) {
  console.log('\n' + label);
  const m = await open('liza.santos@example.com', size);
  await m.waitForSelector('.tisum .tile b');
  ok('management: the dashboard has a small tax row with three figures', (await m.locator('.tisum .tile').count()) === 3 && /₱/.test(await m.locator('.tisum .tile b').first().innerText()));
  ok('the row says the figures are potential, not verified', /potential, not verified/.test(await m.locator('.tisum-h').innerText()));
  ok('and it is not the whole detail: no chart or employee table on the dashboard', (await m.locator('.tibars, [data-testid=ti-employees]').count()) === 0);
  const q = await m.locator('.tisum').boundingBox(), tiles = await m.locator('.tiles').first().boundingBox();
  ok('the row sits right under the status tiles and above the queue', q.y >= tiles.y + tiles.height - 1 && q.height < (label === 'phone' ? 320 : 200), JSON.stringify([q, tiles]));
  ok('no sideways scrolling on the dashboard', await noSideways(m));
  await m.click('.tisum a:has-text("Details")');
  await m.waitForURL(/\/tax-impact$/);
  await m.waitForSelector('.taximpact .tile b');
  ok('the details page has the five figures', (await m.locator('.taximpact .tile').count()) === 5);
  ok('the dates are side by side, not stacked', await m.evaluate(() => { const l = [...document.querySelectorAll('.tifilter label')].filter((x) => /^(From|To)$/.test(x.querySelector('span').textContent)).map((x) => x.getBoundingClientRect()); return l.length === 2 && (Math.abs(l[0].top - l[1].top) < 4 || innerWidth < 500); }));
  await m.waitForSelector('.tibars');
  ok('the detail is in tabs: by month, largest losses and employee evaluation, with only one open at a time', (await m.getByRole('tab').count()) === 3 && (await m.locator('.tibars').count()) === 1 && (await m.locator('.taximpact table').count()) === 0);
  ok('the long explanation is folded away until asked for', !(await m.locator('.tihow p').first().isVisible()));
  await m.getByRole('tab', { name: /Largest losses/ }).click();
  ok('the largest losses tab has the table', (await m.locator('.taximpact table').count()) === 1 && (await m.locator('.tibars').count()) === 0);
  await m.getByRole('tab', { name: /Employee evaluation/ }).click();
  await m.getByRole('tab', { name: 'By month' }).click();
  ok('every month is one line: the label, the bars, then the amounts', label === 'phone' || (await m.locator('.tibar').first().evaluate((r) => { const k = [...r.children].map((x) => x.getBoundingClientRect().top); return Math.max(...k) - Math.min(...k) < 12; })));
  await m.getByRole('tab', { name: 'By month' }).click();
  ok('the monthly chart is back', (await m.locator('.tibars').count()) === 1);
  await m.getByRole('tab', { name: /Employee evaluation/ }).click();
  await m.locator('[data-testid=ti-employees] button[aria-expanded]').first().click();
  ok('an employee opens to their submissions', (await m.locator('tr.sub').count()) >= 1);
  ok('no sideways scrolling on the details page', await noSideways(m));
  await m.click('.ph a:has-text("Dashboard")');
  await m.waitForSelector('.tisum');
  ok('the back button returns to the dashboard', new URL(m.url()).pathname === '/');
  ok('no browser errors', m.errors.length === 0, m.errors.join(' | '));

  const a = await open('ana.reyes@example.com', size);
  await a.waitForSelector('.tisum .tile b');
  await a.goto('/tax-impact'); await a.waitForSelector('.taximpact .tile b');
  ok('a Med Ref sees their own figures and no employee evaluation tab', (await a.getByRole('tab').count()) === 2 && (await a.getByRole('tab', { name: /Employee/ }).count()) === 0 && /Your receipts/.test(await a.locator('.taximpact').innerText()));
  await a.getByRole('tab', { name: /Largest losses/ }).click();
  ok('and no other person is named', !(await a.locator('.taximpact table').allInnerTexts()).join(' ').includes('Liza'));
  ok('no sideways scrolling', await noSideways(a));
}
console.log('\nThe administrator: everyone as a whole, and one person at a time');
{
  const ad = await open('admin@example.com', { width: 1366, height: 800 });
  await ad.goto('/tax-impact'); await ad.waitForSelector('.taximpact .tile b');
  const sel = ad.getByLabel('Employee');
  ok('the administrator can choose an employee, with "Everyone" first', (await sel.count()) === 1 && (await sel.locator('option').first().innerText()) === 'Everyone' && (await sel.locator('option').count()) >= 2);
  const whole = await ad.locator('[data-testid=ti-loss]').innerText();
  ok('with Everyone chosen the figures are the whole', /everyone/i.test(await ad.locator('.tifilterbar').innerText()));
  const names = await sel.locator('option').allInnerTexts();
  await sel.selectOption({ index: 1 });
  await ad.waitForTimeout(700);
  const person = names[1];
  ok('choosing a person says whose figures these are', (await ad.locator('.tifilterbar').innerText()).includes(person), await ad.locator('.tifilterbar').innerText());
  ok('and the list of people does not shrink', (await sel.locator('option').count()) === names.length);
  const one = await ad.locator('[data-testid=ti-loss]').innerText();
  ok('one person is never more than the whole', Number(one.replace(/[^\d.]/g, '')) <= Number(whole.replace(/[^\d.]/g, '')), one + ' vs ' + whole);
  await ad.getByRole('tab', { name: /Employee evaluation/ }).click();
  ok('the employee table is only that person', (await ad.locator('[data-testid=ti-employees] > tbody > tr:not(.sub)').count()) <= 1);
  await ad.getByRole('button', { name: 'Clear' }).click();
  await ad.waitForTimeout(500);
  ok('Clear goes back to everyone', (await sel.inputValue()) === '' && (await ad.locator('[data-testid=ti-loss]').innerText()) === whole);
}

console.log('\nShort windows: the bottom of the dashboard can always be reached');
for (const h of [560, 640, 720, 800, 900]) {
  const m = await open('liza.santos@example.com', { width: 1519, height: h });
  await m.waitForSelector('.row');
  await m.evaluate(() => { document.querySelector('.main').scrollTop = 99999; });
  await m.waitForTimeout(250);
  const r = await m.evaluate(() => ({ bottom: Math.round(document.querySelector('.page.dash .grid2').getBoundingClientRect().bottom), h: innerHeight }));
  ok(`a window ${h}px high: once scrolled to the end the cards end inside the window with room below them`, r.bottom <= r.h - 12, JSON.stringify(r));
}
await b.close();
console.log(failed ? `\n${failed} FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
