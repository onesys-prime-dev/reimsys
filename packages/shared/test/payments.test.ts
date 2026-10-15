import { describe, expect, it } from 'vitest';
import { DEFAULT_PAYMENT_METHODS, PAYMENT_FILTER_LABEL, paymentIssues, paymentLineSchema, paymentMethodsSchema, paymentRequestSchema, reportRequestSchema, totalOf } from '../src/index';

const amounts = (...p: [number, number][]) => new Map(p);
const line = (receiptId: number, amount: number, shortReason: string | null = null) => ({ receiptId, amount, shortReason });
const codes = (r: ReturnType<typeof paymentIssues>) => r.map((i) => i.code);

describe('payment methods', () => {
  it('starts with the four methods from the spec', () => {
    expect(DEFAULT_PAYMENT_METHODS).toEqual(['Bank transfer', 'Cheque', 'Cash', 'E-wallet']);
  });
  it('needs at least one method, no blanks, no repeats (ignoring case)', () => {
    expect(paymentMethodsSchema.safeParse({ methods: [] }).success).toBe(false);
    expect(paymentMethodsSchema.safeParse({ methods: ['Cash', ' '] }).success).toBe(false);
    expect(paymentMethodsSchema.safeParse({ methods: ['Cash', 'cash'] }).success).toBe(false);
    expect(paymentMethodsSchema.safeParse({ methods: Array.from({ length: 13 }, (_, i) => 'M' + i) }).success).toBe(false);
    expect(paymentMethodsSchema.parse({ methods: [' Cash ', 'GCash'] }).methods).toEqual(['Cash', 'GCash']);
  });
});

describe('payment lines', () => {
  it('rounds an amount typed with extra decimals to centavos', () => {
    expect(paymentLineSchema.parse({ receiptId: 1, version: 3, amount: '1284.504', shortReason: '' }).amount).toBe(1284.5);
    expect(paymentLineSchema.parse({ receiptId: 1, version: 3, amount: '1284.504', shortReason: '' }).shortReason).toBeNull();
  });
  it('refuses zero, negative, empty and not-a-number amounts', () => {
    for (const amount of [0, -5, '', 'abc', NaN]) {
      expect(paymentLineSchema.safeParse({ receiptId: 1, version: 0, amount }).success, String(amount)).toBe(false);
    }
  });
  it('wants between 1 and 25 receipts and a method', () => {
    const ok = { method: 'Cash', paidOn: '2026-10-15', lines: [{ receiptId: 1, version: 0, amount: 10 }] };
    expect(paymentRequestSchema.safeParse(ok).success).toBe(true);
    expect(paymentRequestSchema.safeParse({ ...ok, lines: [] }).success).toBe(false);
    expect(paymentRequestSchema.safeParse({ ...ok, lines: Array.from({ length: 26 }, (_, i) => ({ receiptId: i + 1, version: 0, amount: 1 })) }).success).toBe(false);
    expect(paymentRequestSchema.safeParse({ ...ok, method: ' ' }).success).toBe(false);
    expect(paymentRequestSchema.safeParse({ ...ok, paidOn: '15/10/2026' }).success).toBe(false);
  });
});

describe('payment rules', () => {
  const now = new Date('2026-10-15T04:00:00Z');
  it('accepts the full amount, and a lower amount with a reason', () => {
    expect(paymentIssues({ paidOn: '2026-10-15', lines: [line(1, 100)] }, amounts([1, 100]), now)).toEqual([]);
    expect(paymentIssues({ paidOn: '2026-10-15', lines: [line(1, 90, 'Deducted a cash advance')] }, amounts([1, 100]), now)).toEqual([]);
  });
  it('needs a reason for any shortfall, even one centavo, and refuses an overpayment by one centavo', () => {
    expect(codes(paymentIssues({ paidOn: '2026-10-15', lines: [line(1, 99.99)] }, amounts([1, 100]), now))).toEqual(['SHORT_REASON']);
    expect(codes(paymentIssues({ paidOn: '2026-10-15', lines: [line(1, 100.01)] }, amounts([1, 100]), now))).toEqual(['OVERPAID']);
  });
  it('compares in centavos so 0.1 + 0.2 style sums are not a shortfall', () => {
    expect(paymentIssues({ paidOn: '2026-10-15', lines: [line(1, 0.1 + 0.2)] }, amounts([1, 0.3]), now)).toEqual([]);
    expect(totalOf([{ amount: 0.1 }, { amount: 0.2 }])).toBe(0.3);
    expect(totalOf([{ amount: 1284.5 }, { amount: 600 }])).toBe(1884.5);
  });
  it('refuses a future date but accepts today in Manila when the UTC date is still yesterday', () => {
    expect(codes(paymentIssues({ paidOn: '2026-10-20', lines: [line(1, 10)] }, amounts([1, 10]), now))).toEqual(['DATE_FUTURE']);
    // 02:30 on 16 Oct in Manila is 18:30 on 15 Oct in UTC.
    const manilaMorning = new Date('2026-10-15T18:30:00Z');
    expect(paymentIssues({ paidOn: '2026-10-16', lines: [line(1, 10)] }, amounts([1, 10]), manilaMorning)).toEqual([]);
  });
  it('flags a receipt listed twice', () => {
    expect(codes(paymentIssues({ paidOn: '2026-10-15', lines: [line(1, 10), line(1, 10)] }, amounts([1, 10]), now))).toEqual(['DUPLICATE_RECEIPT']);
  });
  it('points each problem at its receipt', () => {
    const r = paymentIssues({ paidOn: '2026-10-15', lines: [line(1, 10), line(2, 5)] }, amounts([1, 10], [2, 10]), now);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ code: 'SHORT_REASON', receiptId: 2 });
  });
});

describe('report filter', () => {
  const base = { from: '2026-10-01', to: '2026-10-31', format: 'csv' };
  it('defaults to all and accepts paid and unpaid', () => {
    expect(reportRequestSchema.parse(base).payment).toBe('all');
    expect(reportRequestSchema.parse({ ...base, payment: 'paid' }).payment).toBe('paid');
    expect(reportRequestSchema.parse({ ...base, payment: 'unpaid' }).payment).toBe('unpaid');
    expect(reportRequestSchema.safeParse({ ...base, payment: 'maybe' }).success).toBe(false);
  });
  it('has plain-words labels', () => {
    expect(PAYMENT_FILTER_LABEL).toEqual({ all: 'Paid and not yet paid', paid: 'Paid', unpaid: 'Not yet paid' });
  });
});

describe('server-side money and date checks', () => {
  it('refuses an amount that rounds to zero centavos', () => {
    expect(paymentLineSchema.safeParse({ receiptId: 1, version: 0, amount: '0.004' }).success).toBe(false);
    expect(paymentLineSchema.safeParse({ receiptId: 1, version: 0, amount: 0.005 }).success).toBe(true);
  });
  it('refuses a date that does not exist on the calendar', () => {
    const ok = { method: 'Cash', lines: [{ receiptId: 1, version: 0, amount: 10 }] };
    expect(paymentRequestSchema.safeParse({ ...ok, paidOn: '2026-02-31' }).success).toBe(false);
    expect(paymentRequestSchema.safeParse({ ...ok, paidOn: '2026-13-01' }).success).toBe(false);
    expect(paymentRequestSchema.safeParse({ ...ok, paidOn: '2028-02-29' }).success).toBe(true);
  });
});
