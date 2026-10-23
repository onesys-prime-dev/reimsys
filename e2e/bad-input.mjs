// Hostile and nonsense input to every write, as every kind of user, must be refused politely: never a 500, never a stack trace.
// (Found by the full scan: a huge id in "mark notifications read" crashed the server.) Needs the API (4000) and the seed applied.
import { B, H, checker, loginAll } from './payment-helpers.mjs';
const { ok, done } = checker();
const U = await loginAll();
const long = 'A'.repeat(200_000);
const bodies = [{}, [], null, 'str', { text: long, note: long, name: long, payee: long, email: long }, { id: -1, version: -1, amount: -5, text: '\u0000', note: "'; DROP TABLE users;--" }, { version: 'abc', amount: 'NaN', issues: 'x', ids: 'x' }, { amount: 1e309, version: 1e309 }, { issues: [null, {}, 7], ids: [null, 'a', {}, 1e99], receiptId: 1e99, lines: 5 }];
// Ids point at nothing, so a write that slips through changes no real record.
const writes = [['POST', '/receipts'], ['PATCH', '/receipts/999999'], ['DELETE', '/receipts/999999'], ...['submit', 'check', 'return', 'approve', 'request', 'disapprove', 'reserve', 'comments', 'copy'].map((a) => ['POST', `/receipts/999999/${a}`]), ['POST', '/receipts/bulk'], ['PATCH', '/me'], ['PATCH', '/me/preferences'], ['POST', '/me/privacy'], ['POST', '/notifications/read'], ['POST', '/payments'], ['POST', '/reports'], ['POST', '/imports'], ['POST', '/imports/999999/confirm'], ['POST', '/users'], ['PATCH', '/users/999999'], ['POST', '/roles'], ['PATCH', '/roles/999999'], ['PUT', '/roles/999999/permissions'], ['POST', '/auth/forgot'], ['POST', '/auth/reset'], ['POST', '/email-log/999999/retry']];
let bad = 0;
for (const who of ['ana', 'liza', 'paolo', 'rica', 'admin']) for (const [m, p] of writes) for (const b of bodies) {
  const r = await fetch(B + p, { method: m, headers: H(U[who]), body: JSON.stringify(b) });
  const t = await r.text();
  if (r.status >= 500 || /node_modules|PrismaClient|SQLSTATE|\s+at\s+\S+\s+\(/.test(t)) { bad++; console.log('   ', who, m, p, r.status, t.slice(0, 100)); }
}
ok(`no 500 or leaked internals across ${5 * writes.length * bodies.length} hostile requests`, bad === 0, `${bad} bad`);
for (const bad2 of ['abc', '-1', '1e9', '99999999999999999999', '%00', '..%2f..%2fetc']) for (const base of ['/receipts/', '/users/', '/reports/', '/payments/', '/roles/']) {
  const r = await fetch(B + base + bad2, { headers: H(U.admin) });
  ok(`GET ${base}${bad2} is refused, not a crash`, r.status < 500, String(r.status));
}
done();
