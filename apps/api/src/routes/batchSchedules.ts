import { Router } from 'express';
import type { BatchSchedule } from '@prisma/client';
import { Prisma } from '@prisma/client';
import {
  CUTOFF_CLAIM_MS, batchScheduleSchema, batchScheduleUpdateSchema, canUseCutoffRule, cutoffBatchName, cutoffRuleSchema, describeScheduleTiming, fmtCutoff, nextCutoff, parseScheduleDays,
  schedulesOverlap, PAST_CHOICES,
} from '@reimsys/shared';
import { z } from 'zod';
import { prisma } from '../db.js';
import { getSettings } from '../lib/appSettings.js';
import { audit } from '../lib/audit.js';
import { currentBatchOf, ensureCurrent, preview, ruleOf, runCutoff } from '../lib/cutoffs.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { requireAuth, requirePerm } from '../middleware/auth.js';
import { ruleText } from './batches.js';

/** Repeating cutoffs (Batches → Cutoff schedules). See "Batch cutoffs" in docs/PLAN.md. */
export const batchSchedulesRouter = Router();
batchSchedulesRouter.use(requireAuth, requirePerm('batch.schedule'));

const idParam = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0 || n > 2_147_483_647) throw notFound('Schedule not found.');
  return n;
};
const load = async (id: number) => {
  const s = await prisma.batchSchedule.findUnique({ where: { id } });
  if (!s) throw notFound('Schedule not found.');
  return s;
};
const isRunning = (b: { cutoffClaimedAt: Date | null } | null) => !!b?.cutoffClaimedAt && Date.now() - b.cutoffClaimedAt.getTime() < CUTOFF_CLAIM_MS;
const running = () => conflict('Its cutoff is running right now. Try again in a minute.', 'CUTOFF_RUNNING');
const ruleNotAllowed = () => forbidden('Only people who can see every receipt can take receipts that are still in progress. Choose approved receipts only.', 'RULE_NOT_ALLOWED');
const whenPastSchema = z.object({ whenPast: z.enum(PAST_CHOICES).optional() });
const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

