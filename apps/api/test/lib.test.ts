import { describe, expect, it } from 'vitest';
import { changePasswordSchema } from '@reimsys/shared';
import { temporaryPassword } from '../src/lib/password';
import { toCsv } from '../src/lib/reports';
import { formatNumber } from '../src/lib/sequence';
import { sniff } from '../src/lib/storage';

const pad = (...b: number[]) => Buffer.from([...b, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

describe('file type detection', () => {
  it('recognises real images and PDFs from their first bytes', () => {
    expect(sniff(pad(0xff, 0xd8, 0xff, 0xe0))?.mime).toBe('image/jpeg');
    expect(sniff(pad(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))?.mime).toBe('image/png');
    expect(sniff(Buffer.from('%PDF-1.7 and more content'))?.mime).toBe('application/pdf');
    expect(sniff(Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')]))?.mime).toBe('image/webp');
    expect(sniff(Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.from([0, 0, 0, 0])]))?.mime).toBe('image/heic');
  });

  it('rejects scripts, text and executables pretending to be images', () => {
    expect(sniff(Buffer.from('<script>alert(1)</script>   '))).toBeNull();
    expect(sniff(Buffer.from('plain text pretending to be a photo'))).toBeNull();
    expect(sniff(Buffer.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0, 0xff]))).toBeNull();
    expect(sniff(Buffer.alloc(4))).toBeNull();
  });
});

describe('csv output', () => {
  it('quotes commas, quotes and newlines and starts with a BOM for Excel', () => {
    const out = toCsv([['a', 'b,c', 'd"e', 'f\ng'], [1, 2.5, '', 'x']]);
    expect(out.startsWith('﻿')).toBe(true);
    expect(out).toContain('a,"b,c","d""e","f\ng"');
    expect(out).toContain('1,2.5,,x');
  });
});

describe('numbering', () => {
  it('formats receipt and document numbers with the year and six digits', () => {
    expect(formatNumber('RC', 7, 2026)).toBe('RC-2026-000007');
    expect(formatNumber('REIM', 123456, 2026)).toBe('REIM-2026-123456');
  });
});

describe('temporary passwords', () => {
  it('always satisfy the password policy and are not repeated', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const p = temporaryPassword();
      seen.add(p);
      expect(changePasswordSchema.safeParse({ currentPassword: 'x', newPassword: p }).success).toBe(true);
    }
    expect(seen.size).toBe(200);
  });
});

import { isSameOrigin } from '../src/middleware/security';
describe('cross-site protection', () => {
  it('accepts a page that talks to the address it was loaded from', () => {
    expect(isSameOrigin('http://127.0.0.1:4000', '127.0.0.1:4000')).toBe(true);
    expect(isSameOrigin('http://192.168.1.77:4000', '192.168.1.77:4000')).toBe(true);
    expect(isSameOrigin('https://reimsys.example.com', 'reimsys.example.com')).toBe(true);
  });
  it('refuses another website pretending to be a page of ours', () => {
    expect(isSameOrigin('https://evil.example.org', 'localhost:4000')).toBe(false);
    expect(isSameOrigin('http://localhost:4001', 'localhost:4000')).toBe(false);
    expect(isSameOrigin('http://localhost:4000.evil.org', 'localhost:4000')).toBe(false);
    expect(isSameOrigin('not a url', 'localhost:4000')).toBe(false);
    expect(isSameOrigin('http://localhost:4000', undefined)).toBe(false);
  });
});

import { assertSafeZip } from '../src/lib/zipGuard';
import { neutraliseFormula, toCsv as csvOf } from '../src/lib/reports';
import zlib from 'node:zlib';

/** Builds a minimal zip with one entry that claims a given uncompressed size. Only the table of contents matters to the guard. */
function fakeZip(entries: { name: string; compressed: number; uncompressed: number }[]) {
  const dir: Buffer[] = [];
  for (const e of entries) {
    const h = Buffer.alloc(46 + e.name.length);
    h.writeUInt32LE(0x02014b50, 0); h.writeUInt32LE(e.compressed, 20); h.writeUInt32LE(e.uncompressed, 24); h.writeUInt16LE(e.name.length, 28);
    h.write(e.name, 46); dir.push(h);
  }
  const cd = Buffer.concat(dir);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(0, 16);
  return Buffer.concat([cd, end]);
}

describe('spreadsheet upload guard', () => {
  it('accepts an ordinary small spreadsheet', () => {
    expect(() => assertSafeZip(fakeZip([{ name: 'xl/worksheets/sheet1.xml', compressed: 20_000, uncompressed: 90_000 }, { name: '[Content_Types].xml', compressed: 400, uncompressed: 1200 }]))).not.toThrow();
  });
  it('refuses a zip bomb: a tiny file that claims to expand to gigabytes', () => {
    expect(() => assertSafeZip(fakeZip([{ name: 'xl/worksheets/sheet1.xml', compressed: 4_000, uncompressed: 2_000_000_000 }]))).toThrow(/safely/);
  });
  it('refuses a high squeeze ratio even when the total is smaller', () => {
    expect(() => assertSafeZip(fakeZip([{ name: 'a.xml', compressed: 1_000, uncompressed: 50_000_000 }]))).toThrow(/safely/);
  });
  it('refuses a zip with a huge number of parts', () => {
    expect(() => assertSafeZip(fakeZip(Array.from({ length: 400 }, (_, i) => ({ name: `p${i}`, compressed: 10, uncompressed: 20 }))))).toThrow(/safely/);
  });
  it('refuses something that is not a zip at all', () => {
    expect(() => assertSafeZip(Buffer.from('this is not a spreadsheet, just some text that is long enough'))).toThrow(/safely/);
    expect(() => assertSafeZip(Buffer.alloc(5))).toThrow(/safely/);
  });
  it('the squeeze really is possible, which is why the check exists', () => {
    expect(zlib.deflateRawSync(Buffer.alloc(20_000_000)).length).toBeLessThan(40_000);
  });
});

describe('spreadsheet formulas in exports', () => {
  it('turns anything that looks like a formula into plain text', () => {
    for (const s of ['=HYPERLINK("http://evil","x")', '+cmd|\' /C calc\'!A0', '-2+3', '@SUM(1,1)', '\t=1+1', '\r=1']) expect(neutraliseFormula(s), s).toBe("'" + s);
  });
  it('leaves ordinary text and real numbers alone', () => {
    expect(neutraliseFormula('Mercury Drug - Mandaue')).toBe('Mercury Drug - Mandaue');
    expect(neutraliseFormula('2026-10-12')).toBe('2026-10-12');
    expect(neutraliseFormula(-12.5)).toBe(-12.5);
    expect(neutraliseFormula(null)).toBe('');
  });
  it('applies to every cell of a CSV, and still quotes properly', () => {
    const out = csvOf([['=1+1', 'a,b', 'ok', 5]]);
    expect(out).toContain("'=1+1,\"a,b\",ok,5");
  });
});
