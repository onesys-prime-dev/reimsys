import { REMINDER_LABEL, REMINDER_PERMISSION, peso, reminderStage, whoToRemind, type ReminderStage } from '@reimsys/shared';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { getSettings } from './appSettings.js';
import { queueEmail } from './email.js';
import { renderEmail } from './emailTemplates.js';
import { notify } from './notify.js';

const SEND_HOUR = 9;
const DAY = 86_400_000;

interface Waiting {
  id: number; refNo: string; payee: string; amount: number; status: string; since: Date;
  encoderId: number; checkedById: number | null; decidedById: number | null;
}

/** Receipts that have waited longer than the reminder days, with the stage each is waiting at. */
async function overdue(now: Date): Promise<(Waiting & { stage: ReminderStage; days: number })[]> {
  const rules = getSettings();
  const rows = await prisma.receipt.findMany({
    where: { status: { in: ['submitted', 'checked', 'approved', 'returned'] } },
    select: { id: true, refNo: true, payee: true, amount: true, status: true, encoderId: true, checkedById: true, decidedById: true, submittedAt: true, checkedAt: true, decidedAt: true, updatedAt: true },
    orderBy: { id: 'asc' },
  });
  const out: (Waiting & { stage: ReminderStage; days: number })[] = [];
  for (const r of rows) {
    const stage = reminderStage(r.status);
    const since = (stage === 'check' ? r.submittedAt : stage === 'decide' ? r.checkedAt : stage === 'pay' ? r.decidedAt : r.updatedAt) ?? r.updatedAt;
    const days = (now.getTime() - since.getTime()) / DAY;
    const due = whoToRemind(r.status, days, rules);
    if (due) out.push({ id: r.id, refNo: r.refNo, payee: r.payee, amount: Number(r.amount), status: r.status, since, encoderId: r.encoderId, checkedById: r.checkedById, decidedById: r.decidedById, stage: due, days: Math.floor(days) });
  }
  return out;
}

/** One reminder per person, listing every overdue receipt they have to act on, longest wait first. */
export async function reminderLines(now = new Date()): Promise<Map<number, { id: number; line: string }[]>> {
  const list = await overdue(now);
  const byUser = new Map<number, { days: number; id: number; line: string }[]>();
  const add = (userId: number, w: (typeof list)[number]) => {
    const l = byUser.get(userId) ?? [];
    l.push({ days: w.days, id: w.id, line: `${w.refNo} · ${w.payee} (${peso(w.amount)}): ${REMINDER_LABEL[w.stage]} for ${w.days} day${w.days === 1 ? '' : 's'}` });
    byUser.set(userId, l);
  };
  const holders = new Map<string, number[]>();
  for (const stage of ['check', 'decide', 'pay'] as const) {
    if (!list.some((w) => w.stage === stage)) continue;
    const users = await prisma.user.findMany({ where: { isActive: true, role: { permissions: { some: { permission: { code: REMINDER_PERMISSION[stage] } } } } }, select: { id: true } });
    holders.set(stage, users.map((u) => u.id));
  }
  const active = new Set((await prisma.user.findMany({ where: { isActive: true, id: { in: [...new Set(list.map((w) => w.encoderId))] } }, select: { id: true } })).map((u) => u.id));
  for (const w of list) {
    if (w.stage === 'fix') { if (active.has(w.encoderId)) add(w.encoderId, w); continue; }
    for (const id of holders.get(w.stage) ?? []) {
      if (id === w.encoderId) continue; // nobody acts on their own receipt
      if (w.stage === 'decide' && id === w.checkedById) continue;
      if (w.stage === 'pay' && (id === w.checkedById || id === w.decidedById)) continue;
      add(id, w);
    }
  }
  // People who oversee everything (the Admin) get every overdue receipt at every step, once each, whatever the step.
  const overseers = await prisma.user.findMany({ where: { isActive: true, role: { permissions: { some: { permission: { code: 'reminder.overview' } } } } }, select: { id: true } });
  for (const o of overseers) {
    const have = new Set((byUser.get(o.id) ?? []).map((x) => x.id));
    for (const w of list) if (!have.has(w.id)) add(o.id, w);
  }
  return new Map([...byUser].map(([id, l]) => [id, l.sort((a, b) => b.days - a.days).map((x) => ({ id: x.id, line: x.line }))]));
}

/** Sends each person their reminder (a notice, and an email). Returns how many people were reminded. */
export async function sendReminders(now = new Date()): Promise<number> {
  const map = await reminderLines(now);
  if (!map.size) return 0;
  const users = await prisma.user.findMany({ where: { id: { in: [...map.keys()] } }, select: { id: true, name: true, email: true } });
  for (const u of users) {
    const lines = map.get(u.id)!;
    // The notice opens the receipt that has waited longest.
    await notify({ userIds: [u.id], type: 'reminder', receiptId: lines[0]!.id, text: `${lines.length} receipt${lines.length === 1 ? ' has' : 's have'} been waiting a while: ${lines.map((l) => l.line.split(' · ')[0]).join(', ')}` });
    const mail = await renderEmail({ key: 'reminder', data: { recipientName: u.name.split(' ')[0]!, summary: lines.map((l) => `• ${l}`).join('\n') }, link: config.webOrigin });
    await queueEmail({ userId: u.id, to: u.email, template: 'reminder', subject: mail.subject, html: mail.html });
  }
  return users.length;
}

/** Once a day, after 9am. The unique key claims the day, so a restart or a second process cannot send twice. */
async function runReminders() {
  const now = new Date();
  if (now.getHours() < SEND_HOUR) return;
  try {
    await prisma.sequence.create({ data: { key: `reminders-${now.toISOString().slice(0, 10)}`, value: 1 } });
  } catch {
    return;
  }
  await sendReminders(now);
}

export function startReminders() {
  setInterval(() => void runReminders().catch((e) => console.error('reminders', e)), 15 * 60_000);
  void runReminders().catch((e) => console.error('reminders', e));
}
