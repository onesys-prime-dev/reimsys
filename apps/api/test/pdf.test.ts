import { describe, expect, it } from 'vitest';
import { buildPdf } from '../src/lib/reports';

const row = (i: number) => ({ docNo: `REIM-2026-${String(i).padStart(6, '0')}`, refNo: `RC-2026-${String(i).padStart(6, '0')}`, date: '2026-10-12', payee: 'Mercury Drug', category: 'Medicine', encoder: 'Ana Reyes', approvedAt: '2026-10-13', amount: 1284.5 });
const pages = (buf: Buffer) => (buf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
const range = { from: '2026-10-01', to: '2026-10-31' };

describe('liquidation report pdf', () => {
  it('is a valid pdf', async () => {
    const buf = await buildPdf([row(1)], 1284.5, range);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('does not add a blank page for the footer', async () => {
    expect(pages(await buildPdf([row(1), row(2), row(3)], 3853.5, range))).toBe(1);
  });

  it('starts a new page only when the rows need one', async () => {
    const many = Array.from({ length: 60 }, (_, i) => row(i + 1));
    expect(pages(await buildPdf(many, 77070, range))).toBe(3);
  });
});
