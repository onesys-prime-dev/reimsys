import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

/**
 * Storage adapter. Local disk today. To move to S3, keep these function signatures and swap the bodies.
 * Paths stored in the database are relative to the storage root.
 */
export const abs = (rel: string) => {
  const full = path.resolve(config.storageDir, rel);
  if (!full.startsWith(config.storageDir)) throw new Error('Invalid storage path');
  return full;
};

export async function saveFile(folder: string, ext: string, data: Buffer) {
  const rel = path.posix.join(folder, `${randomUUID()}.${ext}`);
  await fs.mkdir(path.dirname(abs(rel)), { recursive: true });
  await fs.writeFile(abs(rel), data);
  return rel;
}

export async function readFile(rel: string) {
  return fs.readFile(abs(rel));
}
export async function copyFile(rel: string, folder: string) {
  const ext = path.extname(rel).slice(1);
  const dest = path.posix.join(folder, `${randomUUID()}.${ext}`);
  await fs.mkdir(path.dirname(abs(dest)), { recursive: true });
  await fs.copyFile(abs(rel), abs(dest));
  return dest;
}
export const removeFile = (rel: string) => fs.rm(abs(rel), { force: true });
export const sha256Of = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');

/** Detect the real file type from its first bytes. The client's claimed type is never trusted. */
export function sniff(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (buf.subarray(0, 5).toString('ascii') === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  if (buf.subarray(4, 8).toString('ascii') === 'ftyp' && /^(heic|heix|hevc|mif1|msf1)/.test(buf.subarray(8, 12).toString('ascii'))) return { mime: 'image/heic', ext: 'heic' };
  return null;
}
