import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GRANTS, DEFAULT_ROLES, LOCKED_GRANTS, PERMISSIONS, RECEIPT_STATUSES, TRANSITIONS, availableActions, canEditReceipt,
  CLASSIFICATIONS, CLASSIFICATION_LABEL, classificationText, DEFAULT_SETTINGS, appSettingsSchema, changePasswordSchema, cleanFormData, makeReceiptSchema, isLockedGrant, receiptInputSchema, receiptWarnings, transitionFor,
} from '../src/index';

const perms = (...p: string[]) => new Set(p);
const names = (s: ReturnType<typeof availableActions>) => s.map((t) => t.action).sort();

describe('receipt state machine', () => {
  it('lets only the owner submit a draft or returned receipt', () => {
    expect(names(availableActions('draft', perms('receipt.create'), true))).toEqual(['submit']);
    expect(names(availableActions('returned', perms('receipt.create'), true))).toEqual(['submit']);
    expect(names(availableActions('draft', perms('receipt.create'), false))).toEqual([]);
  });

  it('lets only the owner withdraw a submitted receipt, back to draft', () => {
    expect(names(availableActions('submitted', perms('receipt.create'), true))).toEqual(['withdraw']);
    expect(availableActions('submitted', perms('receipt.create'), false)).toEqual([]);
    expect(availableActions('checked', perms('receipt.create'), true)).toEqual([]);
    expect(availableActions('approved', perms('receipt.create'), true)).toEqual([]);
    expect(transitionFor('withdraw')!.to).toBe('draft');
  });

  it('gives the checker check and return on submitted receipts only', () => {
    expect(names(availableActions('submitted', perms('review.check'), false))).toEqual(['check', 'return']);
    expect(names(availableActions('checked', perms('review.check'), false))).toEqual([]);
  });

  it('gives the approver decisions only on checked receipts', () => {
    expect(names(availableActions('checked', perms('review.decide'), false))).toEqual(['approve', 'disapprove', 'request', 'reserve']);
    expect(names(availableActions('submitted', perms('review.decide'), false))).toEqual([]);
    expect(names(availableActions('reserved', perms('review.decide'), false))).toEqual(['release']);
  });

  it('blocks reviewers from acting on a receipt they encoded', () => {
    expect(availableActions('submitted', perms('review.check'), true)).toEqual([]);
    expect(availableActions('checked', perms('review.decide'), true)).toEqual([]);
  });

  it('only lets a decision be taken back, nothing else, and it needs a reason', () => {
    const decider = perms('review.decide');
    expect(names(availableActions('approved', decider, false))).toEqual(['undo']);
    expect(names(availableActions('disapproved', decider, false))).toEqual(['undo']);
    expect(transitionFor('undo')!.note).toBe('required');
    expect(transitionFor('undo')!.to).toBe('checked');
  });

  it('requires a reason or note exactly where the plan says', () => {
    expect(transitionFor('return')!.note).toBe('required');
    expect(transitionFor('disapprove')!.note).toBe('required');
    expect(transitionFor('reserve')!.note).toBe('required');
    expect(transitionFor('approve')!.note).toBe('optional');
  });

  it('only allows editing in draft and returned', () => {
    expect(RECEIPT_STATUSES.filter(canEditReceipt)).toEqual(['draft', 'returned']);
  });

  it('only allows leaving a final status through undo, or through payment', () => {
    const out = TRANSITIONS.filter((t) => t.from.includes('approved') || t.from.includes('disapproved'));
    expect(out.map((t) => t.action)).toEqual(['undo', 'pay']);
    expect(TRANSITIONS.filter((t) => t.from.includes('disapproved')).map((t) => t.action)).toEqual(['undo']);
  });
});

describe('permissions', () => {
  it('locks the review path and administration', () => {
    expect(isLockedGrant('checker', 'review.check')).toBe(true);
    expect(isLockedGrant('approver', 'review.decide')).toBe(true);
    expect(isLockedGrant('admin', 'user.manage')).toBe(true);
    expect(isLockedGrant('medref', 'review.check')).toBe(false);
  });

  it('grants every locked permission by default', () => {
    for (const g of LOCKED_GRANTS) expect(DEFAULT_GRANTS[g.permission]).toContain(g.role);
  });

  it('never lets the super admin approve by default', () => {
    expect(DEFAULT_GRANTS['review.decide']).not.toContain('admin');
  });
});

