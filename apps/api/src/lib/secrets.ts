import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

/**
 * Encrypts small secrets (such as the mail password) before they are stored in the database.
 * The key comes from SETTINGS_KEY. If that is not set, a random key is created once and kept in the
 * storage folder, so back up the storage folder together with the database.
 */
let cached: Buffer | null = null;

function key(): Buffer {
  if (cached) return cached;
  if (process.env.SETTINGS_KEY) {
    cached = createHash('sha256').update(process.env.SETTINGS_KEY).digest();
    return cached;
  }
  const file = path.join(config.storageDir, '.settings-key');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(config.storageDir, { recursive: true });
    fs.writeFileSync(file, randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  cached = createHash('sha256').update(fs.readFileSync(file, 'utf8').trim()).digest();
  return cached;
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), body.toString('base64')].join(':');
}

export function decrypt(token: string): string {
  const [v, iv, tag, body] = token.split(':');
  if (v !== 'v1' || !iv || !tag || !body) throw new Error('Unreadable secret');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(body, 'base64')), d.final()]).toString('utf8');
}
