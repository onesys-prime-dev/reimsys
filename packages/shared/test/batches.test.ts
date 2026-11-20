import { describe, expect, it } from 'vitest';
import {
  BATCH_MAX, BULK_MAX, DEFAULT_GRANTS, PERMISSIONS, RECEIPT_STATUSES, batchActionSchema, batchAddSchema, batchCreateSchema, batchDoneText, batchLabel, batchListQuerySchema,
  batchPaySchema, batchUpdateSchema, batchWaitingText, canAddToBatch, canRemoveFromBatch, canViewBatches, listQuerySchema, paymentRequestSchema, reportRequestSchema,
} from '../src/index';

const line = (receiptId: number) => ({ receiptId, version: 0, amount: 10, shortReason: null });

describe('which receipts can be in a batch', () => {
  it('takes submitted receipts up to approved, never drafts or finished ones', () => {
    const can = RECEIPT_STATUSES.filter(canAddToBatch);
    expect(can).toEqual(['submitted', 'returned', 'checked', 'approved', 'reserved']);
    expect(canAddToBatch('draft')).toBe(false);
    expect(canAddToBatch('paid')).toBe(false);
    expect(canAddToBatch('disapproved')).toBe(false);
  });
  it('keeps a paid receipt in its batch; anything else can be taken out', () => {
    expect(canRemoveFromBatch('paid')).toBe(false);
    for (const s of RECEIPT_STATUSES.filter((x) => x !== 'paid')) expect(canRemoveFromBatch(s)).toBe(true);
  });
});

describe('who works with batches', () => {
  it('Accounting and both admin roles make batches by default', () => {
    expect(PERMISSIONS.some((p) => p.code === 'batch.manage')).toBe(true);
    expect(DEFAULT_GRANTS['batch.manage']).toEqual(['accounting', 'manager', 'admin']);
  });
  it('the batch pages are for those who make batches or act on receipts, not Med Refs', () => {
    expect(canViewBatches(new Set(['receipt.create', 'report.generate']))).toBe(false);
    for (const p of ['batch.manage', 'review.check', 'review.decide', 'payment.mark']) expect(canViewBatches(new Set([p]))).toBe(true);
    expect(canViewBatches((c: string) => c === 'review.check')).toBe(true);
  });
});

describe('batch requests', () => {
  it('a name is optional, and an empty one means none', () => {
    expect(batchCreateSchema.parse({}).name).toBeNull();
    expect(batchCreateSchema.parse({ name: '  ' }).name).toBeNull();
    expect(batchCreateSchema.parse({ name: ' Pasig week 3 ' }).name).toBe('Pasig week 3');
    expect(batchCreateSchema.safeParse({ name: 'x'.repeat(81) }).success).toBe(false);
  });
  it('a change needs something to change; clearing the name is allowed', () => {
    expect(batchUpdateSchema.safeParse({}).success).toBe(false);
    expect(batchUpdateSchema.parse({ name: '' }).name).toBeNull();
    expect(batchUpdateSchema.parse({ closed: true })).toEqual({ closed: true });
  });
  it(`adds 1 to ${BATCH_MAX} receipts at a time, by id`, () => {
    expect(batchAddSchema.safeParse({ receiptIds: [] }).success).toBe(false);
    expect(batchAddSchema.safeParse({ receiptIds: Array.from({ length: BATCH_MAX }, (_, i) => i + 1) }).success).toBe(true);
    expect(batchAddSchema.safeParse({ receiptIds: Array.from({ length: BATCH_MAX + 1 }, (_, i) => i + 1) }).success).toBe(false);
    expect(batchAddSchema.safeParse({ receiptIds: [0] }).success).toBe(false);
    expect(batchAddSchema.safeParse({ receiptIds: [2_147_483_648] }).success).toBe(false);
  });
  it('only checking and approving run on a whole batch (paying has its own form)', () => {
    expect(batchActionSchema.safeParse({ action: 'check' }).success).toBe(true);
    expect(batchActionSchema.safeParse({ action: 'approve', note: 'ok' }).success).toBe(true);
    for (const action of ['pay', 'disapprove', 'return', 'submit']) expect(batchActionSchema.safeParse({ action }).success).toBe(false);
  });
  it('a batch can be paid in one go, past the limit of the plain payment form', () => {
    const many = Array.from({ length: BULK_MAX + 1 }, (_, i) => line(i + 1));
    const base = { method: 'Cash', paidOn: '2026-11-01' };
    expect(paymentRequestSchema.safeParse({ ...base, lines: many }).success).toBe(false);
    expect(batchPaySchema.safeParse({ ...base, lines: many }).success).toBe(true);
    expect(batchPaySchema.safeParse({ ...base, lines: Array.from({ length: BATCH_MAX + 1 }, (_, i) => line(i + 1)) }).success).toBe(false);
    expect(batchPaySchema.safeParse({ ...base, paidOn: '2026-02-31', lines: [line(1)] }).success).toBe(false);
  });
  it('lists open batches unless asked otherwise', () => {
    expect(batchListQuerySchema.parse({}).state).toBe('open');
    expect(batchListQuerySchema.safeParse({ state: 'deleted' }).success).toBe(false);
  });
  it('lists and reports can be limited to one batch', () => {
    expect(listQuerySchema.parse({ batchId: '4' }).batchId).toBe(4);
    expect(listQuerySchema.safeParse({ batchId: 'x' }).success).toBe(false);
    expect(reportRequestSchema.parse({ from: '2026-11-01', to: '2026-11-30', format: 'pdf', batchId: 4 }).batchId).toBe(4);
    expect(reportRequestSchema.parse({ from: '2026-11-01', to: '2026-11-30', format: 'pdf' }).batchId).toBeUndefined();
  });
});

describe('batch wording', () => {
  it('names a batch by its code, and its name when it has one', () => {
    expect(batchLabel({ code: 'B-2026-000004', name: null })).toBe('B-2026-000004');
    expect(batchLabel({ code: 'B-2026-000004', name: 'Pasig week 3' })).toBe('B-2026-000004 · Pasig week 3');
  });
  it('counts what was done in plain words', () => {
    expect(batchDoneText('check', 1)).toBe('1 receipt was checked');
    expect(batchDoneText('approve', 3)).toBe('3 receipts were approved');
  });
  it('says what is waiting, leaving out steps with nothing', () => {
    expect(batchWaitingText({ check: 3, pay: 0, approve: 2 })).toBe('3 to check · 2 to decide');
    expect(batchWaitingText({ pay: 0 })).toBe('');
  });
});