describe('validation', () => {
  // A complete "BIR invoice: yes" answer, as the form sends it.
  const base = {
    birInvoice: 'yes', invoiceUnderCompany: 'yes', reasonForSpending: 'Clinic supplies', classification: 'fuel', seenCompany: true, seenTin: true, seenAddress: true, receiptDate: '2026-10-12', invoiceNo: 'SI-004521', payee: 'Mercury Drug',
    vendorAddress: 'Mandaue City', vendorTin: '123-456-789-00000', amount: '1120', transactionType: 'product', vatType: 'vatable', vatableAmount: '1000', vatAmount: '120', withheld: 'no',
  };
  const field = (input: object) => { const r = receiptInputSchema.safeParse(input); return r.success ? [] : r.error.issues.map((i) => String(i.path[0])); };

  it('accepts a valid receipt and rounds the amount to centavos', () => {
    expect(receiptInputSchema.parse({ ...base, amount: '10.005' }).amount).toBeCloseTo(10.01, 2);
  });

  it('needs the invoice answers when there is a BIR invoice', () => {
    expect(field(base)).toEqual([]);
    expect(field({ ...base, invoiceNo: '', vendorTin: undefined, vatableAmount: '' })).toEqual(expect.arrayContaining(['invoiceNo', 'vendorTin', 'vatableAmount']));
    expect(field({ ...base, seenTin: false })).toContain('seenTin');
    expect(field({ ...base, transactionType: '' })).toContain('transactionType');
    expect(field({ ...base, vatAmount: '0' })).toEqual([]); // zero VAT is a real answer
  });

  it('asks for the withholding numbers only when tax was withheld', () => {
    expect(field({ ...base, withheld: 'yes' })).toEqual(expect.arrayContaining(['whtRate', 'whtAmount']));
    expect(field({ ...base, withheld: 'yes', whtRate: '1', whtAmount: '10', reasonForSpending: undefined, classification: undefined })).toEqual([]);
    // ...and the ticks only matter when the invoice is under the company
    expect(field({ ...base, seenTin: false })).toContain('seenTin');
    expect(field({ ...base, invoiceUnderCompany: 'no', seenTin: false, seenCompany: false, seenAddress: false })).toEqual([]);
  });

  it('lets a receipt without a BIR invoice through only with a reason', () => {
    // The chart's short path: date, vendor, address, amount, then the reason for spending. No invoice number, TIN or type.
    const none = { birInvoice: 'no', receiptDate: '2026-10-12', payee: 'Corner Store', amount: '350' };
    expect(field(none)).toEqual(expect.arrayContaining(['vendorAddress', 'reasonForSpending', 'classification']));
    expect(field({ ...none, vendorAddress: 'Mandaue City', reasonForSpending: 'Water refills', classification: 'meal' })).toEqual([]);
    expect(field({ ...none, vendorAddress: 'Mandaue City', reasonForSpending: 'Water refills', classification: 'nonsense' })).toContain('classification');
  });

  it('drops answers that no longer apply', () => {
    const d = receiptInputSchema.parse({ ...base, withheld: 'no', whtRate: '5', whtAmount: '50' });
    expect(cleanFormData(d)).toMatchObject({ withheld: false, whtRate: null, whtAmount: null });
    const n = receiptInputSchema.parse({ birInvoice: 'no', vendorAddress: 'Mandaue City', reasonForSpending: 'Water refills', classification: 'meal', receiptDate: '2026-10-12', payee: 'Corner Store', amount: '350', transactionType: 'product', vatType: 'vatable', vatAmount: '9' });
    expect(cleanFormData(n)).toMatchObject({ birInvoice: false, vatType: null, vatAmount: null, seenCompany: null, transactionType: null, classification: 'meal' });
    // Not under the company: the three ticks are not asked and are dropped.
    expect(cleanFormData(receiptInputSchema.parse({ ...base, invoiceUnderCompany: 'no', seenCompany: false, seenTin: false, seenAddress: false }))).toMatchObject({ invoiceUnderCompany: false, seenCompany: null });
    // Tax withheld finishes the form right after, so no reason for spending is kept.
    expect(cleanFormData(receiptInputSchema.parse({ ...base, withheld: 'yes', whtRate: '2', whtAmount: '20', reasonForSpending: undefined, classification: undefined }))).toMatchObject({ withheld: true, reasonForSpending: null, classification: null });
  });

  it('warns, but does not block, when the numbers do not add up', () => {
    const ok = { birInvoice: true, amount: 1120, vendorTin: '123-456-789-00000', vatType: 'vatable', vatableAmount: 1000, vatAmount: 120, withheld: false };
    expect(receiptWarnings(ok)).toEqual([]);
    expect(receiptWarnings({ ...ok, vatAmount: 100 }).length).toBeGreaterThan(0);
    expect(receiptWarnings({ ...ok, vatType: 'non_vatable', vatAmount: 120 })[0]).toMatch(/non-vatable/i);
    expect(receiptWarnings({ ...ok, withheld: true, whtRate: 2, whtAmount: 99 })[0]).toMatch(/2%/);
    expect(receiptWarnings({ ...ok, withheld: true, whtRate: 2, whtAmount: 20 })).toEqual([]);
    expect(receiptWarnings({ ...ok, vendorTin: 'abc' })[0]).toMatch(/TIN/);
    expect(receiptWarnings({ birInvoice: false, amount: 350 })).toEqual([]);
  });

  it('follows the administrator settings', () => {
    const rules = { ...DEFAULT_SETTINGS, allowNoBir: false, requireVendorTin: false, askWithholding: false, vatRate: 10 };
    const f = (input: object, r = rules) => { const x = makeReceiptSchema(r).safeParse(input); return x.success ? [] : x.error.issues.map((i) => String(i.path[0])); };
    expect(f({ birInvoice: 'no', receiptDate: '2026-10-12', payee: 'Corner', amount: '350', vendorAddress: 'Mandaue', reasonForSpending: 'Water', classification: 'meal' })).toEqual(['birInvoice']);
    expect(f({ ...base, vendorTin: undefined, withheld: undefined })).toEqual([]);
    expect(f({ ...base, vendorTin: undefined }, DEFAULT_SETTINGS)).toContain('vendorTin');
    const okVat = { birInvoice: true, amount: 1100, vatType: 'vatable', vatableAmount: 1000, vatAmount: 100 };
    expect(receiptWarnings(okVat, rules)).toEqual([]);
    expect(receiptWarnings(okVat).length).toBeGreaterThan(0); // 12% is the default, so 100 on 1,000 is flagged
    expect(receiptWarnings({ ...okVat, vatAmount: 100.5 }, { ...rules, tolerance: 1 })).toEqual([]);
    expect(cleanFormData(receiptInputSchema.parse({ ...base, withheld: 'yes', whtRate: '2', whtAmount: '20' }), rules)).toMatchObject({ withheld: false, whtRate: null });
  });

  it('refuses nonsense settings', () => {
    expect(appSettingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
    expect(appSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, vatRate: 'abc' }).success).toBe(false);
    expect(appSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, sessionIdleMinutes: 1 }).success).toBe(false);
    expect(appSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, evidenceMaxMb: 500 }).success).toBe(false);
    expect(appSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, evidenceMaxFiles: 0 }).success).toBe(false);
  });

  it('matches the client form for the classification, with words for "Other"', () => {
    expect(CLASSIFICATIONS.map((c) => CLASSIFICATION_LABEL[c])).toEqual(['Fuel', 'Meeting, Seminar, or Convention', 'Representation', 'Transportation', 'Parking', 'Printing or Photocopying', 'Meal', 'Other']);
    expect(field({ ...base, classification: 'other' })).toContain('classificationOther');
    expect(field({ ...base, classification: 'other', classificationOther: 'Team building' })).toEqual([]);
    expect(cleanFormData(receiptInputSchema.parse({ ...base, classification: 'meal', classificationOther: 'leftover' }))).toMatchObject({ classification: 'meal', classificationOther: null });
    expect(classificationText('other', 'Team building')).toBe('Other: Team building');
    expect(classificationText('meeting')).toBe('Meeting, Seminar, or Convention');
  });

  it('rejects zero, negative and future-dated receipts', () => {
    expect(receiptInputSchema.safeParse({ ...base, amount: 0 }).success).toBe(false);
    expect(receiptInputSchema.safeParse({ ...base, amount: -5 }).success).toBe(false);
    expect(receiptInputSchema.safeParse({ ...base, receiptDate: '2999-01-01' }).success).toBe(false);
    expect(receiptInputSchema.safeParse({ ...base, receiptDate: '12/10/2026' }).success).toBe(false);
  });

  it('enforces the password policy', () => {
    const t = (p: string) => changePasswordSchema.safeParse({ currentPassword: 'x', newPassword: p }).success;
    expect(t('short1')).toBe(false);
    expect(t('nonumbersatall')).toBe(false);
    expect(t('12345678')).toBe(false);
    expect(t('Cebu-Blue-River7')).toBe(true);
    expect(t('Reimbursed2026')).toBe(true);
  });

  it('asks for at least ten characters', () => {
    const t = (p: string) => changePasswordSchema.safeParse({ currentPassword: 'x', newPassword: p }).success;
    expect(t('Abcdefgh1')).toBe(false); // nine
    expect(t('Abcdefghi1')).toBe(true); // ten
  });

  it('refuses the passwords attackers try first, including the public demo one', () => {
    const t = (p: string) => changePasswordSchema.safeParse({ currentPassword: 'x', newPassword: p }).success;
    for (const p of ['Password123456', 'password2026', 'Qwerty123456', 'Welcome2026!', 'Reimsis#2026', 'Reimsys#2026', 'Reimsys2026', 'Changeme12345', 'Admin12345678', 'aaaaaaaaaa1', '1234567890a', 'Pharmacy2026']) {
      expect(t(p), p).toBe(false);
    }
  });

  it('does not refuse an ordinary strong password that merely contains a common word', () => {
    const t = (p: string) => changePasswordSchema.safeParse({ currentPassword: 'x', newPassword: p }).success;
    expect(t('Purple-Welcome-Mat-88')).toBe(true);
    expect(t('Dragonfruit-Smoothie5')).toBe(true);
  });
});

