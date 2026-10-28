import { REMINDER_LABEL, peso, scheduleIsDue, stepsOf, type ReminderStage } from '@reimsys/shared';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { queueEmail } from './email.js';
import { renderEmail } from './emailTemplates.js';

/** Your own reminder emails (Access → Email schedules). A worker looks every minute for the ones that are due. */

type Row = Awaited<ReturnType<typeof prisma.emailSchedule.findFirstOrThrow>>;

const STATUS_FOR: Record<ReminderStage, string> = { check: 'submitted', decide: 'checked', pay: 'approved', fix: 'returned' };
const DAY = 86_400_000;
export const idList = (v: string) => v.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);

interface Waiting { id: number; line: string; days: number; encoderId: number }

/** The receipts waiting at the chosen steps, for at least `minDays`, longest wait first. */
async function waiting(steps: ReminderStage[], minDays: number, now: Date): Promise<Waiting[]> {
  const rows = await prisma.receipt.findMany({
    where: { status: { in: steps.map((s) => STATUS_FOR[s]) } },
    select: { id: true, refNo: true, payee: true, amount: true, status: true, encoderId: true, submittedAt: true, checkedAt: true, decidedAt: true, updatedAt: true },
    orderBy: { id: 'asc' },
    take: 5000,
  });
  const out: Waiting[] = [];
  for (const r of rows) {
    const stage = steps.find((s) => STATUS_FOR[s] === r.status)!;
    const since = (stage === 'check' ? r.submittedAt : stage === 'decide' ? r.checkedAt : stage === 'pay' ? r.decidedAt : r.updatedAt) ?? r.updatedAt;
    const days = (now.getTime() - since.getTime()) / DAY;
    if (days < minDays) continue;
    const whole = Math.floor(days);
    out.push({ id: r.id, encoderId: r.encoderId, days, line: `${r.refNo} · ${r.payee} (${peso(Number(r.amount))}): ${REMINDER_LABEL[stage]}${whole >= 1 ? ` for ${whole} day${whole === 1 ? '' : 's'}` : ' (less than a day)'}` });
  }
  return out.sort((a, b) => b.days - a.days);
}

/** Who gets it: everyone active in the chosen roles, plus the chosen people. */
export async function recipientsOf(s: Pick<Row, 'roleIds' | 'userIds'>) {
  const roles = idList(s.roleIds), people = idList(s.userIds);
  if (!roles.length && !people.length) return [];
  return prisma.user.findMany({ where: { isActive: true, OR: [...(roles.length ? [{ roleId: { in: roles } }] : []), ...(people.length ? [{ id: { in: people } }] : [])] }, select: { id: true, name: true, email: true, role: { select: { name: true } } }, orderBy: { name: 'asc' } });
}

/** What each person would be sent now. People with nothing waiting (not counting their own receipts) are left out. */
export async function buildForSchedule(s: Row, now = new Date()) {
  const list = await waiting(stepsOf(s.steps), Number(s.minDays), now);
  const people = await recipientsOf(s);
  return people.map((u) => ({ user: u, lines: list.filter((w) => w.encoderId !== u.id).map((w) => w.line) })).filter((x) => x.lines.length);
}

/** Queues the emails. Returns how many people were sent one. */
export async function sendSchedule(s: Row, now = new Date()): Promise<number> {
  const batch = await buildForSchedule(s, now);
  for (const { user, lines } of batch) {
    const shown = lines.slice(0, 40);
    const summary = shown.map((l) => `• ${l}`).join('\n') + (lines.length > shown.length ? `\n• and ${lines.length - shown.length} more` : '');
    const mail = await renderEmail({ key: 'reminder', data: { recipientName: user.name.split(' ')[0]!, summary }, link: config.webOrigin });
    await queueEmail({ userId: user.id, to: user.email, template: 'reminder', subject: mail.subject, html: mail.html });
  }
  return batch.length;
}

/** Sends every schedule that is due. The send time is claimed first, so two processes or a restart can never send the same slot twice. */
export async function runDueSchedules(now = new Date()) {
  const all = await prisma.emailSchedule.findMany({ where: { isOn: true } });
  for (const s of all) {
    if (!scheduleIsDue(now, s)) continue;
    const claimed = await prisma.emailSchedule.updateMany({ where: { id: s.id, lastSentAt: s.lastSentAt }, data: { lastSentAt: now } });
    if (!claimed.count) continue;
    try {
      const sent = await sendSchedule(s, now);
      await prisma.emailSchedule.update({ where: { id: s.id }, data: { lastCount: sent } });
    } catch (e) {
      console.error(`email schedule ${s.id} failed`, e);
    }
  }
}

export function startEmailSchedules() {
  setInterval(() => void runDueSchedules().catch((e) => console.error('email schedules', e)), 60_000);
  void runDueSchedules().catch((e) => console.error('email schedules', e));
}
