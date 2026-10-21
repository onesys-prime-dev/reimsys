// The total at the foot of the Receipts list: it must equal the sum of ALL matching receipts (every page), for every filter, and a person
// must only ever be counted for what they are allowed to see. Needs the API (4000). Usage: node e2e/list-total.mjs
const API = process.env.API ?? 'http://localhost:4000/api';
let failed = 0, passed = 0;
const check = (n, c, x = '') => { if (c) { passed++; console.log('  ok  ', n); } else { failed++; console.log('  FAIL', n, x); } };
const call = async (cookie, p) => { const r = await fetch(API + p, { headers: { 'x-requested-with': 'reimsys', cookie } }); return { s: r.status, d: await r.json().catch(() => null), cookie: r.headers.get('set-cookie')?.split(';')[0] }; };
const login = async (email) => { const r = await fetch(API + '/auth/login', { method: 'POST', headers: { 'x-requested-with': 'reimsys', 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'Reimsys#2026' }) }); return r.headers.get('set-cookie').split(';')[0]; };
const cents = (n) => Math.round(n * 100);

/** Adds up every page of a list by hand. */
async function addUp(cookie, qs) {
  let sum = 0, count = 0;
  for (let page = 1; page < 200; page++) {
    const r = await call(cookie, `/receipts?${qs}&page=${page}&pageSize=100`);
    if (r.s !== 200) throw new Error(`list failed: ${r.s}`);
    for (const it of r.d.items) { sum += cents(it.amount); count++; }
    if (page * 100 >= r.d.total) break;
  }
  return { sum, count };
}

const people = { admin: 'admin@example.com', liza: 'liza.santos@example.com', ana: 'ana.reyes@example.com', mark: 'mark.dc@example.com', rica: 'accounting@example.com' };
const cookies = {};
for (const [k, e] of Object.entries(people)) cookies[k] = await login(e);

for (const [who, qs] of [['liza', ''], ['liza', 'status=submitted'], ['liza', 'status=approved'], ['liza', 'q=a'], ['ana', ''], ['ana', 'status=paid'], ['mark', ''], ['rica', 'status=approved'], ['admin', 'sort=amount_high']]) {
  const head = await call(cookies[who], `/receipts?${qs}&page=1&pageSize=1`);
  const hand = await addUp(cookies[who], qs);
  check(`${who} ${qs || 'all receipts'}: the foot total (${head.d.totalAmount}) equals the sum of all ${hand.count} receipts by hand`, head.s === 200 && head.d.total === hand.count && cents(head.d.totalAmount) === hand.sum, JSON.stringify({ total: head.d.total, hand }));
}

const none = await call(cookies.ana, '/receipts?q=zzzz-nothing-matches-this&page=1&pageSize=1');
check('a search with no matches has a total of zero', none.d.total === 0 && none.d.totalAmount === 0, JSON.stringify(none.d).slice(0, 120));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
