import type { MailSettingsInput, MailSettingsView } from '@reimsys/shared';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { decrypt, encrypt } from './secrets.js';

const KEY = 'mail';

interface Stored { host: string; port: number; secure: boolean; user: string; passEnc: string | null; fromName: string; fromAddress: string; testRedirect?: string }
export interface ResolvedMail {
  source: 'database' | 'environment' | 'none';
  smtp: { host: string; port: number; secure: boolean; user?: string; pass?: string } | null;
  from: string;
  /** Test mode: every email is delivered here instead of to its real recipient. */
  redirectTo?: string;
  /** A mail password is saved, but this server cannot unlock it (the key in storage/.settings-key or SETTINGS_KEY is not the one it was saved with). */
  passwordUnreadable?: boolean;
}

const fromHeader = (name: string, address: string) => (name ? `"${name.replace(/"/g, '')}" <${address}>` : address);

async function readStored(): Promise<Stored | null> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  if (!row) return null;
  try { return JSON.parse(row.value) as Stored; } catch { return null; }
}

let cache: { at: number; value: ResolvedMail } | null = null;
export const invalidateMailCache = () => { cache = null; };

/** The mail account in use right now: the one saved in the app, otherwise the server's environment settings. */
export async function resolveMail(): Promise<ResolvedMail> {
  if (cache && Date.now() - cache.at < 15_000) return cache.value;
  const s = await readStored();
  let value: ResolvedMail;
  if (s) {
    let pass: string | undefined;
    let unreadable = false;
    try { pass = s.passEnc ? decrypt(s.passEnc) : undefined; } catch { pass = undefined; unreadable = true; }
    value = { source: 'database', smtp: { host: s.host, port: s.port, secure: s.secure, user: s.user || undefined, pass }, from: fromHeader(s.fromName, s.fromAddress), redirectTo: s.testRedirect || undefined, passwordUnreadable: unreadable || undefined };
  } else if (config.smtp) {
    value = { source: 'environment', smtp: config.smtp, from: config.mailFrom };
  } else {
    value = { source: 'none', smtp: null, from: config.mailFrom };
  }
  cache = { at: Date.now(), value };
  return value;
}

/** What the settings page may see. The password is never included. */
export async function mailView(): Promise<MailSettingsView> {
  const s = await readStored();
  if (s) return { source: 'database', host: s.host, port: s.port, secure: s.secure, user: s.user, hasPassword: !!s.passEnc, fromName: s.fromName, fromAddress: s.fromAddress, testRedirect: s.testRedirect ?? '' };
  if (config.smtp) {
    const m = /^"?([^"<]*?)"?\s*<([^>]+)>$/.exec(config.mailFrom);
    return { source: 'environment', host: config.smtp.host, port: config.smtp.port, secure: config.smtp.secure, user: config.smtp.user ?? '', hasPassword: !!config.smtp.pass, fromName: m?.[1]?.trim() ?? '', fromAddress: m?.[2] ?? config.mailFrom, testRedirect: '' };
  }
  return { source: 'none', host: '', port: 587, secure: false, user: '', hasPassword: false, fromName: config.orgName, fromAddress: '', testRedirect: '' };
}

export async function saveMail(input: MailSettingsInput, userId: number) {
  const prev = await readStored();
  const keepOld = input.pass === undefined || input.pass === '';
  const passEnc = keepOld ? prev?.passEnc ?? null : encrypt(input.pass!);
  const value: Stored = { host: input.host, port: input.port, secure: input.secure, user: input.user, passEnc, fromName: input.fromName, fromAddress: input.fromAddress, testRedirect: input.testRedirect };
  await prisma.setting.upsert({ where: { key: KEY }, update: { value: JSON.stringify(value), updatedById: userId }, create: { key: KEY, value: JSON.stringify(value), updatedById: userId } });
  invalidateMailCache();
}

export async function clearMail() {
  await prisma.setting.deleteMany({ where: { key: KEY } });
  invalidateMailCache();
}

/** The saved password, for testing a connection when the form leaves the password blank. */
export async function savedPassword(): Promise<string | undefined> {
  const s = await readStored();
  try { return s?.passEnc ? decrypt(s.passEnc) : undefined; } catch { return undefined; }
}
