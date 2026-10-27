// Unfinished forms are saved on the server as they are typed, even half filled. Needs the API (4000). Usage: node e2e/form-drafts.mjs
import { call, loginAll, makeDraft } from './payment-helpers.mjs';

const U = await loginAll();
let failed = 0;
const check = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : x); if (!c) failed++; };
const stamp = Date.now();

console.log('Saving a half-filled form');
const half = { bir: 'no', payee: 'Half Corner ' + stamp, amount: '', vendorTin: '12', date: '2026-10-12', spendReason: '' };
const a = await call(U.ana, 'PUT', '/form-drafts', { step: 1, data: half });
check('a form with almost nothing filled in is saved', a.s === 200 && a.d.draft.id > 0, JSON.stringify(a.d));
check('the list shows its vendor, and no amount yet', a.d.draft.vendor === 'Half Corner ' + stamp && a.d.draft.amount === null);
const id = a.d.draft.id;
const upd = await call(U.ana, 'PUT', '/form-drafts', { id, step: 2, data: { ...half, amount: '350' } });
check('saving again with its number updates the same draft', upd.s === 200 && upd.d.draft.id === id && upd.d.draft.amount === 350 && upd.d.draft.step === 2);
const get = await call(U.ana, 'GET', '/form-drafts/' + id);
check('opening it gives back every answer exactly as typed', get.s === 200 && get.d.draft.data.vendorTin === '12' && get.d.draft.data.amount === '350' && get.d.draft.step === 2, JSON.stringify(get.d));
check('it is in the list, newest first', (await call(U.ana, 'GET', '/form-drafts')).d.drafts[0].id === id);
const second = await call(U.ana, 'PUT', '/form-drafts', { step: 0, data: { bir: 'yes' } });
check('a second new form is a second draft', second.d.draft.id !== id && (await call(U.ana, 'GET', '/form-drafts')).d.drafts.length >= 2);

console.log('\nIt belongs to its owner only');
check("another person cannot open it", (await call(U.mark, 'GET', '/form-drafts/' + id)).s === 404);
check("or change it", (await call(U.mark, 'PUT', '/form-drafts', { id, step: 0, data: { payee: 'Hijack' } })).s === 404 && (await call(U.ana, 'GET', '/form-drafts/' + id)).d.draft.data.payee !== 'Hijack');
check("or delete it", (await call(U.mark, 'DELETE', '/form-drafts/' + id)).s === 200 && (await call(U.ana, 'GET', '/form-drafts/' + id)).s === 200);
check("or see it in their list", !(await call(U.mark, 'GET', '/form-drafts')).d.drafts.some((d) => d.id === id));
check('an administrator, who cannot create receipts, has no way to read it', (await call(U.admin, 'GET', '/form-drafts/' + id)).s === 403);
check('it is not a receipt: the receipt list does not have it', !(await call(U.ana, 'GET', '/receipts?q=Half%20Corner')).d.items.some((r) => r.payee.includes('Half Corner ' + stamp)));
check('without a sign-in it is refused', (await call('', 'GET', '/form-drafts')).s === 401);
check('a person who cannot create receipts has no drafts either', (await call(U.rica, 'GET', '/form-drafts')).s === 403);

console.log('\nWhat is accepted');
check('a number that is not valid is refused', (await call(U.ana, 'PUT', '/form-drafts', { step: 99, data: {} })).s === 400);
check('only text and ticks are kept (no nested objects)', (await call(U.ana, 'PUT', '/form-drafts', { step: 0, data: { payee: { a: 1 } } })).s === 400);
check('a very long answer is refused', (await call(U.ana, 'PUT', '/form-drafts', { step: 0, data: { payee: 'x'.repeat(1001) } })).s === 400);
check('odd answer names are refused', (await call(U.ana, 'PUT', '/form-drafts', { step: 0, data: { '__proto__x y': 'a' } })).s === 400);
check('a missing draft is a 404, not a crash', (await call(U.ana, 'GET', '/form-drafts/99999999')).s === 404 && (await call(U.ana, 'GET', '/form-drafts/abc')).s === 404);

console.log('\nEditing a saved receipt');
const rec = await makeDraft(U, 'ana', 'Draft Edit ' + stamp, 100);
const mine = await call(U.ana, 'PUT', '/form-drafts', { receiptId: rec.id, step: 1, data: { payee: 'Changed ' + stamp } });
check('the changes typed on a receipt are kept for that receipt', mine.s === 200 && mine.d.draft.receiptId === rec.id);
const again = await call(U.ana, 'PUT', '/form-drafts', { receiptId: rec.id, step: 1, data: { payee: 'Changed again' } });
check('there is only one draft per receipt', again.d.draft.id === mine.d.draft.id);
check("nobody else can keep changes for someone's receipt", (await call(U.mark, 'PUT', '/form-drafts', { receiptId: rec.id, step: 0, data: { payee: 'x' } })).s >= 403);
await call(U.ana, 'DELETE', '/receipts/' + rec.id);
check('deleting the receipt takes its saved changes with it', (await call(U.ana, 'GET', '/form-drafts/' + mine.d.draft.id)).s === 404);

console.log('\nDiscarding');
check('a draft can be discarded', (await call(U.ana, 'DELETE', '/form-drafts/' + id)).s === 200 && (await call(U.ana, 'GET', '/form-drafts/' + id)).s === 404);
await call(U.ana, 'DELETE', '/form-drafts/' + second.d.draft.id);

console.log(failed ? `\n${failed} FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
