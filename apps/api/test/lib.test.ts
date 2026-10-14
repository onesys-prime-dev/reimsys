import { describe, expect, it } from 'vitest';
import { changePasswordSchema } from '@reimsis/shared';
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
