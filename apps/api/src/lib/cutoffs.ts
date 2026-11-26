import { Prisma, type BatchSchedule } from '@prisma/client';
import {
  CUTOFF_CLAIM_MS, CUTOFF_PART_SIZE, CUTOFF_STATUSES, batchLabel, cutoffBatchName, fmtCutoff, nextCutoff, parseCutoffRule, zonedDate, type CutoffRule,
} from '@reimsys/shared';
import { prisma, type Tx } from '../db.js';
import { getSettings, settingsReady } from './appSettings.js';
import { audit } from './audit.js';
import { notify, usersWithPermission } from './notify.js';
import { nextBatchCode } from './sequence.js';

/**
 * Batch cutoffs (docs/PLAN.md, "Batch cutoffs"). A batch with a cutoff fills itself at that time with the receipts that match its
 * rule and are in no batch, then closes. A repeating schedule keeps one such batch open and opens the next when it runs.
 * Every step can safely run twice: the run is claimed first, receipts are only ever taken from "no batch", and the database refuses
 * a second batch for the same schedule and cutoff.
 */

export interface Actor { id: number | null; name: string }
type ScheduleRow = BatchSchedule;
class NothingLeft extends Error {}

export const php = (n: number) => 'PHP ' + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cents = (rows: { amount: Prisma.Decimal | number }[]) => rows.reduce((s, r) => s + Math.round(Number(r.amount) * 100), 0) / 100;
export const listOf = (rows: { refNo: string; payee: string; amount: Prisma.Decimal | number }[]) => {
  const shown = rows.slice(0, 30).map((r) => `• ${r.refNo} · ${r.payee} · ${php(Number(r.amount))}`);
  return [...shown, ...(rows.length > shown.length ? [`… and ${rows.length - shown.length} more`] : [])].join('\n');
};
const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
const later = (a: Date, b: Date) => (a.getTime() > b.getTime() ? a : b);

/** The time zone a batch's cutoff is read in: its schedule's, or the system's (Settings). */
export const zoneOf = (b: { schedule?: { timeZone: string } | null }) => b.schedule?.timeZone ?? getSettings().emailTimeZone;
/** The stored rule, or approved receipts only when it is missing or damaged (the safest choice). */
export const ruleOf = (v: string | null): CutoffRule => parseCutoffRule(v) ?? { statuses: 'approved', date: 'approved', chargeLocationIds: [], encoderIds: [] };

/** The receipts a rule takes at a cutoff: the chosen statuses, the chosen date at or before the cutoff, the filters, and in no batch. */
export function ruleWhere(rule: CutoffRule, cut: Date, timeZone: string): Prisma.ReceiptWhereInput {
  const and: Prisma.ReceiptWhereInput[] = [{ batchId: null }, { status: { in: [...CUTOFF_STATUSES[rule.statuses]] } }];
  if (rule.date === 'approved') and.push({ decidedAt: { lte: cut } });
  else if (rule.date === 'submitted') and.push({ submittedAt: { lte: cut } });
  // The receipt date has no time: on or before the cutoff's own day where the schedule is.
  else and.push({ receiptDate: { lte: new Date(`${zonedDate(cut, timeZone).iso}T00:00:00.000Z`) } });
  if (rule.chargeLocationIds.length) and.push({ chargeLocationId: { in: rule.chargeLocationIds } });
  if (rule.encoderIds.length) and.push({ encoderId: { in: rule.encoderIds } });
  return { AND: and };
}

/** How many receipts (and for how much) a rule would take if it ran now. */
export async function preview(rule: CutoffRule, timeZone: string, now = new Date()) {
  const where = ruleWhere(rule, now, timeZone);
  const [count, sum] = await Promise.all([prisma.receipt.count({ where }), prisma.receipt.aggregate({ where, _sum: { amount: true } })]);
  return { count, total: Math.round(Number(sum._sum.amount ?? 0) * 100) / 100 };
}

/** A schedule's open batch: the one it made whose cutoff has not run yet. */
export const currentBatchOf = (scheduleId: number, tx: Tx | typeof prisma = prisma) =>
  tx.batch.findFirst({ where: { scheduleId, cutoffDoneAt: null, part: 1 }, orderBy: { id: 'desc' } });

