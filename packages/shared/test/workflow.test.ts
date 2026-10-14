import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GRANTS, LOCKED_GRANTS, PERMISSIONS, RECEIPT_STATUSES, TRANSITIONS, availableActions, canEditReceipt,
  changePasswordSchema, isLockedGrant, receiptInputSchema, transitionFor,
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
  const base = { payee: 'Mercury Drug', receiptDate: '2026-10-12', amount: '1284.5', categoryId: 1 };

  it('accepts a valid receipt and rounds the amount to centavos', () => {
    expect(receiptInputSchema.parse({ ...base, amount: '10.005' }).amount).toBeCloseTo(10.01, 2);
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
    expect(t('Reimsis2026')).toBe(true);
  });
});