batchSchedulesRouter.get('/choices', async (req, res) => {
  const [locations, people] = await Promise.all([
    prisma.chargeLocation.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    // People whose receipts a run can take: those who encode receipts.
    prisma.user.findMany({ where: { isActive: true, role: { permissions: { some: { permission: { code: 'receipt.create' } } } } }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  res.json({ locations, people, timeZone: getSettings().emailTimeZone, canUseInProgress: req.auth!.permissions.has('receipt.view_all') });
});

/** What a rule would take if it ran now. */
batchSchedulesRouter.post('/preview', async (req, res) => {
  const rule = cutoffRuleSchema.parse(req.body?.rule);
  if (!canUseCutoffRule(req.auth!.permissions, rule)) throw ruleNotAllowed();
  const tz = typeof req.body?.timeZone === 'string' && req.body.timeZone ? req.body.timeZone : getSettings().emailTimeZone;
  try { res.json(await preview(rule, tz)); } catch { res.json(await preview(rule, getSettings().emailTimeZone)); }
});

batchSchedulesRouter.get('/', async (_req, res) => {
  const all = await prisma.batchSchedule.findMany({ include: { createdBy: { select: { name: true } } }, orderBy: { id: 'asc' } });
  const rules = new Map(all.map((s) => [s.id, ruleOf(s.rule)]));
  const out = [];
  for (const s of all) {
    const rule = rules.get(s.id)!;
    const [current, last] = await Promise.all([
      currentBatchOf(s.id),
      s.lastBatchId ? prisma.batch.findUnique({ where: { id: s.lastBatchId }, select: { id: true, code: true } }) : Promise.resolve(null),
    ]);
    out.push({
      id: s.id, name: s.name, isOn: s.isOn, repeat: s.repeat, days: parseScheduleDays(s.repeat, s.days) ?? [], time: s.time, timeZone: s.timeZone, rule,
      when: describeScheduleTiming(s), ruleText: await ruleText(rule),
      current: current ? { id: current.id, code: current.code, cutoffAt: current.cutoffAt } : null,
      lastRunAt: s.lastRunAt, lastCount: s.lastCount, lastBatch: last,
      overlaps: s.isOn ? all.filter((o) => o.id !== s.id && o.isOn && schedulesOverlap(rule, rules.get(o.id)!)).map((o) => o.name) : [],
      createdBy: s.createdBy.name,
    });
  }
  res.json({ schedules: out });
});

batchSchedulesRouter.post('/', async (req, res) => {
  const body = batchScheduleSchema.parse(req.body);
  if (!canUseCutoffRule(req.auth!.permissions, body.rule)) throw ruleNotAllowed();
  if (!nextCutoff(body, new Date())) throw badRequest('This schedule never comes round. Check the days and the time.', 'NO_NEXT_CUTOFF');
  const s = await prisma.batchSchedule.create({
    data: { name: body.name, isOn: body.isOn, repeat: body.repeat, days: body.days, time: body.time, timeZone: body.timeZone, rule: JSON.stringify(body.rule), createdById: req.auth!.user.id },
  });
  const batch = await ensureCurrent(s);
  await audit(req, { action: 'batchschedule.created', entityType: 'batchschedule', entityId: s.id, summary: `created the cutoff schedule “${s.name}”: ${describeScheduleTiming(s)}`, after: { ...body } });
  res.status(201).json({ schedule: { id: s.id }, batch: batch ? { id: batch.id, code: batch.code, cutoffAt: batch.cutoffAt } : null });
});

/**
 * A full change (with a name) or just switching it on or off. A change applies to its open batch too; closed batches never change.
 * If the change puts this run's cutoff in the past, nothing is saved until `whenPast` says to run it now or skip to the next one.
 */
batchSchedulesRouter.patch('/:id', async (req, res) => {
  const s = await load(idParam(req.params.id));
  const current = await currentBatchOf(s.id);
  if (isRunning(current)) throw running();
  const now = new Date();

  if (req.body && typeof req.body === 'object' && 'name' in req.body) {
    const body = batchScheduleSchema.parse({ ...req.body, isOn: s.isOn });
    const { whenPast } = whenPastSchema.parse(req.body);
    if (!canUseCutoffRule(req.auth!.permissions, body.rule)) throw ruleNotAllowed();
    const changed: BatchSchedule = { ...s, name: body.name, repeat: body.repeat, days: body.days, time: body.time, timeZone: body.timeZone, rule: JSON.stringify(body.rule) };
    if (!nextCutoff(changed, now)) throw badRequest('This schedule never comes round. Check the days and the time.', 'NO_NEXT_CUTOFF');
    let cutoffAt: Date | null = current?.cutoffAt ?? null;
    let lastSlotAt = s.lastSlotAt;
    let runNow = false;
    if (s.isOn && current?.cutoffAt) {
      // This run's cutoff under the new settings: the first slot after the last one that ran (or since it was made or switched on).
      const slot = nextCutoff(changed, s.lastSlotAt ?? s.createdAt)!;
      if (slot.getTime() <= now.getTime()) {
        const next = nextCutoff(changed, now)!;
        if (!whenPast) throw conflict(`With these settings this run’s cutoff would have been ${fmtCutoff(slot, changed.timeZone)}, which has passed. Run it now, or skip to the next one (${fmtCutoff(next, changed.timeZone)}).`, 'CUTOFF_PAST');
        if (whenPast === 'skip') { cutoffAt = next; lastSlotAt = slot; } else { cutoffAt = slot; runNow = true; }
      } else cutoffAt = slot;
    }
    try {
      await prisma.$transaction(async (tx) => {
        await tx.batchSchedule.update({ where: { id: s.id }, data: { name: changed.name, repeat: changed.repeat, days: changed.days, time: changed.time, timeZone: changed.timeZone, rule: changed.rule, lastSlotAt } });
        if (current) {
          const n = await tx.batch.updateMany({
            where: { id: current.id, cutoffDoneAt: null, OR: [{ cutoffClaimedAt: null }, { cutoffClaimedAt: { lt: new Date(now.getTime() - CUTOFF_CLAIM_MS) } }] },
            data: { cutoffRule: changed.rule, ...(cutoffAt ? { cutoffAt, name: cutoffBatchName(changed.name, cutoffAt, changed.timeZone) } : {}) },
          });
          if (!n.count) throw running();
        }
      });
    } catch (e) {
      if (isUnique(e)) throw conflict('Another batch of this schedule already has that cutoff time.', 'CUTOFF_TAKEN');
      throw e;
    }
    await audit(req, { action: 'batchschedule.updated', entityType: 'batchschedule', entityId: s.id, summary: `changed the cutoff schedule “${changed.name}”: ${describeScheduleTiming(changed)}${whenPast === 'skip' ? ' (this run skipped to the next slot)' : whenPast === 'run' ? ' (this run ran at once)' : ''}`, before: { name: s.name, repeat: s.repeat, days: s.days, time: s.time, timeZone: s.timeZone, rule: ruleOf(s.rule) }, after: { ...body } });
    const ran = runNow && current ? await runCutoff(current.id, { id: req.auth!.user.id, name: req.auth!.user.name }) : null;
    if (!current) await ensureCurrent(await load(s.id));
    return res.json({ ok: true, ...(ran ? { ran } : {}) });
  }

  const body = batchScheduleUpdateSchema.parse(req.body ?? {});
  if (body.isOn === undefined || body.isOn === s.isOn) return res.json({ ok: true });
  if (!body.isOn) {
    // Paused: its open batch keeps its receipts and becomes an ordinary batch without a cutoff until the schedule is switched on again.
    await prisma.$transaction(async (tx) => {
      await tx.batchSchedule.update({ where: { id: s.id }, data: { isOn: false } });
      if (current) {
        const n = await tx.batch.updateMany({ where: { id: current.id, cutoffDoneAt: null, OR: [{ cutoffClaimedAt: null }, { cutoffClaimedAt: { lt: new Date(now.getTime() - CUTOFF_CLAIM_MS) } }] }, data: { cutoffAt: null } });
        if (!n.count) throw running();
      }
    });
    await audit(req, { action: 'batchschedule.paused', entityType: 'batchschedule', entityId: s.id, summary: `paused the cutoff schedule “${s.name}”` });
    return res.json({ ok: true });
  }
  // Switched on: the slots it missed while paused are skipped, not run. A slot already used (a run done early) stays used.
  const on = await prisma.batchSchedule.update({ where: { id: s.id }, data: { isOn: true, lastSlotAt: s.lastSlotAt && s.lastSlotAt > now ? s.lastSlotAt : now } });
  const batch = await ensureCurrent(on, now);
  await audit(req, { action: 'batchschedule.resumed', entityType: 'batchschedule', entityId: s.id, summary: `switched the cutoff schedule “${s.name}” back on${batch?.cutoffAt ? `; next cutoff ${fmtCutoff(batch.cutoffAt, s.timeZone)}` : ''}` });
  res.json({ ok: true });
});

/** Its open batch is deleted when empty, or kept as an ordinary batch with its receipts. Past batches keep their history. */
batchSchedulesRouter.delete('/:id', async (req, res) => {
  const s = await load(idParam(req.params.id));
  const current = await currentBatchOf(s.id);
  if (isRunning(current)) throw running();
  let kept: string | null = null;
  await prisma.$transaction(async (tx) => {
    if (current) {
      // A run's later parts point at their first batch; MySQL cannot check that inside the delete itself.
      const hasParts = await tx.batch.count({ where: { partOfId: current.id } });
      const gone = hasParts ? { count: 0 } : await tx.batch.deleteMany({ where: { id: current.id, receipts: { none: {} } } });
      if (!gone.count) { await tx.batch.update({ where: { id: current.id }, data: { cutoffAt: null, cutoffRule: null } }); kept = current.code; }
    }
    await tx.batchSchedule.delete({ where: { id: s.id } });
  });
  await audit(req, { action: 'batchschedule.deleted', entityType: 'batchschedule', entityId: s.id, summary: `deleted the cutoff schedule “${s.name}”${kept ? `; its open batch ${kept} stays without a cutoff` : ''}`, before: { name: s.name, repeat: s.repeat, days: s.days, time: s.time, timeZone: s.timeZone, rule: ruleOf(s.rule) } });
  res.json({ ok: true, kept });
});
