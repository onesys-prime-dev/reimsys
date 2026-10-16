// Checks the export of payments for the accountant. Needs the API (4000). Usage: node e2e/payment-export.mjs
import { B, H, call, checker, loginAll, makeApproved, pay, today } from './payment-helpers.mjs';

const { ok, done } = checker();
const U = await loginAll();
const get = (c, qs) => fetch(`${B}/payments/export?${qs}`, { headers: H(c, false) });

const r1 = await makeApproved(U, 'ana', 'Export one', 410.5);
const r2 = await makeApproved(U, 'mark', 'Export two', 99);
const p1 = (await pay(U.rica, [r1], { method: 'E-wallet' })).d.payment;
const p2 = (await pay(U.rica, [r2], { amounts: { [r2.id]: 90 }, reasons: { [r2.id]: 'Short on purpose' }, paidOn: today() })).d.payment;

const res = await get(U.rica, `from=${today()}&to=${today()}`);
const csv = await res.text();
ok('Accounting can export payments as CSV', res.status === 200 && (res.headers.get('content-type') ?? '').includes('text/csv'));
const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
ok('the header names the columns the accountant needs', ['Payment no.', 'Paid on', 'Method', 'Paid to', 'Receipt ref.', 'Vendor', 'Amount paid'].every((h) => lines[0].includes(h)));
const row1 = lines.find((l) => l.includes(r1.refNo));
const row2 = lines.find((l) => l.includes(r2.refNo));
ok('each paid receipt is one row with its payment number and method', !!row1 && row1.includes(p1.paymentNo) && row1.includes('E-wallet'));
ok('the amount paid and the short reason are there', !!row2 && row2.includes('90') && row2.includes('Short on purpose'));
ok('the payee is named', !!row1 && row1.includes('Ana Reyes'));

const none = await (await get(U.rica, 'from=2001-01-01&to=2001-01-02')).text();
ok('a period with no payments gives just the header', none.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean).length === 1);
const x = await get(U.rica, `from=${today()}&to=${today()}&format=xlsx`);
ok('the Excel file is real', x.status === 200 && (x.headers.get('content-type') ?? '').includes('spreadsheetml') && (await x.arrayBuffer()).byteLength > 1000);

ok('a Med Ref cannot export payments', (await get(U.ana, `from=${today()}&to=${today()}`)).status === 403);
ok('dates are required', (await get(U.rica, '')).status === 400);
ok('a backwards period is refused', (await get(U.rica, `from=${today()}&to=2001-01-01`)).status === 400);
ok('a made-up date is refused', (await get(U.rica, 'from=2026-13-45&to=2026-14-01')).status === 400);
ok('the export is recorded in the history', (await call(U.admin, 'GET', '/audit?q=exported')).s === 200);
done();
