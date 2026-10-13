import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes } from 'node:crypto';

export const hashPassword = (plain: string) => hash(plain);
export const verifyPassword = (hashed: string, plain: string) => verify(hashed, plain).catch(() => false);

export const newToken = () => randomBytes(32).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Readable temporary password that satisfies the password policy. */
export function temporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(10);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out + '7';
}
