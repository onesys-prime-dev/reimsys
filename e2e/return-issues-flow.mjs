// Checks sending a receipt back with ticked problems, through the API. Needs the API (4000) and the seed applied.
// Usage: node e2e/return-issues-flow.mjs
import { B, H, call, checker, loginAll, makeDraft } from './payment-helpers.mjs';

const { ok, done } = checker();
const U = await loginAll();
const code = (r) => r.d?.error?.code;
const view = (c, r) => call(c, 'GET', `/receipts/${r.id}`);
/** Opens the receipt's evidence as this person: reviewers must do this before they can check, return or decide. */
const look = (c, r) => fetch(`${B}/receipts/${r.id}/evidence/${r.evidence[0].id}/file?mode=view`, { headers: H(c, false) });
/** A receipt Ana has submitted (a draft with a photo, then submitted). */
const submitted = async (name) => {
  const r = await makeDraft(U, 'ana', name, 410);
  return (await call(U.ana, 'POST', `/receipts/${r.id}/submit`, { version: r.version })).d.receipt;
};
/** A submitted receipt whose evidence the Checker has opened, ready to be sent back. */
const ready = async (name) => { const r = await submitted(name); await look(U.liza, r); return r; };

console.log('Returning with ticks');
const a = await ready('Return A');
ok('returning with nothing ticked and no note is still refused', code(await call(U.liza, 'POST', `/receipts/${a.id}/return`, { version: a.version })) === 'NOTE_REQUIRED');
ok('"Something else" alone needs a note', code(await call(U.liza, 'POST', `/receipts/${a.id}/return`, { version: a.version, issues: ['other'] })) === 'NOTE_REQUIRED');
ok('"Something else" with another tick still needs a note', code(await call(U.liza, 'POST', `/receipts/${a.id}/return`, { version: a.version, issues: ['photo_unclear', 'other'] })) === 'NOTE_REQUIRED');
ok('an unknown problem is refused', (await call(U.liza, 'POST', `/receipts/${a.id}/return`, { version: a.version, issues: ['made_up'] })).s === 400);
const sent = await call(U.liza, 'POST', `/receipts/${a.id}/return`, { version: a.version, issues: ['photo_unclear', 'amount_wrong'] });
ok('ticks alone are enough to return a receipt', sent.s === 200 && sent.d.receipt.status === 'returned');
const mine = (await view(U.ana, a)).d.receipt;
ok('the Med Ref gets the ticked problems, in order', JSON.stringify(mine.returnIssues) === JSON.stringify(['photo_unclear', 'amount_wrong']));
ok('there is no typed note, so no stray text', mine.lastNote === null);
const notes = (await call(U.ana, 'GET', '/notifications')).d.items;
ok('the notice reads as a sentence with the ticked problems', notes.some((n) => n.text.includes('was returned') && n.text.includes('Photo is blurry, cut off or hard to read; Amount does not match the receipt') && !n.text.includes('undefined')));
const hist = (await call(U.liza, 'GET', `/receipts/${a.id}/history`)).d.items.find((h) => h.action === 'receipt.return');
ok('the history shows the problems', !!hist && !!hist.note && hist.note.includes('Amount does not match the receipt'));
const mails = (await call(U.admin, 'GET', '/email-log')).d.items;
ok('the Med Ref was emailed', mails.some((e) => e.template === 'returned' && e.to === 'ana.reyes@example.com' && e.subject.includes(a.refNo)));

console.log('Returning with ticks and a note');
const b = await ready('Return B');
const withNote = await call(U.liza, 'POST', `/receipts/${b.id}/return`, { version: b.version, issues: ['vendor_wrong', 'other'], note: 'The TIN is cut off.' });
ok('ticks plus a note work, with "Something else" carried by the note', withNote.s === 200);
const bd = (await view(U.ana, b)).d.receipt;
ok('both are kept: problems and note', bd.returnIssues.includes('vendor_wrong') && bd.lastNote === 'The TIN is cut off.');
const bn = (await call(U.ana, 'GET', '/notifications')).d.items;
ok('"Something else" is not printed, the note is', bn.some((n) => n.text.includes('Vendor name, address or TIN is missing or wrong. The TIN is cut off.') && !n.text.includes('Something else')));

console.log('The order does not depend on which was clicked first');
const o = await ready('Return Order');
const backwards = await call(U.liza, 'POST', `/receipts/${o.id}/return`, { version: o.version, issues: ['amount_wrong', 'photo_unclear'] });
ok('problems are saved in the order of the list, not the order they were ticked', backwards.s === 200 && JSON.stringify((await view(U.ana, o)).d.receipt.returnIssues) === JSON.stringify(['photo_unclear', 'amount_wrong']));