/** Makes sure a switched-on schedule has its open batch with the next cutoff. Safe to call any number of times, from any server. */
export async function ensureCurrent(s: ScheduleRow, now = new Date()) {
  if (!s.isOn) return null;
  const after = s.lastSlotAt ? later(s.lastSlotAt, now) : now;
  const at = nextCutoff(s, after);
  if (!at) return null;
  const current = await currentBatchOf(s.id);
  if (current) {
    if (current.cutoffAt) return current;
    // Switched back on: the batch it kept gets its next cutoff again.
    try {
      return await prisma.batch.update({ where: { id: current.id }, data: { cutoffAt: at, cutoffRule: s.rule, name: cutoffBatchName(s.name, at, s.timeZone) } });
    } catch (e) { if (isUnique(e)) return current; throw e; }
  }
  try {
    const b = await prisma.$transaction(async (tx) => tx.batch.create({
      data: { code: await nextBatchCode(tx), name: cutoffBatchName(s.name, at, s.timeZone), createdById: s.createdById, scheduleId: s.id, cutoffAt: at, cutoffRule: s.rule },
    }));
    await audit(null, { action: 'batch.created', entityType: 'batch', entityId: b.id, summary: `opened batch ${batchLabel(b)} for cutoff schedule "${s.name}"`, after: { code: b.code, cutoffAt: at, schedule: s.name }, actor: { id: null, name: `System (cutoff schedule ${s.name})` } });
    return b;
  } catch (e) {
    // Another server (or tick) opened it first.
    if (isUnique(e)) return currentBatchOf(s.id);
    throw e;
  }
}

export type RunResult =
  | { kind: 'ran'; added: number; total: number; parts: { id: number; code: string; count: number }[]; next: Date | null }
  | { kind: 'empty'; next: Date | null }
  | { kind: 'cancelled' };

/** Locks the batch row for the rest of the transaction, and checks this run still holds the claim. */
async function lockClaimed(tx: Tx, id: number, claim: Date) {
  const n = await tx.batch.updateMany({ where: { id, cutoffClaimedAt: claim }, data: { updatedAt: new Date() } });
  return n.count === 1;
}

/** Puts up to `room` matching receipts into the batch. Only receipts still in no batch, at an allowed status, are moved. */
async function fillInto(tx: Tx, batchId: number, where: Prisma.ReceiptWhereInput, statuses: readonly string[], room: number) {
  if (room <= 0) return [];
  const ids = (await tx.receipt.findMany({ where, select: { id: true }, orderBy: { id: 'asc' }, take: room })).map((r) => r.id);
  if (!ids.length) return [];
  await tx.receipt.updateMany({ where: { id: { in: ids }, batchId: null, status: { in: [...statuses] } }, data: { batchId, batchLateAt: null, batchLateNote: null } });
  return tx.receipt.findMany({ where: { id: { in: ids }, batchId }, select: { id: true, refNo: true, payee: true, amount: true }, orderBy: { id: 'asc' } });
}

/**
 * Runs one batch's cutoff. `due` (the worker) only takes a batch whose time has come; without it (Run cutoff now) an earlier time is
 * fine and that slot is used up. Returns null when the batch has no cutoff waiting, or another run holds it.
 */
