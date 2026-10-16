import { describe, expect, it } from 'vitest';
import { buildCsv, buildPdf } from '../src/lib/reports';

const row = (i: number, paid = false) => ({
  docNo: `REIM-2026-${String(i).padStart(6, '0')}`, refNo: `RC-2026-${String(i).padStart(6, '0')}`, date: '2026-10-12', invoiceNo: `SI-${i}`, payee: 'Mercury Drug', vendorTin: '123-456-789-00000', category: 'Product', vatType: 'Vatable', vatable: 1147.77, vat: 137.73, wht: 0, encoder: 'Ana Reyes', approvedAt: '2026-10-13', amount: 1284.5,
  paid, paidAmount: paid ? 1200 : 0, paidOn: paid ? '2026-10-15' : '', method: paid ? 'Bank transfer' : '', paymentNo: paid ? 'PAY-2026-000001' : '', shortReason: paid ? 'Advance deducted' : '',
});
const totals = (n: number, paidRows = 0) => ({ gross: n * 1284.5, vatable: n * 1147.77, vat: n * 137.73, wht: 0, paid: paidRows * 1200, unpaid: (n - paidRows) * 1284.5 });
const pages = (buf: Buffer) => (buf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
const range = { from: '2026-10-01', to: '2026-10-31' };

describe('liquidation report pdf', () => {
  it('is a valid pdf', async () => {
    const buf = await buildPdf([row(1)], totals(1), range);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('does not add a blank page for the footer', async () => {
    expect(pages(await buildPdf([row(1), row(2), row(3)], totals(3), range))).toBe(1);
  });

  it('starts a new page only when the rows need one', async () => {
    const many = Array.from({ length: 60 }, (_, i) => row(i + 1));
    expect(pages(await buildPdf(many, totals(60), range))).toBe(3);
  });
});

describe('liquidation report payment columns', () => {
  it('the CSV has the payment columns and the paid total', async () => {
    const csv = (await buildCsv([row(1, true), row(2)], totals(2, 1))).toString('utf8');
    const [head, first, second, total] = csv.replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(head).toContain('Payment,Paid on,Method,Payment no.,Amount paid (PHP)');
    expect(first).toContain('Paid,2026-10-15,Bank transfer,PAY-2026-000001,1200');
    expect(second).toContain('Not yet paid,,,,');
    expect(total!.endsWith(',1200')).toBe(true);
  });
  it('the PDF with paid rows still fits on one page', async () => {
    const buf = await buildPdf([row(1, true), row(2), row(3, true)], totals(3, 2), { ...range, label: 'Payment: Paid' });
    expect(pages(buf)).toBe(1);
  });
});
