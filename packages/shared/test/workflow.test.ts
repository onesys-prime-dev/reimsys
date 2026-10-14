import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GRANTS, LOCKED_GRANTS, PERMISSIONS, RECEIPT_STATUSES, TRANSITIONS, availableActions, canEditReceipt,
  changePasswordSchema, cleanFormData, isLockedGrant, receiptInputSchema, receiptWarnings, transitionFor,
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
    const all = perms(...PERMISSIONS.map((p) => p.code));
    expect(names(availableActions('approved', all, false))).toEqual(['undo']);
    expect(names(availableActions('disapproved', all, false))).toEqual(['undo']);
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

  it('only allows leaving a final status through undo', () => {
    const out = TRANSITIONS.filter((t) => t.from.includes('approved') || t.from.includes('disapproved'));
    expect(out.map((t) => t.action)).toEqual(['undo']);
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
    birInvoice: 'yes', seenCompany: true, seenTin: true, seenAddress: true, receiptDate: '2026-10-12', invoiceNo: 'SI-004521', payee: 'Mercury Drug',
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
    expect(field({ ...base, withheld: 'yes', whtRate: '1', whtAmount: '10' })).toEqual([]);
  });

  it('lets a receipt without a BIR invoice through only with a reason', () => {
    const none = { birInvoice: 'no', receiptDate: '2026-10-12', payee: 'Corner Store', amount: '350', transactionType: 'service' };
    expect(field(none)).toEqual(['noBirReason']);
    expect(field({ ...none, noBirReason: 'Only an acknowledgement receipt' })).toEqual([]);
  });

  it('drops answers that no longer apply', () => {
    const d = receiptInputSchema.parse({ ...base, withheld: 'no', whtRate: '5', whtAmount: '50' });
    expect(cleanFormData(d)).toMatchObject({ withheld: false, whtRate: null, whtAmount: null });
    const n = receiptInputSchema.parse({ birInvoice: 'no', noBirReason: 'No registered invoice', receiptDate: '2026-10-12', payee: 'Corner Store', amount: '350', transactionType: 'product', vatType: 'vatable', vatAmount: '9' });
    expect(cleanFormData(n)).toMatchObject({ birInvoice: false, vatType: null, vatAmount: null, seenCompany: null });
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