export async function runCutoff(batchId: number, actor: Actor, opts: { now?: Date; due?: boolean } = {}): Promise<RunResult | null> {
  const now = opts.now ?? new Date();
  const claim = new Date(now.getTime());
  const claimed = await prisma.batch.updateMany({
    where: {
      id: batchId, cutoffAt: opts.due ? { lte: now } : { not: null }, cutoffDoneAt: null,
      OR: [{ cutoffClaimedAt: null }, { cutoffClaimedAt: { lt: new Date(now.getTime() - CUTOFF_CLAIM_MS) } }],
    },
    data: { cutoffClaimedAt: claim },
  });
  if (!claimed.count) return null;
  const b = await prisma.batch.findUnique({ where: { id: batchId }, include: { schedule: true } });
  if (!b || !b.cutoffAt) return null;
  const s = b.schedule;
  const tz = zoneOf(b);
  const cutoffAt = b.cutoffAt!;

  // Closed by hand before its cutoff (closing normally cancels the cutoff straight away; this covers a close that raced the run).
  if (b.closedAt) {
    await prisma.batch.updateMany({ where: { id: b.id, cutoffClaimedAt: claim }, data: s ? { cutoffAt: null, cutoffDoneAt: now, cutoffClaimedAt: null } : { cutoffAt: null, cutoffRule: null, cutoffClaimedAt: null } });
    await audit(null, { action: 'batch.cutoff_cancelled', entityType: 'batch', entityId: b.id, summary: `cutoff of batch ${b.code} cancelled: it was closed by hand first`, actor });
    if (s) await ensureCurrent(await prisma.batchSchedule.update({ where: { id: s.id }, data: { lastSlotAt: cutoffAt } }), now);
    return { kind: 'cancelled' };
  }

  const rule = ruleOf(b.cutoffRule);
  // A run that is late (the server was off) still takes only what had arrived by the cutoff; an early run takes what is there now.
  const cut = cutoffAt.getTime() < now.getTime() ? cutoffAt : now;
  const where = ruleWhere(rule, cut, tz);
  const statuses = CUTOFF_STATUSES[rule.statuses];

  const added = await prisma.$transaction(async (tx) => {
    if (!(await lockClaimed(tx, b.id, claim))) return null;
    const have = await tx.receipt.count({ where: { batchId: b.id } });
    return fillInto(tx, b.id, where, statuses, CUTOFF_PART_SIZE - have);
  }, { timeout: 60_000 });
  if (added === null) return null; // another run took over

  // More than one batch holds: the rest go into part 2, 3 ... of the same run, closed at once. Nothing is dropped.
  const parts: { id: number; code: string; count: number; rows: Awaited<ReturnType<typeof fillInto>> }[] = [];
  for (let guard = 0; guard < 100; guard++) {
    if (!(await prisma.receipt.count({ where }))) break;
    const made = await prisma.$transaction(async (tx) => {
      if (!(await lockClaimed(tx, b.id, claim))) return null;
      if (!(await tx.receipt.count({ where }))) return null;
      const last = await tx.batch.aggregate({ where: { partOfId: b.id }, _max: { part: true } });
      const part = Math.max(1, last._max.part ?? 1) + 1;
      const p = await tx.batch.create({
        data: {
          code: await nextBatchCode(tx), name: s ? cutoffBatchName(s.name, cutoffAt, tz, part) : `${(b.name ?? b.code).slice(0, 66)} (part ${part})`,
          createdById: b.createdById, scheduleId: b.scheduleId, cutoffAt, cutoffRule: b.cutoffRule, part, partOfId: b.id, closedAt: now, cutoffDoneAt: now,
        },
      });
      const rows = await fillInto(tx, p.id, where, statuses, CUTOFF_PART_SIZE);
      // Someone took them meanwhile: undo, so no empty part is left behind.
      if (!rows.length) throw new NothingLeft();
      return { id: p.id, code: p.code, count: rows.length, rows };
    }, { timeout: 60_000 }).catch((e) => { if (isUnique(e) || e instanceof NothingLeft) return null; throw e; });
    if (!made) break;
    parts.push(made);
  }

  const inBatch = await prisma.receipt.count({ where: { batchId: b.id } });
  const label = batchLabel(b);
  const makers = [...new Set([...(await usersWithPermission('batch.manage')), ...(s ? [s.createdById] : [])])].filter((id) => id !== actor.id);

  if (!inBatch && !parts.length) {
    // Nothing matched and nothing was added by hand: no empty closed batch. A schedule's batch waits for the next slot.
    const next = s && s.isOn ? nextCutoff(s, later(cutoffAt, now)) : null;
    if (s && next) {
      await prisma.batch.updateMany({ where: { id: b.id, cutoffClaimedAt: claim }, data: { cutoffAt: next, cutoffClaimedAt: null, name: cutoffBatchName(s.name, next, tz) } });
      await prisma.batchSchedule.update({ where: { id: s.id }, data: { lastSlotAt: cutoffAt, lastRunAt: now, lastCount: 0 } });
      await audit(null, { action: 'batch.cutoff_rolled', entityType: 'batch', entityId: b.id, summary: `nothing matched at the cutoff of ${b.code}; it moved to ${fmtCutoff(next, tz)}`, before: { cutoffAt }, after: { cutoffAt: next }, actor });
      await notify({ userIds: [s.createdById].filter((id) => id !== actor.id), type: 'batch.cutoff_empty', batchId: b.id, text: `${b.code}: nothing matched at the cutoff (${fmtCutoff(cutoffAt, tz)}), so it stays open until ${fmtCutoff(next, tz)}.` });
      return { kind: 'empty', next };
    }
    await prisma.batch.updateMany({ where: { id: b.id, cutoffClaimedAt: claim }, data: { cutoffAt: null, cutoffRule: null, cutoffClaimedAt: null } });
    await audit(null, { action: 'batch.cutoff_empty', entityType: 'batch', entityId: b.id, summary: `nothing matched at the cutoff of ${b.code}; it stays open without a cutoff`, before: { cutoffAt }, actor });
    await notify({ userIds: [b.createdById].filter((id) => id !== actor.id), type: 'batch.cutoff_empty', batchId: b.id, text: `${b.code}: nothing matched at the cutoff (${fmtCutoff(cutoffAt, tz)}). It stays open, without a cutoff.` });
    return { kind: 'empty', next: null };
  }

  await prisma.batch.updateMany({ where: { id: b.id, cutoffClaimedAt: claim }, data: { closedAt: now, cutoffDoneAt: now, cutoffClaimedAt: null } });
  let next: Date | null = null;
  if (s) {
    await prisma.batchSchedule.update({ where: { id: s.id }, data: { lastSlotAt: cutoffAt, lastRunAt: now, lastBatchId: b.id, lastCount: added.length + parts.reduce((n, p) => n + p.count, 0) } });
    const fresh = await prisma.batchSchedule.findUnique({ where: { id: s.id } });
    if (fresh) next = (await ensureCurrent(fresh, now))?.cutoffAt ?? null;
  }

  const allRows = [...added, ...parts.flatMap((p) => p.rows)];
  for (const [code, rows] of [[b.code, added], ...parts.map((p) => [p.code, p.rows] as const)] as const) {
    for (const r of rows) await audit(null, { action: 'batch.receipt_added', entityType: 'receipt', entityId: r.id, summary: `added to batch ${code} at its cutoff`, after: { batch: code }, actor });
  }
  const partText = parts.map((p) => `${p.code} (${p.count})`).join(', ');
  await audit(null, {
    action: 'batch.cutoff_run', entityType: 'batch', entityId: b.id,
    summary: `cutoff of batch ${b.code} ran: ${added.length} receipt${added.length === 1 ? '' : 's'} added${partText ? `, more in ${partText}` : ''}; closed`,
    after: { cutoffAt, cut, added: added.map((r) => r.refNo), parts: parts.map((p) => ({ code: p.code, count: p.count })), next }, actor,
  });

  const total = cents(allRows);
  const count = allRows.length;
  const summary = `${count ? `${count} receipt${count === 1 ? ' was' : 's were'} added (${php(total)})` : 'Only the receipts added by hand are in it'} and the batch is closed.`
    + (partText ? ` The batch holds ${CUTOFF_PART_SIZE}, so the rest went into ${partText}.` : '')
    + (next ? ` Next cutoff: ${fmtCutoff(next, tz)}.` : '');
  await notify({ userIds: makers, type: 'batch.cutoff_ran', batchId: b.id, text: `${label} closed at cutoff. ${summary}`, email: { template: 'batch_cutoff', data: { batchCode: label, summary, receiptList: listOf(allRows) } } });
  return { kind: 'ran', added: added.length, total, parts: parts.map(({ id, code, count: c }) => ({ id, code, count: c })), next };
}

