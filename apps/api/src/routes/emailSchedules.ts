import { Router } from 'express';
import { emailScheduleSchema, stepsOf } from '@reimsys/shared';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { buildForSchedule, idList, recipientsOf, sendSchedule } from '../lib/emailSchedules.js';
import { badRequest, notFound } from '../lib/errors.js';
import { requireAuth, requirePerm } from '../middleware/auth.js';

export const emailSchedulesRouter = Router();
emailSchedulesRouter.use(requireAuth, requirePerm('settings.manage'));

type Row = Awaited<ReturnType<typeof prisma.emailSchedule.findFirstOrThrow>>;
const idParam = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0 || n > 2_147_483_647) throw notFound('That schedule was not found.');
  return n;
};
const MAX = 30;

const out = async (s: Row) => ({
  id: s.id, name: s.name, isOn: s.isOn, steps: stepsOf(s.steps), minDays: Number(s.minDays), roleIds: idList(s.roleIds), userIds: idList(s.userIds),
  intervalMinutes: s.intervalMinutes, startTime: s.startTime, endTime: s.endTime, days: s.days.split(',').map(Number), timeZone: s.timeZone,
  lastSentAt: s.lastSentAt?.toISOString() ?? null, lastCount: s.lastCount, recipientCount: (await recipientsOf(s)).length,
});
const columns = (d: ReturnType<typeof emailScheduleSchema.parse>) => ({
  name: d.name, isOn: d.isOn, steps: d.steps, minDays: d.minDays, roleIds: d.roleIds.join(','), userIds: d.userIds.join(','),
  intervalMinutes: d.intervalMinutes, startTime: d.startTime, endTime: d.endTime, days: d.days, timeZone: d.timeZone,
});
const find = async (v: unknown) => {
  const s = await prisma.emailSchedule.findUnique({ where: { id: idParam(v) } });
  if (!s) throw notFound('That schedule was not found.');
  return s;
};

/** The roles and people a schedule can be sent to. */
emailSchedulesRouter.get('/choices', async (_req, res) => {
  const [roles, users] = await Promise.all([
    prisma.role.findMany({ orderBy: { rank: 'asc' }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, role: { select: { name: true } } }, take: 1000 }),
  ]);
  res.json({ roles, people: users.map((u) => ({ id: u.id, name: u.name, role: u.role.name })) });
});

emailSchedulesRouter.get('/', async (_req, res) => {
  const rows = await prisma.emailSchedule.findMany({ orderBy: { id: 'asc' } });
  res.json({ schedules: await Promise.all(rows.map(out)) });
});

emailSchedulesRouter.post('/', async (req, res) => {
  const d = emailScheduleSchema.parse(req.body);
  if ((await prisma.emailSchedule.count()) >= MAX) throw badRequest(`There can be up to ${MAX} schedules. Delete one you no longer need.`);
  const s = await prisma.emailSchedule.create({ data: { ...columns(d), createdById: req.auth!.user.id } });
  await audit(req, { action: 'emailschedule.created', entityType: 'email_schedule', entityId: s.id, summary: `created the email schedule "${s.name}"`, after: columns(d) });
  res.status(201).json({ schedule: await out(s) });
});

emailSchedulesRouter.patch('/:id', async (req, res) => {
  const before = await find(req.params.id);
  const cur = await out(before);
  const d = emailScheduleSchema.parse({ ...cur, ...req.body });
  const changedTiming = d.intervalMinutes !== before.intervalMinutes || d.startTime !== before.startTime || d.endTime !== before.endTime || d.days !== before.days || d.timeZone !== before.timeZone;
  const s = await prisma.emailSchedule.update({ where: { id: before.id }, data: { ...columns(d), ...(changedTiming ? { lastSentAt: null } : {}) } });
  await audit(req, { action: 'emailschedule.updated', entityType: 'email_schedule', entityId: s.id, summary: `changed the email schedule "${s.name}"`, before: { ...columns(emailScheduleSchema.parse(cur)) }, after: columns(d) });
  res.json({ schedule: await out(s) });
});

emailSchedulesRouter.delete('/:id', async (req, res) => {
  const s = await find(req.params.id);
  await prisma.emailSchedule.delete({ where: { id: s.id } });
  await audit(req, { action: 'emailschedule.deleted', entityType: 'email_schedule', entityId: s.id, summary: `deleted the email schedule "${s.name}"` });
  res.json({ ok: true });
});

/** Who would get an email right now, and how many receipts each would be told about. Sends nothing. */
emailSchedulesRouter.post('/:id/preview', async (req, res) => {
  const s = await find(req.params.id);
  const batch = await buildForSchedule(s);
  const everyone = await recipientsOf(s);
  res.json({
    recipients: everyone.length,
    wouldSend: batch.map((b) => ({ id: b.user.id, name: b.user.name, role: b.user.role.name, receipts: b.lines.length, first: b.lines.slice(0, 3) })),
    nothingWaiting: everyone.filter((u) => !batch.some((b) => b.user.id === u.id)).map((u) => u.name),
  });
});

/** Sends it now, whatever the hours say. The schedule's own timing is not changed. */
emailSchedulesRouter.post('/:id/send-now', async (req, res) => {
  const s = await find(req.params.id);
  const sent = await sendSchedule(s);
  await audit(req, { action: 'emailschedule.sent_now', entityType: 'email_schedule', entityId: s.id, summary: `sent the email schedule "${s.name}" now to ${sent} ${sent === 1 ? 'person' : 'people'}` });
  res.json({ sent });
});