console.log('Only a note, as before');
const c = await ready('Return C');
ok('a note alone still works', (await call(U.liza, 'POST', `/receipts/${c.id}/return`, { version: c.version, note: 'Please retake the photo.' })).s === 200);
const cd = (await view(U.ana, c)).d.receipt;
ok('and no problems are saved', cd.returnIssues.length === 0 && cd.lastNote === 'Please retake the photo.');

console.log('Starting again clears the old problems');
const resub = await call(U.ana, 'POST', `/receipts/${a.id}/submit`, { version: mine.version });
ok('resubmitting clears the problems and the note', resub.s === 200 && resub.d.receipt.returnIssues.length === 0 && resub.d.receipt.lastNote === null);
await look(U.liza, resub.d.receipt);
const second = await call(U.liza, 'POST', `/receipts/${a.id}/return`, { version: resub.d.receipt.version, note: 'Still not right.' });
ok('a second return with only a note replaces the old problems instead of keeping them', second.s === 200 && (await view(U.ana, a)).d.receipt.returnIssues.length === 0);
const resub2 = await call(U.ana, 'POST', `/receipts/${a.id}/submit`, { version: (await view(U.ana, a)).d.receipt.version });
await look(U.liza, resub2.d.receipt);
const fourth = await call(U.liza, 'POST', `/receipts/${a.id}/return`, { version: resub2.d.receipt.version, issues: ['date_wrong'] });
ok('and a later return with a different tick shows only that one', fourth.s === 200 && JSON.stringify((await view(U.ana, a)).d.receipt.returnIssues) === JSON.stringify(['date_wrong']));
const resub3 = await call(U.ana, 'POST', `/receipts/${a.id}/submit`, { version: (await view(U.ana, a)).d.receipt.version });
const withdrawn = await call(U.ana, 'POST', `/receipts/${a.id}/withdraw`, { version: resub3.d.receipt.version });
ok('withdrawing leaves no problems behind', withdrawn.s === 200 && withdrawn.d.receipt.returnIssues.length === 0);

console.log('The approver asking for more proof');
const e = await submitted('Return E');
await look(U.liza, e);
const checked = await call(U.liza, 'POST', `/receipts/${e.id}/check`, { version: e.version });
await look(U.paolo, e);
const asked = await call(U.paolo, 'POST', `/receipts/${e.id}/request`, { version: checked.d.receipt.version, issues: ['photo_wrong'] });
ok('"ask for more proof" accepts ticks too', asked.s === 200 && JSON.stringify((await view(U.ana, e)).d.receipt.returnIssues) === JSON.stringify(['photo_wrong']));
const f = await submitted('Return F');
await look(U.liza, f);
ok('problems are only accepted when sending a receipt back', code(await call(U.liza, 'POST', `/receipts/${f.id}/check`, { version: f.version, issues: ['photo_unclear'] })) === 'ISSUES_NOT_ALLOWED');

console.log('Who can see what');
ok('another Med Ref cannot see the receipt at all', (await view(U.mark, b)).s === 404);
const asChecker = (await view(U.liza, b)).d.receipt;
ok('the Checker sees the problems (as text, no edit rights)', asChecker.returnIssues.includes('vendor_wrong') && asChecker.canEdit === false);

// BL-06: a receipt without a BIR invoice has no invoice number, VAT or withholding, so those problems cannot be picked for it
const n = await ready('Return no BIR');
for (const bad of ['invoice_no_wrong', 'vat_wrong']) {
  const x = await call(U.liza, 'POST', `/receipts/${n.id}/return`, { version: n.version, issues: [bad] });
  ok(`"${bad}" is refused on a receipt without a BIR invoice`, x.s === 400 && code(x) === 'ISSUE_NOT_APPLICABLE', `${x.s} ${code(x)}`);
}
const fine = await call(U.liza, 'POST', `/receipts/${n.id}/return`, { version: n.version, issues: ['vendor_wrong'] });
ok('a problem that does apply is still accepted', fine.s === 200, String(fine.s));

// BL-07: the same for the Approver's "Ask for more proof"
const q = await ready('Request no BIR');
const qc = (await call(U.liza, 'POST', `/receipts/${q.id}/check`, { version: q.version })).d.receipt;
await look(U.paolo, qc);
for (const bad of ['invoice_no_wrong', 'vat_wrong']) {
  const x = await call(U.paolo, 'POST', `/receipts/${q.id}/request`, { version: qc.version, issues: [bad] });
  ok(`the Approver cannot ask for more proof about "${bad}" on a receipt without a BIR invoice`, x.s === 400 && code(x) === 'ISSUE_NOT_APPLICABLE', `${x.s} ${code(x)}`);
}
// BL-08: the Approver cannot disapprove with a reason that only looks empty
const blank = await call(U.paolo, 'POST', `/receipts/${q.id}/disapprove`, { version: qc.version, note: 'ㅤ⠀​  ' });
ok('disapproving with only blank characters is refused', blank.s === 400 && code(blank) === 'NOTE_REQUIRED', `${blank.s} ${code(blank)}`);

// END OF CHECKS
done();
