import { config } from '../config.js';
import { prisma } from '../db.js';
import { queueEmail, renderHtml } from './email.js';

interface NotifyInput {
  userIds: number[];
  type: string;
  text: string;
  receiptId?: number;
  /** When set, the recipients also get an email. */
  email?: { subject: string; heading: string; lines: string[]; template: string; respectPref?: 'reservationReleased' };
}

export const receiptUrl = (id: number) => `${config.webOrigin}/receipts/${id}`;

/** In-app notification for each recipient, plus an optional queued email. */
export async function notify(input: NotifyInput) {
  const ids = [...new Set(input.userIds)];
  if (!ids.length) return;
  await prisma.notification.createMany({ data: ids.map((userId) => ({ userId, type: input.type, text: input.text.slice(0, 300), receiptId: input.receiptId ?? null })) });
  if (!input.email) return;
  const users = await prisma.user.findMany({ where: { id: { in: ids }, isActive: true } });
  for (const u of users) {
    if (input.email.respectPref && !u[input.email.respectPref]) continue;
    await queueEmail({
      userId: u.id, to: u.email, template: input.email.template, subject: input.email.subject,
      html: renderHtml(input.email.heading, input.email.lines, input.receiptId ? { url: receiptUrl(input.receiptId), label: 'Open the record' } : undefined),
    });
  }
}

/** Active users who currently hold a permission. Used instead of hardcoding roles. */
export async function usersWithPermission(code: string) {
  const users = await prisma.user.findMany({
    where: { isActive: true, role: { permissions: { some: { permission: { code } } } } },
    select: { id: true },
  });
  return users.map((u) => u.id);
}
