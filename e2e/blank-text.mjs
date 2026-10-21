// Text that only LOOKS empty (zero-width and blank characters) must never count as an answer. A Checker could return a receipt with "Something else"
// and a note made only of invisible characters. This tries the places where a person must write something, with several kinds of blank.
// Needs the API (4000). Usage: node e2e/blank-text.mjs
import { B, H, F, call, loginAll, makeDraft, makeApproved, pay, today } from './payment-helpers.mjs';

const U = await loginAll();
let failed = 0, passed = 0;
const ok = (n, c, x = '') => { if (c) { passed++; console.log('  ok  ', n); } else { failed++; console.log('  FAIL', n, x); } };
const BLANKS = {
  'U+3164 Hangul filler': 'ㅤ'.repeat(8),
  'U+2800 Braille blank': '⠀'.repeat(8),
  'U+200B zero-width space': '​'.repeat(8),
  'U+0020 spaces': ' '.repeat(8),
  'U+00A0 no-break spaces': ' '.repeat(8),
  'a mix': ' ㅤ⠀​ ﻿‍⁠ ',
};
const view = (c, r) => fetch(`${B}/receipts/${r.id}/evidence/${r.evidence[0].id}/file?mode=view`, { headers: H(c, false) });
const submitted = async (name) => { const r = await makeDraft(U, 'ana', name, 321); return (await call(U.ana, 'POST', `/receipts/${r.id}/submit`, { version: r.version })).d.receipt; };
const state = async (c, r) => (await call(c, 'GET', `/receipts/${r.id}`)).d.receipt;
const short = (x) => `${x.s} ${JSON.stringify(x.d).slice(0, 110)}`;

console.log('A Checker returns a receipt');
const r1 = await submitted('Blank return');
await view(U.liza, r1);
for (const [name, text] of Object.entries(BLANKS)) {
  const x = await call(U.liza, 'POST', `/receipts/${r1.id}/return`, { version: r1.version, issues: ['other'], note: text });
  ok(`"Something else" with only ${name} is refused`, x.s === 400, short(x));
}
const none = await call(U.liza, 'POST', `/receipts/${r1.id}/return`, { version: r1.version, issues: [], note: BLANKS['U+3164 Hangul filler'] });
ok('no problem ticked and only blank characters is refused', none.s === 400, short(none));
ok('the receipt is still waiting to be checked after all those tries', (await state(U.liza, r1)).status === 'submitted');
const good = await call(U.liza, 'POST', `/receipts/${r1.id}/return`, { version: r1.version, issues: ['other'], note: `${BLANKS['a mix']}Photo is cut off${BLANKS['U+3164 Hangul filler']}` });
ok('a real note with blank characters around it is accepted', good.s === 200 && good.d.receipt.status === 'returned', short(good));

console.log('\nAn Approver decides');
const r2 = await submitted('Blank decide');
await view(U.liza, r2);
const checked = (await call(U.liza, 'POST', `/receipts/${r2.id}/check`, { version: r2.version })).d.receipt;
await view(U.paolo, checked);
for (const action of ['disapprove', 'reserve']) {
  for (const name of ['U+3164 Hangul filler', 'U+200B zero-width space', 'a mix']) {
    const x = await call(U.paolo, 'POST', `/receipts/${r2.id}/${action}`, { version: checked.version, note: BLANKS[name] });
    ok(`${action}: only ${name} is refused`, x.s === 400, short(x));
  }
}
ok('the receipt is still Checked', (await state(U.paolo, r2)).status === 'checked');
const hold = await call(U.paolo, 'POST', `/receipts/${r2.id}/reserve`, { version: checked.version, note: '​Waiting for the regional office' });
ok('a real hold note is accepted', hold.s === 200 && hold.d.receipt.status === 'reserved', short(hold));

console.log('\nComments');
for (const name of ['U+3164 Hangul filler', 'U+2800 Braille blank', 'a mix']) {
  const x = await call(U.liza, 'POST', `/receipts/${r2.id}/comments`, { body: BLANKS[name] });
  ok(`a comment of only ${name} is refused`, x.s === 400, short(x));
}
const c = await call(U.liza, 'POST', `/receipts/${r2.id}/comments`, { body: 'ㅤ Is this the right vendor? ㅤ' });
ok('a real comment is accepted', c.s === 200 || c.s === 201, short(c));

console.log('\nA new receipt');
for (const text of ['ㅤㅤㅤ', '​​​']) {
  const x = await call(U.ana, 'POST', '/receipts', { payee: text, receiptDate: today(), amount: 100, ...F });
  ok(`a vendor name of only blank characters (${text.codePointAt(0).toString(16)}) is refused`, x.s === 400, short(x));
}

console.log('\nPaying with a short amount');
const a = await makeApproved(U, 'ana', 'Blank pay', 100);
for (const name of ['U+3164 Hangul filler', 'U+200B zero-width space']) {
  const x = await pay(U.rica, [a], { amounts: { [a.id]: 50 }, reasons: { [a.id]: BLANKS[name] } });
  ok(`paying less with a reason of only ${name} is refused`, x.s === 400, short(x));
}
ok('the receipt is still Approved, not paid', (await state(U.rica, a)).status === 'approved');
const okPay = await pay(U.rica, [a], { amounts: { [a.id]: 50 }, reasons: { [a.id]: 'Short by agreement' } });
ok('a real reason is accepted', okPay.s === 200 || okPay.s === 201, short(okPay));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
