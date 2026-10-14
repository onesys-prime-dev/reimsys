import fs from 'node:fs';
let s = fs.readFileSync('e2e/api-flow.mjs', 'utf8');
const c = "console.log('\nDashboard and audit');";
if (!s.includes(c)) throw new Error('anchor');
s = s.replace(c, `{ const get = async (q) => (await liza.get('/receipts?pageSize=50&' + q)).data.items;
  const hi = await get('sort=amount_high'), lo = await get('sort=amount_low'), nw = await get('sort=newest'), old = await get('sort=oldest');
  const sorted = (a, f, dir) => a.every((x, i) => i === 0 || (dir > 0 ? f(a[i - 1]) >= f(x) : f(a[i - 1]) <= f(x)));
  check('list sorts by amount, high to low', hi.length > 1 && sorted(hi, (x) => x.amount, 1));
  check('list sorts by amount, low to high', sorted(lo, (x) => x.amount, -1));
  check('list sorts by receipt date, newest first', sorted(nw, (x) => x.receiptDate, 1));
  check('list sorts by receipt date, oldest first', sorted(old, (x) => x.receiptDate, -1));
  check('an unknown sort is refused', (await liza.get('/receipts?sort=bogus')).status === 400); }

` + c);
fs.writeFileSync('e2e/api-flow.mjs', s);