/** One tick: open the batches schedules need, then run every cutoff whose time has come. */
export async function runDueCutoffs(now = new Date()) {
  for (const s of await prisma.batchSchedule.findMany({ where: { isOn: true } })) {
    try { await ensureCurrent(s, now); } catch (e) { console.error(`cutoff schedule ${s.id}`, e); }
  }
  const due = await prisma.batch.findMany({
    where: { cutoffAt: { lte: now }, cutoffDoneAt: null, OR: [{ cutoffClaimedAt: null }, { cutoffClaimedAt: { lt: new Date(now.getTime() - CUTOFF_CLAIM_MS) } }] },
    select: { id: true, schedule: { select: { name: true } } }, orderBy: { cutoffAt: 'asc' }, take: 50,
  });
  for (const d of due) {
    try { await runCutoff(d.id, { id: null, name: d.schedule ? `System (cutoff schedule ${d.schedule.name})` : 'System (cutoff)' }, { now, due: true }); }
    catch (e) { console.error(`cutoff of batch ${d.id} failed; it is tried again in ${CUTOFF_CLAIM_MS / 60_000} minutes`, e); }
  }
}

let running = false;
export function startCutoffs() {
  const tick = async () => {
    if (running) return;
    running = true;
    try { await settingsReady; await runDueCutoffs(); } catch (e) { console.error('cutoffs', e); } finally { running = false; }
  };
  setInterval(() => void tick(), 60_000).unref();
  void tick();
}
