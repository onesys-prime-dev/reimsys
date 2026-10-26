import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, formatTin, formatTinAt, incompleteReasons, isCompleteTin, receiptProblems, taxImpact, vatChecks } from '../src/index';

const rules = { ...DEFAULT_SETTINGS, defaultWhtRate: 2 };
const base = { birInvoice: true, amount: 1120, vatType: 'vatable', vatableAmount: 1000, vatAmount: 120 };

describe('tax impact', () => {
  it('Yes uses the net amount, No uses the gross amount, and the difference is rate x VAT', () => {
    const yes = taxImpact({ ...base, withheld: true, whtRate: 2 }, rules);
    expect(yes).toMatchObject({ computable: true, ifYes: 20, ifNo: 22.4, difference: 2.4, potentialSavings: 2.4, potentialLoss: 0, rateSource: 'entered' });
    const no = taxImpact({ ...base, withheld: false }, rules);
    expect(no).toMatchObject({ ifYes: 20, ifNo: 22.4, potentialLoss: 2.4, potentialSavings: 0, rateSource: 'default', rate: 2 });
  });
  it('shows both sides before the question is answered, but claims neither', () => {
    expect(taxImpact({ ...base, withheld: null }, rules)).toMatchObject({ difference: 2.4, potentialLoss: 0, potentialSavings: 0 });
  });
  it('invents nothing when the figures are missing or there is no BIR invoice', () => {
    expect(taxImpact({ ...base, vatableAmount: null, withheld: false }, rules)).toMatchObject({ computable: false, potentialLoss: 0 });
    expect(taxImpact({ ...base, birInvoice: false, withheld: false }, rules).computable).toBe(false);
    expect(taxImpact({ ...base, withheld: false }, { ...rules, askWithholding: false }).computable).toBe(false);
  });
  it('is zero for a non-vatable invoice, where there is no VAT to lose', () => {
    expect(taxImpact({ birInvoice: true, amount: 500, vatableAmount: 500, vatAmount: 0, withheld: false }, rules).potentialLoss).toBe(0);
  });
  it('rounds to the centavo', () => {
    expect(taxImpact({ ...base, amount: 100.01, vatableAmount: 89.29, vatAmount: 10.72, withheld: false, whtRate: 1 }, rules).difference).toBe(0.11);
  });
});

describe('incomplete receipts', () => {
  const full = { birInvoice: true, invoiceNo: 'A1', vendorAddress: 'Cebu', vendorTin: '123-456-789-00000', vatType: 'vatable', vatableAmount: 1000, vatAmount: 120, withheld: true };
  it('counts a No answer and missing details, and nothing else', () => {
    expect(incompleteReasons(full)).toEqual([]);
    expect(incompleteReasons({ ...full, withheld: false })).toEqual(['Tax withheld answered No']);
    expect(incompleteReasons({ ...full, invoiceNo: '', vendorTin: '12', vatAmount: null })).toEqual(['Invoice no. missing', 'Vendor TIN incomplete', 'VAT details missing']);
    expect(incompleteReasons({ birInvoice: false })).toEqual([]);
  });
});

describe('VAT checks', () => {
  const lv = (f: object, r = rules) => vatChecks({ ...base, ...f } as never, r).map((c) => `${c.field}:${c.level}`);
  it('matching amounts raise nothing', () => {
    expect(lv({ withheld: true })).toEqual([]);
    expect(lv({ withheld: false })).toEqual([]);
  });
  it('Yes is strict: every mismatch is red and blocks the step', () => {
    expect(lv({ withheld: true, vatAmount: 100 })).toEqual(['vatAmount:error', 'vatAmount:error']);
    expect(lv({ withheld: true, whtRate: 2, whtAmount: 99 })).toEqual(['whtAmount:error']);
  });
  it('No: an ordinary mismatch is yellow and lets the person carry on', () => {
    // 1020 + 100 = 1120 matches the total, but VAT is not 12% of 1020
    expect(lv({ withheld: false, vatableAmount: 1020, vatAmount: 100 })).toEqual(['vatAmount:warn']);
    expect(lv({ withheld: false, vatType: 'non_vatable', vatableAmount: 1000, vatAmount: 120 })).toEqual(['vatAmount:warn']);
  });
  it('a total that does not add up blocks submitting whatever the answer', () => {
    expect(lv({ withheld: false, vatableAmount: 900, vatAmount: 108 })).toContain('vatAmount:blockSubmit');
    expect(lv({ withheld: null, vatableAmount: 900, vatAmount: 108 })).toContain('vatAmount:blockSubmit');
    expect(lv({ withheld: true, vatableAmount: 900, vatAmount: 108 })).toContain('vatAmount:error');
  });
  it('the total check follows the tolerance and ignores receipts without a BIR invoice', () => {
    expect(lv({ withheld: false, vatAmount: 120.01 })).toEqual([]);
    expect(lv({ withheld: false, vatAmount: 121 })).toEqual(['vatAmount:blockSubmit', 'vatAmount:warn']);
    expect(lv({ withheld: false, vatAmount: 121 }, { ...rules, tolerance: 2 })).toEqual([]);
    expect(vatChecks({ ...base, birInvoice: false, vatAmount: 1 })).toEqual([]);
  });
});

