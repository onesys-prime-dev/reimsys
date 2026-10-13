import { prisma } from '../db.js';
import { queueEmail, renderHtml } from './email.js';
import { config } from '../config.js';

const SEND_HOUR = 8;

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
  const users = await prisma.user.findMany({
    where: { isActive: true, dailyDigest: true },
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  });
  const count = (where: object) => prisma.receipt.count({ where });
  for (const u of users) {
    const perms = new Set(u.role.permissions.map((p) => p.permission.code));
    const lines: string[] = [];
    if (perms.has('review.check')) { const n = await count({ status: 'submitted' }); if (n) lines.push(`${n} receipt${n === 1 ? '' : 's'} waiting to be checked.`); }
    if (perms.has('review.decide')) {
      const n = await count({ status: 'checked' }); if (n) lines.push(`${n} receipt${n === 1 ? '' : 's'} ready for your decision.`);
      const h = await count({ status: 'reserved' }); if (h) lines.push(`${h} receipt${h === 1 ? '' : 's'} on hold.`);
    }
    if (perms.has('receipt.create')) {
      const n = await count({ encoderId: u.id, status: { in: ['returned', 'reserved'] } }); if (n) lines.push(`${n} of your receipt${n === 1 ? ' needs' : 's need'} attention.`);
      const d = await count({ encoderId: u.id, status: 'draft' }); if (d) lines.push(`${d} draft${d === 1 ? '' : 's'} not submitted yet.`);
    }
    if (!lines.length) continue;
    await queueEmail({ userId: u.id, to: u.email, template: 'digest', subject: `${config.orgName}: your daily summary`, html: renderHtml(`Good morning, ${u.name.split(' ')[0]}`, lines, { url: config.webOrigin, label: 'Open REIMSIS' }) });
  }
}

export function startDigest() {
  setInterval(() => void runDigest().catch((e) => console.error('digest', e)), 15 * 60_000);
  void runDigest().catch((e) => console.error('digest', e));
}
