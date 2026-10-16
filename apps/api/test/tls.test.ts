import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { tlsOptions } from '../src/lib/tls';

describe('optional https', () => {
  it('stays on plain http when no certificate is set', () => {
    expect(tlsOptions({})).toBeNull();
    expect(tlsOptions({ TLS_CERT: '', TLS_KEY: '' })).toBeNull();
  });

  it('turns on when both the certificate and the key are given, reading both files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tls-'));
    fs.writeFileSync(path.join(dir, 'c.pem'), 'CERT');
    fs.writeFileSync(path.join(dir, 'k.pem'), 'KEY');
    const o = tlsOptions({ TLS_CERT: path.join(dir, 'c.pem'), TLS_KEY: path.join(dir, 'k.pem') });
    expect(o?.cert.toString()).toBe('CERT');
    expect(o?.key.toString()).toBe('KEY');
  });

  it('refuses to start half-configured, so nobody thinks they are on https when they are not', () => {
    expect(() => tlsOptions({ TLS_CERT: 'only-one.pem' })).toThrow(/both/i);
    expect(() => tlsOptions({ TLS_KEY: 'only-one.pem' })).toThrow(/both/i);
  });

  it('says clearly when a file is missing', () => {
    expect(() => tlsOptions({ TLS_CERT: '/no/such/c.pem', TLS_KEY: '/no/such/k.pem' })).toThrow(/certificate/i);
  });
});