describe('vendor TIN', () => {
  it('keeps digits only and puts the hyphens in as it goes', () => {
    expect(formatTin('')).toBe('');
    expect(formatTin('1')).toBe('1');
    expect(formatTin('123')).toBe('123');
    expect(formatTin('1234')).toBe('123-4');
    expect(formatTin('123456789')).toBe('123-456-789');
    expect(formatTin('12345678900000')).toBe('123-456-789-00000');
    expect(formatTin('abc12x3-45 6')).toBe('123-456');
    expect(formatTin('1234567890000099999')).toBe('123-456-789-00000');
  });
  it('is stable, so formatting twice changes nothing', () => {
    expect(formatTin(formatTin('1234567'))).toBe('123-456-7');
  });
  it('handles pasted text with spaces, dots or a different layout', () => {
    expect(formatTin('123 456 789 00000')).toBe('123-456-789-00000');
    expect(formatTin('123.456.789.000')).toBe('123-456-789-000');
    expect(formatTin('TIN: 123-456-789-00000')).toBe('123-456-789-00000');
  });
  it('keeps the caret after the same digit when typing in the middle', () => {
    expect(formatTinAt('1234', 4)).toEqual({ value: '123-4', caret: 5 });
    expect(formatTinAt('12x3', 3)).toEqual({ value: '123', caret: 2 });
    expect(formatTinAt('1923-456', 2)).toEqual({ value: '192-345-6', caret: 2 });
    expect(formatTinAt('123-', 4)).toEqual({ value: '123', caret: 3 });
    expect(formatTinAt('', 0)).toEqual({ value: '', caret: 0 });
  });
  it('is complete only when all 14 digits are there', () => {
    expect(isCompleteTin('123-456-789-00000')).toBe(true);
    expect(isCompleteTin('123-456-789')).toBe(false);
    expect(isCompleteTin('123456789-00000')).toBe(false);
    expect(isCompleteTin('')).toBe(false);
  });
  it('is refused on the form unless complete', () => {
    const f = { birInvoice: 'yes', invoiceUnderCompany: 'no', transactionType: 'product', invoiceNo: 'A', vendorAddress: 'Cebu', vatType: 'vatable', vatableAmount: '1000', vatAmount: '120', withheld: 'no', reasonForSpending: 'Water', classification: 'meal', receiptDate: '2026-10-12', payee: 'Corner', amount: '1120' };
    expect(receiptProblems({ ...f, vendorTin: '123-456-789' }).vendorTin).toMatch(/14 digits/);
    expect(receiptProblems({ ...f, vendorTin: '12345678900000' }).vendorTin).toBeUndefined();
    expect(receiptProblems({ ...f, vendorTin: '' }).vendorTin).toMatch(/Enter the vendor TIN/);
  });
});

describe('VAT-exempt sales and discount', () => {
  // Total Sales (VAT inclusive) = vatable sales + VAT + VAT-exempt sales. A discount is taken off after it, so it is not part of the gross.
  const inv = { birInvoice: true, amount: 1620, vatType: 'vatable', vatableAmount: 1000, vatAmount: 120, vatExemptAmount: 500 };
  const lv = (f: object, r = rules) => vatChecks({ ...inv, ...f } as never, r).map((c) => `${c.field}:${c.level}`);
  it('the total counts the VAT-exempt amount', () => {
    expect(lv({ withheld: false })).toEqual([]);
    expect(lv({ withheld: true, whtRate: 2, whtAmount: 30 })).toEqual([]); // 2% of the net 1,500 (vatable + VAT-exempt)
    expect(lv({ withheld: false, vatExemptAmount: 0 })).toEqual(['vatAmount:blockSubmit']);
    expect(lv({ withheld: true, vatExemptAmount: 0 })).toEqual(['vatAmount:error']);
  });
  it('withholding is checked on the net: vatable plus VAT-exempt', () => {
    expect(lv({ withheld: true, whtRate: 2, whtAmount: 20 })).toEqual(['whtAmount:error']);
  });
  it('the impact uses the same net, so the difference is still the rate times the VAT', () => {
    const t = taxImpact({ ...inv, withheld: false }, rules);
    expect(t).toMatchObject({ net: 1500, ifYes: 30, ifNo: 32.4, difference: 2.4, potentialLoss: 2.4 });
  });
  it('a receipt without the new answers is fine for the API but not for the form', () => {
    const f = { birInvoice: 'yes', invoiceUnderCompany: 'no', transactionType: 'product', invoiceNo: 'A', vendorAddress: 'Cebu', vendorTin: '123-456-789-00000', vatType: 'vatable', vatableAmount: '1000', vatAmount: '120', withheld: 'no', reasonForSpending: 'Water', classification: 'fuel', receiptDate: '2026-10-12', payee: 'Corner', amount: '1120' };
    const strict = receiptProblems(f);
    expect(Object.keys(strict).sort()).toEqual(['chargeLocationId', 'discountAmount', 'newReimbursementCode', 'vatExemptAmount']);
    expect(receiptProblems(f, rules, false)).toEqual({});
    expect(receiptProblems({ ...f, vatExemptAmount: '0', discountAmount: '0', chargeLocationId: '1', newReimbursementCode: 'no' }).reimbursementCode).toMatch(/reimbursement code/);
    expect(receiptProblems({ ...f, vatExemptAmount: '0', discountAmount: '0', chargeLocationId: '1', newReimbursementCode: 'no', reimbursementCode: 'RC-1' })).toEqual({});
  });
});
