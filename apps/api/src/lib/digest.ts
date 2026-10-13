import { config } from '../config.js';
import { prisma } from '../db.js';
import { queueEmail, renderHtml } from './email.js';

const SEND_HOUR = 8;

type DigestUser = { id: number; name: string; email: string; role: { permissions: { permission: { code: string } }[] } };

/** What is waiting for this person right now. Empty when there is nothing, so no email is sent. */
async function digestLines(u: DigestUser): Promise<string[]> {
  const perms = new Set(u.role.permissions.map((p) => p.permission.code));
  const count = (where: object) => prisma.receipt.count({ where });
  const lines: string[] = [];
  if (perms.has('review.check')) {
    const n = await count({ status: 'submitted' });
    if (n) lines.push(`${n} receipt${n === 1 ? '' : 's'} waiting to be checked.`);
  }
  if (perms.has('review.decide')) {
    const n = await count({ status: 'checked' });
    if (n) lines.push(`${n} receipt${n === 1 ? '' : 's'} ready for your decision.`);
    const h = await count({ status: 'reserved' });
    if (h) lines.push(`${h} receipt${h === 1 ? '' : 's'} on hold.`);
  }
  if (perms.has('receipt.create')) {
    const n = await count({ encoderId: u.id, status: { in: ['returned', 'reserved'] } });
    if (n) lines.push(`${n} of your receipt${n === 1 ? ' needs' : 's need'} attention.`);
    const d = await count({ encoderId: u.id, status: 'draft' });
    if (d) lines.push(`${d} draft${d === 1 ? '' : 's'} not submitted yet.`);
  }
  return lines;
}

async function queueDigest(u: DigestUser) {
  const lines = await digestLines(u);
  if (!lines.length) return false;
  await queueEmail({
    userId: u.id, to: u.email, template: 'digest', subject: `${config.orgName}: your daily summary`,
    html: renderHtml(`Good morning, ${u.name.split(' ')[0]}`, lines, { url: config.webOrigin, label: 'Open REIMSIS' }),
  });
  return true;
}

const withRole = { role: { include: { permissions: { include: { permission: true } } } } } as const;

/** Sends the daily summary to one person right now, for testing. Returns false when they have nothing waiting. */
export async function sendDigestNow(userId: number) {
  const u = await prisma.user.findUnique({ where: { id: userId }, include: withRole });
  if (!u) return false;
  return queueDigest(u);
}

/** Sends one morning email per opted-in user listing what is waiting for them. Runs at most once a day. */
async function runDigest() {
  const now = new Date();
  if (now.getHours() < SEND_HOUR) return;
  const key = `digest-${now.toISOString().slice(0, 10)}`;
  try {
    await prisma.sequence.create({ data: { key, value: 1 } }); // the unique key claims today's run
  } catch {
    return;
  }
  const users = await prisma.user.findMany({ where: { isActive: true, dailyDigest: true }, include: withRole });
  for (const u of users) await queueDigest(u);
}

export function startDigest() {
  setInterval(() => void runDigest().catch((e) => console.error('digest', e)), 15 * 60_000);
  void runDigest().catch((e) => console.error('digest', e));
}
