import { describe, expect, it } from 'vitest';
import { buildPdf } from '../src/lib/reports';

const row = (i: number) => ({ docNo: `REIM-2026-${String(i).padStart(6, '0')}`, refNo: `RC-2026-${String(i).padStart(6, '0')}`, date: '2026-10-12', invoiceNo: `SI-${i}`, payee: 'Mercury Drug', vendorTin: '123-456-789-00000', category: 'Product', vatType: 'Vatable', vatable: 1147.77, vat: 137.73, wht: 0, encoder: 'Ana Reyes', approvedAt: '2026-10-13', amount: 1284.5 });
const totals = (n: number) => ({ gross: n * 1284.5, vatable: n * 1147.77, vat: n * 137.73, wht: 0 });
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
