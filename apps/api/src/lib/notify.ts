import type { TemplateKey } from '@reimsis/shared';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { queueEmail } from './email.js';
import { renderEmail } from './emailTemplates.js';

interface NotifyInput {
  userIds: number[];
  type: string;
  text: string;
  receiptId?: number;
  /** When set, the recipients also get this email, written from the template an administrator can edit. */
  email?: { template: TemplateKey; data: Record<string, string>; respectPref?: 'reservationReleased' };
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
    const mail = await renderEmail({
      key: input.email.template,
      data: { ...input.email.data, recipientName: u.name.split(' ')[0] },
      link: input.receiptId ? receiptUrl(input.receiptId) : undefined,
    });
    await queueEmail({ userId: u.id, to: u.email, template: input.email.template, subject: mail.subject, html: mail.html });
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
