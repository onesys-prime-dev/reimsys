import { config } from '../config.js';
import { prisma } from '../db.js';
import { queueEmail } from './email.js';
import { renderEmail } from './emailTemplates.js';
import { newToken, sha256 } from './password.js';

export const RESET_MINUTES = 60;
export const INVITE_HOURS = 72;

/** Makes a one-time link token. Any older unused link for the same person is cancelled, so only the newest one works. */
async function makeToken(userId: number, purpose: 'reset' | 'invite', ttlMs: number) {
  const token = newToken();
  await prisma.passwordToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
  await prisma.passwordToken.create({ data: { userId, purpose, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMs) } });
  return token;
}

export const linkFor = (token: string) => `${config.webOrigin}/reset?token=${encodeURIComponent(token)}`;

/** Emails a "choose a new password" link. The link is always included, because the whole point of this email is the link. */
export async function sendPasswordLink(user: { id: number; name: string; email: string }, kind: 'reset' | 'invite', actorName = '') {
  const token = await makeToken(user.id, kind, kind === 'reset' ? RESET_MINUTES * 60_000 : INVITE_HOURS * 3_600_000);
  const mail = await renderEmail({
    key: kind,
    data: { recipientName: user.name.split(' ')[0] ?? user.name, actorName, minutes: String(RESET_MINUTES), hours: String(INVITE_HOURS) },
    link: linkFor(token),
    forceLink: true,
  });
  await queueEmail({ userId: user.id, to: user.email, template: kind, subject: mail.subject, html: mail.html });
  return token;
}

/** Looks up a link. Returns the person it belongs to, or why it cannot be used. */
export async function checkToken(raw: string) {
  const row = await prisma.passwordToken.findUnique({ where: { tokenHash: sha256(raw) }, include: { user: true } });
  if (!row || row.usedAt || row.expiresAt < new Date() || !row.user.isActive) return null;
  return row;
}