describe('payment step', () => {
  it('gives Accounting pay on approved receipts and reverse on paid ones, never on their own', () => {
    expect(names(availableActions('approved', perms('payment.mark'), false))).toEqual(['pay']);
    expect(names(availableActions('paid', perms('payment.mark'), false))).toEqual(['reverse_payment']);
    expect(availableActions('approved', perms('payment.mark'), true)).toEqual([]);
    expect(availableActions('paid', perms('payment.mark'), true)).toEqual([]);
    for (const s of ['draft', 'submitted', 'returned', 'checked', 'disapproved', 'reserved'] as const) {
      expect(availableActions(s, perms('payment.mark'), false), s).toEqual([]);
    }
  });

  it('moves approved to paid and back, and a reversal needs a reason', () => {
    expect(transitionFor('pay')).toMatchObject({ from: ['approved'], to: 'paid', permission: 'payment.mark', note: 'none' });
    expect(transitionFor('reverse_payment')).toMatchObject({ from: ['paid'], to: 'approved', permission: 'payment.mark', note: 'required' });
  });

  it('keeps the approver from taking a decision back once it is paid', () => {
    const decider = perms('review.decide');
    expect(names(availableActions('paid', decider, false))).toEqual([]);
    expect(names(availableActions('approved', decider, false))).toEqual(['undo']);
  });

  it('makes Paid final: it cannot be edited and has no way out except a reversal', () => {
    expect(canEditReceipt('paid')).toBe(false);
    expect(TRANSITIONS.filter((t) => t.from.includes('paid')).map((t) => t.action)).toEqual(['reverse_payment']);
  });

  it('has an Accounting role that alone can mark paid, and the Super Admin cannot by default', () => {
    expect(DEFAULT_ROLES.find((r) => r.code === 'accounting')).toEqual({ code: 'accounting', name: 'Accounting', rank: 25 });
    expect(DEFAULT_GRANTS['payment.mark']).toEqual(['accounting']);
    expect(isLockedGrant('accounting', 'payment.mark')).toBe(true);
    expect(DEFAULT_GRANTS['payment.mark']).not.toContain('admin');
    for (const p of ['evidence.view', 'evidence.download', 'evidence.print', 'report.generate']) expect(DEFAULT_GRANTS[p], p).toContain('accounting');
    expect(PERMISSIONS.find((p) => p.code === 'payment.mark')).toMatchObject({ group: 'Payments' });
  });
});
