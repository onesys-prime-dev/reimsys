import { Router, type Request } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import type { Prisma } from '@prisma/client';
import { Prisma as P } from '@prisma/client';
import {
  BATCHABLE_STATUSES, BATCH_ACTION_PERMISSION, BATCH_MAX, CUTOFF_CLAIM_MS, EVIDENCE_MAX_BYTES, STATUS_LABEL,
  batchActionSchema, batchAddSchema, batchCreateWithCutoffSchema, batchCutoffSchema, batchDoneText, batchLabel, batchListQuerySchema, batchPaySchema, batchUpdateSchema,
  canAddToBatch, canRemoveFromBatch, canUseCutoffRule, canViewBatches, cleanDeep, likeSafe, cutoffBatchName, cutoffRuleSchema, cutoffState, describeCutoffRule, fmtCutoff, isLateBatch, lateAddSchema,
  type BatchAction, type CutoffRule, type ReceiptStatus,
} from '@reimsys/shared';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { ensureCurrent, preview, ruleOf, ruleWhere, runCutoff, zoneOf, type Actor } from '../lib/cutoffs.js';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { notify, usersWithPermission } from '../lib/notify.js';
import { recordPayments } from '../lib/payments.js';
import { receiptBrief, receiptInclude, visibleWhere } from '../lib/receipts.js';
import { nextBatchCode } from '../lib/sequence.js';
import { requireAuth, requirePerm } from '../middleware/auth.js';
import { runAction } from './receipts.js';
import type { AuthContext } from '../types.js';

export const batchesRouter = Router();
batchesRouter.use(requireAuth);
// Med Refs work on their own receipts one by one; the batch pages are for those who make batches and those who act on them.
batchesRouter.use((req, _res, next) => next(canViewBatches(req.auth!.permissions) ? undefined : forbidden()));

const idParam = (v: unknown, what = 'Batch') => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0 || n > 2_147_483_647) throw notFound(`${what} not found.`);
  return n;
};
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: EVIDENCE_MAX_BYTES, files: 1 } });
const payLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false, message: { error: { code: 'RATE_LIMIT', message: 'Too many payments in a minute. Wait a moment.' } } });

type Step = BatchAction | 'pay';
const STEPS: Step[] = ['check', 'approve', 'pay'];

/** Not this person, written so a receipt with nobody recorded yet still counts (in SQL a comparison with an empty value is never true). */
const notBy = (field: 'checkedById' | 'decidedById', userId: number): Prisma.ReceiptWhereInput => ({ OR: [{ [field]: null }, { [field]: { not: userId } }] });

/** Receipts waiting for this person at one step: the right status, and never their own or one they already checked or decided. */
function readyWhere(auth: AuthContext, step: Step): Prisma.ReceiptWhereInput {
  const me = auth.user.id;
  if (step === 'check') return { status: 'submitted', encoderId: { not: me } };
  if (step === 'approve') return { AND: [{ status: 'checked', encoderId: { not: me } }, notBy('checkedById', me)] };
  return { AND: [{ status: 'approved', encoderId: { not: me } }, notBy('checkedById', me), notBy('decidedById', me)] };
}
const isReady = (auth: AuthContext, step: Step, r: { status: string; encoderId: number; checkedById: number | null; decidedById: number | null }) => {
  const me = auth.user.id;
  if (r.encoderId === me) return false;
  if (step === 'check') return r.status === 'submitted';
  if (step === 'approve') return r.status === 'checked' && r.checkedById !== me;
  return r.status === 'approved' && r.checkedById !== me && r.decidedById !== me;
};
const stepsFor = (auth: AuthContext) => STEPS.filter((s) => auth.permissions.has(BATCH_ACTION_PERMISSION[s]));

const batchIncludes = { createdBy: { select: { id: true, name: true } }, schedule: true } satisfies P.BatchInclude;
async function loadBatch(id: number) {
  const b = await prisma.batch.findUnique({ where: { id }, include: batchIncludes });
  if (!b) throw notFound('Batch not found.');
  return b;
}
type BatchRow = Awaited<ReturnType<typeof loadBatch>>;
const batchHead = (b: BatchRow) => ({
  id: b.id, code: b.code, name: b.name, closed: !!b.closedAt, closedAt: b.closedAt, createdAt: b.createdAt, createdBy: b.createdBy,
  cutoffAt: b.cutoffAt, cutoffState: cutoffState(b), timeZone: zoneOf(b), schedule: b.schedule ? { id: b.schedule.id, name: b.schedule.name, isOn: b.schedule.isOn } : null, part: b.part,
});
/** A cutoff run holds the batch for a moment; a claim older than the limit belongs to a run that died and is taken over. */
const isRunning = (b: { cutoffClaimedAt: Date | null }) => !!b.cutoffClaimedAt && Date.now() - b.cutoffClaimedAt.getTime() < CUTOFF_CLAIM_MS;
const actorOf = (req: Request): Actor => ({ id: req.auth!.user.id, name: req.auth!.user.name });
const isUnique = (e: unknown) => e instanceof P.PrismaClientKnownRequestError && e.code === 'P2002';
const DEFAULT_RULE: CutoffRule = cutoffRuleSchema.parse({ statuses: 'approved' });
const ruleNotAllowed = () => forbidden('Only people who can see every receipt can take receipts that are still in progress. Choose approved receipts only.', 'RULE_NOT_ALLOWED');

/** Names for the places and people a rule names, so it can be said in plain words. */
export async function ruleText(rule: CutoffRule) {
  const [locations, people] = await Promise.all([
    rule.chargeLocationIds.length ? prisma.chargeLocation.findMany({ where: { id: { in: rule.chargeLocationIds } }, select: { name: true }, orderBy: { name: 'asc' } }) : [],
    rule.encoderIds.length ? prisma.user.findMany({ where: { id: { in: rule.encoderIds } }, select: { name: true }, orderBy: { name: 'asc' } }) : [],
  ]);
  return describeCutoffRule(rule, { locations: locations.map((l) => l.name), people: people.map((p) => p.name) });
}
const php = (n: number) => 'PHP ' + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ---------- list and find ---------- */

batchesRouter.get('/', async (req, res) => {
  const auth = req.auth!;
  const q = batchListQuerySchema.parse(req.query);
  const where: Prisma.BatchWhereInput = {
    AND: [
      q.state === 'open' ? { closedAt: null } : q.state === 'closed' ? { closedAt: { not: null } } : {},
      q.q ? { OR: [{ code: { contains: likeSafe(q.q) } }, { name: { contains: likeSafe(q.q) } }] } : {},
    ],
  };
  const batches = await prisma.batch.findMany({ where, include: batchIncludes, orderBy: { id: 'desc' }, take: 100 });
  const ids = batches.map((b) => b.id);
  // Counts and totals are of the receipts this person can see, the same as everywhere else.
  const grouped = ids.length ? await prisma.receipt.groupBy({ by: ['batchId', 'status'], where: { AND: [visibleWhere(auth), { batchId: { in: ids } }] }, _count: { _all: true }, _sum: { amount: true } }) : [];
  const waiting = new Map<string, number>();
  for (const step of stepsFor(auth)) {
    if (!ids.length) break;
    const g = await prisma.receipt.groupBy({ by: ['batchId'], where: { AND: [visibleWhere(auth), { batchId: { in: ids } }, readyWhere(auth, step)] }, _count: { _all: true } });
    for (const x of g) waiting.set(`${x.batchId}:${step}`, x._count._all);
  }
  res.json({
    canManage: auth.permissions.has('batch.manage'),
    // The time zone cutoffs are read in when a batch has no schedule of its own (Settings).
    timeZone: zoneOf({}),
    batches: batches.map((b) => {
      const mine = grouped.filter((g) => g.batchId === b.id);
      const counts: Record<string, number> = {};
      for (const g of mine) counts[g.status] = g._count._all;
      return {
        ...batchHead(b),
        count: mine.reduce((s, g) => s + g._count._all, 0),
        total: mine.reduce((s, g) => s + Math.round(Number(g._sum.amount ?? 0) * 100), 0) / 100,
        counts,
        waiting: Object.fromEntries(stepsFor(auth).map((s) => [s, waiting.get(`${b.id}:${s}`) ?? 0])),
      };
    }),
  });
});

/** Typing a code: B-2026-000004 opens that batch. */
batchesRouter.get('/lookup', async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code.trim().slice(0, 30) : '';
  if (!code) throw badRequest('Type a batch code.', 'NO_CODE');
  const b = await prisma.batch.findUnique({ where: { code: code.toUpperCase() }, select: { id: true } });
  if (!b) throw notFound(`No batch with the code ${code}.`);
  res.json({ id: b.id });
});

/* ---------- one batch ---------- */

batchesRouter.get('/:id', async (req, res) => {
  const auth = req.auth!;
  const b = await loadBatch(idParam(req.params.id));
  const [rows, all] = await Promise.all([
    prisma.receipt.findMany({ where: { AND: [{ batchId: b.id }, visibleWhere(auth)] }, include: receiptInclude, orderBy: [{ encoderId: 'asc' }, { id: 'asc' }], take: BATCH_MAX + 50 }),
    prisma.receipt.count({ where: { batchId: b.id } }),
  ]);
  const steps = stepsFor(auth);
  const readyFor = (r: (typeof rows)[number]) => steps.find((s) => isReady(auth, s, r)) ?? null;
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const canManage = auth.permissions.has('batch.manage');
  const state = cutoffState(b);
  const tz = zoneOf(b);
  const rule = b.cutoffRule ? ruleOf(b.cutoffRule) : null;
  const late = isLateBatch(b);
  const [unfinished, parts, partOf, would, lateCount] = await Promise.all([
    late ? prisma.receipt.count({ where: { batchId: b.id, status: { in: [...BATCHABLE_STATUSES] } } }) : Promise.resolve(0),
    prisma.batch.findMany({ where: { partOfId: b.id }, select: { id: true, code: true }, orderBy: { part: 'asc' } }),
    b.partOfId ? prisma.batch.findUnique({ where: { id: b.partOfId }, select: { id: true, code: true } }) : Promise.resolve(null),
    // What the cutoff would take if it ran now, and how much of that this person can see.
    state === 'pending' && rule && canManage
      ? Promise.all([preview(rule, tz), prisma.receipt.count({ where: { AND: [visibleWhere(auth), ruleWhere(rule, new Date(), tz)] } })]).then(([p, seen]) => ({ ...p, hidden: p.count - seen }))
      : Promise.resolve(null),
    prisma.receipt.count({ where: { batchId: b.id, batchLateAt: { not: null } } }),
  ]);
  res.json({
    batch: {
      ...batchHead(b),
      cutoff: b.cutoffAt || state !== 'none' ? {
        at: b.cutoffAt, state, timeZone: tz, running: isRunning(b), doneAt: b.cutoffDoneAt,
        rule, ruleText: rule ? await ruleText(rule) : null,
        // A schedule's batch moves its cutoff ("Change this cutoff") but cannot drop it: the schedule is paused for that.
        canChange: canManage && !b.closedAt && state === 'pending',
        canRemove: canManage && !b.closedAt && state === 'pending' && !b.scheduleId,
        canRun: canManage && !b.closedAt && state === 'pending' && !isRunning(b),
      } : null,
      canSetCutoff: canManage && !b.closedAt && state === 'none' && !b.scheduleId,
      canUseInProgress: auth.permissions.has('receipt.view_all'),
      wouldAdd: would,
      late, lateCount,
      canAddLate: canManage && late && unfinished > 0,
      parts, partOf,
      // Drafts whose Med Ref chose this batch: they join when submitted (their details stay private until then).
      waitingDrafts: canManage ? await prisma.receipt.count({ where: { wantBatchId: b.id, status: 'draft' } }) : 0,
      count: rows.length,
      total: rows.reduce((s, r) => s + Math.round(Number(r.amount) * 100), 0) / 100,
      counts,
      // Receipts in the batch at a step this person cannot see (a Checker's batch may hold receipts Accounting cannot see yet).
      hidden: all - rows.length,
      canManage,
      steps,
      ready: Object.fromEntries(steps.map((s) => [s, rows.filter((r) => isReady(auth, s, r)).length])),
      receipts: rows.map((r) => ({ ...receiptBrief(r), readyFor: readyFor(r), canRemove: canRemoveFromBatch(r.status) })),
      // What the payment form needs for the receipts this person may pay now.
      payable: steps.includes('pay') ? rows.filter((r) => isReady(auth, 'pay', r)).map((r) => ({ id: r.id, refNo: r.refNo, vendor: r.payee, amount: Number(r.amount), version: r.version, person: r.encoder.name, personId: r.encoder.id })) : [],
    },
  });
});

/**
 * Adds receipts one by one, each with its reason when it cannot go in. The batch row (and, for a move, the batch it comes from) is
 * locked meanwhile, lower id first, so it is never overfilled and two moves at once cannot deadlock.
 * Once the batch is closed or its cutoff has run, an addition is late: it needs a reason, is marked, and is only possible while the
 * batch still has something unfinished. A late receipt may be moved out of another batch that is still open and not yet cut off.
 */
async function addReceipts(req: Request, batchId: number, receiptIds: number[], opts: { lateReason?: string | null; move?: boolean } = {}) {
  const auth = req.auth!;
  const unique = [...new Set(receiptIds)];
  const rows = await prisma.receipt.findMany({ where: { AND: [{ id: { in: unique } }, visibleWhere(auth)] }, select: { id: true, refNo: true, status: true, batchId: true, batch: { select: { code: true } } } });
  const sources = opts.move ? [...new Set(rows.map((r) => r.batchId).filter((x): x is number => !!x && x !== batchId))] : [];
  const results: { id: number; refNo: string | null; ok: boolean; message: string }[] = [];
  const added: { id: number; refNo: string; from: string | null }[] = [];
  const out = await prisma.$transaction(async (tx) => {
    // Touching the rows locks them until the end of the transaction.
    for (const id of [batchId, ...sources].sort((x, y) => x - y)) await tx.batch.updateMany({ where: { id }, data: { updatedAt: new Date() } });
    const b = await tx.batch.findUnique({ where: { id: batchId } });
    if (!b) throw notFound('Batch not found.');
    const late = isLateBatch(b);
    const reason = late ? opts.lateReason?.trim() || null : null;
    if (late && !reason) {
      if (b.closedAt) throw conflict('This batch is closed. To add a receipt late, give the reason.', 'BATCH_CLOSED');
      throw badRequest('This batch’s cutoff has run, so a receipt added now is late. Give the reason.', 'LATE_REASON_REQUIRED');
    }
    if (late && !(await tx.receipt.count({ where: { batchId, status: { in: [...BATCHABLE_STATUSES] } } }))) {
      throw conflict('Everything in this batch is paid or finished, so it is final. Add the receipt to the next run.', 'BATCH_FINAL');
    }
    const from = new Map((await tx.batch.findMany({ where: { id: { in: sources } } })).map((x) => [x.id, x]));
    let room = BATCH_MAX - (await tx.receipt.count({ where: { batchId } }));
    const mark = late ? { batchLateAt: new Date(), batchLateNote: reason } : { batchLateAt: null, batchLateNote: null };
    for (const id of unique) {
      const r = rows.find((x) => x.id === id);
      if (!r) { results.push({ id, refNo: null, ok: false, message: 'Not found.' }); continue; }
      const fail = (message: string) => results.push({ id, refNo: r.refNo, ok: false, message });
      if (r.batchId === batchId) { results.push({ id, refNo: r.refNo, ok: true, message: 'Already in this batch.' }); continue; }
      const src = r.batchId ? from.get(r.batchId) : undefined;
      if (r.batchId && !(late && opts.move)) { fail(`Already in batch ${r.batch?.code ?? ''}. Remove it from there first.`); continue; }
      if (r.batchId && src && (src.closedAt || cutoffState(src) === 'ran')) { fail(`It is in batch ${src.code}, which is closed or already cut off. Take it out there first.`); continue; }
      if (r.batchId && src && isRunning(src)) { fail(`Batch ${src.code} is running its cutoff right now. Try again in a minute.`); continue; }
      if (r.batchId && !src) { fail('It changed meanwhile. Reload and try again.'); continue; }
      if (r.status === 'draft') { fail('A draft can be added once the Med Ref submits it.'); continue; }
      if (!canAddToBatch(r.status)) { fail(`It is ${STATUS_LABEL[r.status as ReceiptStatus].toLowerCase()}, so it is finished and cannot be added.`); continue; }
      if (room <= 0) { fail(`The batch is full (${BATCH_MAX} receipts).${late ? ' Add it to the next run.' : ''}`); continue; }
      const done = await tx.receipt.updateMany({ where: { id, batchId: r.batchId ?? null, status: { in: [...BATCHABLE_STATUSES] } }, data: { batchId, ...mark } });
      if (!done.count) { fail('It changed meanwhile. Reload and try again.'); continue; }
      room--;
      added.push({ id, refNo: r.refNo, from: src?.code ?? null });
      results.push({ id, refNo: r.refNo, ok: true, message: src ? `Moved here from ${src.code}.` : late ? 'Added late.' : 'Added.' });
    }
    return { code: b.code, label: batchLabel(b), late, reason, fromIds: new Map([...from.values()].map((x) => [x.code, x.id])) };
  }, { timeout: 60_000 });
  const { code, late, reason } = out;
  for (const a of added) {
    if (a.from) {
      await audit(req, { action: 'batch.receipt_moved', entityType: 'receipt', entityId: a.id, summary: `moved from batch ${a.from} to ${code}`, before: { batch: a.from }, after: { batch: code } });
      await audit(req, { action: 'batch.receipt_moved', entityType: 'batch', entityId: out.fromIds.get(a.from)!, summary: `${a.refNo} moved from batch ${a.from} to ${code}`, after: { receipt: a.refNo, to: code } });
    }
    if (late) await audit(req, { action: 'batch.receipt_added_late', entityType: 'receipt', entityId: a.id, summary: `added late to batch ${code}: ${reason}`, after: { batch: code, reason } });
    else await audit(req, { action: 'batch.receipt_added', entityType: 'receipt', entityId: a.id, summary: `added to batch ${code}`, after: { batch: code } });
  }
  if (added.length) {
    const n = `${added.length} receipt${added.length === 1 ? '' : 's'}`;
    await audit(req, late
      ? { action: 'batch.receipts_added_late', entityType: 'batch', entityId: batchId, summary: `added ${n} late to batch ${code}: ${reason}`, after: { receipts: added.map((a) => a.refNo), reason } }
      : { action: 'batch.receipts_added', entityType: 'batch', entityId: batchId, summary: `added ${n} to batch ${code}`, after: { receipts: added.map((a) => a.refNo) } });
    if (late) {
      const who = [...new Set([...(await usersWithPermission('batch.manage')), ...(await usersWithPermission('payment.mark'))])].filter((id) => id !== auth.user.id);
      await notify({ userIds: who, type: 'batch.added_late', batchId, text: `${n} ${added.length === 1 ? 'was' : 'were'} added late to ${out.label} by ${auth.user.name}: ${reason}` });
    }
  }
  return { results, added: added.length, skipped: results.filter((r) => !r.ok).length, late };
}

batchesRouter.post('/', requirePerm('batch.manage'), async (req, res) => {
  const body = batchCreateWithCutoffSchema.parse(req.body);
  const rule = body.cutoffAt ? body.cutoffRule ?? DEFAULT_RULE : null;
  if (rule && !canUseCutoffRule(req.auth!.permissions, rule)) throw ruleNotAllowed();
  if (body.cutoffAt && body.cutoffAt.getTime() <= Date.now()) throw badRequest('Choose a cutoff time that is still to come.', 'CUTOFF_PAST');
  const b = await prisma.$transaction(async (tx) => tx.batch.create({
    data: { code: await nextBatchCode(tx), name: body.name, createdById: req.auth!.user.id, ...(body.cutoffAt ? { cutoffAt: body.cutoffAt, cutoffRule: JSON.stringify(rule) } : {}) },
  }));
  await audit(req, { action: 'batch.created', entityType: 'batch', entityId: b.id, summary: `created batch ${batchLabel(b)}${body.cutoffAt ? ` with a cutoff at ${fmtCutoff(body.cutoffAt, zoneOf({}))}` : ''}`, after: { code: b.code, name: b.name, ...(rule ? { cutoffAt: body.cutoffAt, rule } : {}) } });
  const added = body.receiptIds ? await addReceipts(req, b.id, body.receiptIds) : null;
  res.status(201).json({ batch: { id: b.id, code: b.code, name: b.name }, ...(added ? { added } : {}) });
});

/** What a fill rule would take if it ran now (for the forms, before anything is saved). */
batchesRouter.post('/cutoff-preview', requirePerm('batch.manage'), async (req, res) => {
  const rule = cutoffRuleSchema.parse(req.body?.rule);
  // Counting receipts at steps this person does not see would show them what the rule hides from them.
  if (!canUseCutoffRule(req.auth!.permissions, rule)) throw ruleNotAllowed();
  res.json(await preview(rule, zoneOf({})));
});

batchesRouter.patch('/:id', requirePerm('batch.manage'), async (req, res) => {
  const b = await loadBatch(idParam(req.params.id));
  const body = batchUpdateSchema.parse(req.body);
  const data: Prisma.BatchUpdateInput = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.closed !== undefined) data.closedAt = body.closed ? b.closedAt ?? new Date() : null;
  // Closing a batch before its cutoff cancels the cutoff: nothing is added. A schedule's batch is then done, so the schedule opens its next one.
  const cancels = body.closed === true && !b.closedAt && cutoffState(b) === 'pending';
  if (cancels && isRunning(b)) throw conflict('Its cutoff is running right now. Try again in a minute.', 'CUTOFF_RUNNING');
  if (cancels) Object.assign(data, b.scheduleId ? { cutoffAt: null, cutoffDoneAt: new Date() } : { cutoffAt: null, cutoffRule: null });
  const u = await prisma.batch.update({ where: { id: b.id }, data, include: batchIncludes });
  const what = body.closed === true && !b.closedAt ? 'closed' : body.closed === false && b.closedAt ? 'reopened' : 'renamed';
  await audit(req, { action: `batch.${what}`, entityType: 'batch', entityId: b.id, summary: `${what} batch ${u.code}${cancels ? ' before its cutoff, so the cutoff is cancelled' : ''}`, before: { name: b.name, closed: !!b.closedAt, ...(cancels ? { cutoffAt: b.cutoffAt } : {}) }, after: { name: u.name, closed: !!u.closedAt } });
  if (cancels && b.schedule) await ensureCurrent(b.schedule);
  res.json({ batch: batchHead(u) });
});

/**
 * Sets, moves or removes one batch's cutoff. A time already past runs the cutoff at once, only when `runNow` confirms it.
 * A schedule's batch can be moved (a holiday, say) but not left without a cutoff: the schedule is paused for that.
 */
batchesRouter.put('/:id/cutoff', requirePerm('batch.manage'), async (req, res) => {
  const auth = req.auth!;
  const b = await loadBatch(idParam(req.params.id));
  const body = batchCutoffSchema.parse(req.body);
  const state = cutoffState(b);
  const s = b.schedule;
  const tz = zoneOf(b);
  if (b.closedAt) throw conflict('This batch is closed. Reopen it to give it a cutoff.', 'BATCH_CLOSED');
  if (state === 'ran') throw conflict('This batch’s cutoff has already run.', 'CUTOFF_RAN');
  if (state === 'cancelled' || (b.scheduleId && !s)) throw conflict('This batch’s cutoff was cancelled when it was closed early, and its schedule has moved on to the next batch.', 'CUTOFF_RAN');
  if (isRunning(b)) throw conflict('Its cutoff is running right now. Try again in a minute.', 'CUTOFF_RUNNING');
  if (body.cutoffAt === null) {
    if (s) throw conflict(`This batch belongs to the cutoff schedule “${s.name}”. Pause or change the schedule instead.`, 'SCHEDULE_BATCH');
    if (state === 'pending') {
      await prisma.batch.update({ where: { id: b.id }, data: { cutoffAt: null, cutoffRule: null } });
      await audit(req, { action: 'batch.cutoff_removed', entityType: 'batch', entityId: b.id, summary: `removed the cutoff of batch ${b.code}`, before: { cutoffAt: b.cutoffAt, rule: ruleOf(b.cutoffRule) } });
    }
    return res.json({ ok: true });
  }
  if (s && !s.isOn) throw conflict(`The schedule “${s.name}” is paused. Switch it on to give this batch its cutoff again.`, 'SCHEDULE_PAUSED');
  const rule = body.cutoffRule ?? (b.cutoffRule ? ruleOf(b.cutoffRule) : DEFAULT_RULE);
  if (!canUseCutoffRule(auth.permissions, rule)) throw ruleNotAllowed();
  const past = body.cutoffAt.getTime() <= Date.now();
  if (past && !body.runNow) throw conflict(`${fmtCutoff(body.cutoffAt, tz)} has already passed. Run the cutoff now, or choose a later time.`, 'CUTOFF_PAST');
  // A schedule's batch is named after its cutoff date; it follows the move unless someone renamed it.
  const name = s && b.cutoffAt && b.name === cutoffBatchName(s.name, b.cutoffAt, tz) ? cutoffBatchName(s.name, body.cutoffAt, tz) : b.name;
  try {
    const done = await prisma.batch.updateMany({ where: { id: b.id, closedAt: null, cutoffDoneAt: null, OR: [{ cutoffClaimedAt: null }, { cutoffClaimedAt: { lt: new Date(Date.now() - CUTOFF_CLAIM_MS) } }] }, data: { cutoffAt: body.cutoffAt, cutoffRule: JSON.stringify(rule), name } });
    if (!done.count) throw conflict('It changed meanwhile. Reload and try again.', 'RECORD_CHANGED');
  } catch (e) {
    if (isUnique(e)) throw conflict('Another batch of this schedule already has that cutoff time. Choose another.', 'CUTOFF_TAKEN');
    throw e;
  }
  await audit(req, { action: state === 'pending' ? 'batch.cutoff_changed' : 'batch.cutoff_set', entityType: 'batch', entityId: b.id, summary: `${state === 'pending' ? 'moved' : 'set'} the cutoff of batch ${b.code} to ${fmtCutoff(body.cutoffAt, tz)}`, before: state === 'pending' ? { cutoffAt: b.cutoffAt, rule: ruleOf(b.cutoffRule) } : undefined, after: { cutoffAt: body.cutoffAt, rule } });
  if (past) return res.json({ ran: await runCutoff(b.id, actorOf(req)) });
  res.json({ ok: true });
});

/** Runs the cutoff now. Early, it uses up that slot: a schedule's next batch gets the slot after the planned one, not the next hour. */
batchesRouter.post('/:id/cutoff/run', requirePerm('batch.manage'), async (req, res) => {
  const b = await loadBatch(idParam(req.params.id));
  if (b.closedAt) throw conflict('This batch is closed.', 'BATCH_CLOSED');
  if (cutoffState(b) !== 'pending') throw conflict('This batch has no cutoff waiting.', 'NO_CUTOFF');
  const ran = await runCutoff(b.id, actorOf(req));
  if (!ran) throw conflict('Its cutoff is running right now. Try again in a minute.', 'CUTOFF_RUNNING');
  res.json({ ran });
});

/** Only an empty batch can be deleted, so no record of what was grouped is lost. A switched-on schedule's open batch stays: pause or delete the schedule. */
batchesRouter.delete('/:id', requirePerm('batch.manage'), async (req, res) => {
  const b = await loadBatch(idParam(req.params.id));
  if (b.schedule?.isOn && b.part === 1 && !b.cutoffDoneAt) throw conflict(`This is the open batch of the cutoff schedule “${b.schedule.name}”. Pause or delete the schedule instead.`, 'SCHEDULE_BATCH');
  if (isRunning(b)) throw conflict('Its cutoff is running right now. Try again in a minute.', 'CUTOFF_RUNNING');
  // A run's later parts point at their first batch, which then stays (MySQL cannot check that inside the delete itself).
  const hasParts = await prisma.batch.count({ where: { partOfId: b.id } });
  const done = hasParts ? { count: 0 } : await prisma.batch.deleteMany({ where: { id: b.id, receipts: { none: {} } } });
  if (!done.count) throw conflict('Remove its receipts first. A batch with paid receipts is kept for the record.', 'BATCH_NOT_EMPTY');
  await audit(req, { action: 'batch.deleted', entityType: 'batch', entityId: b.id, summary: `deleted the empty batch ${b.code}`, before: { code: b.code, name: b.name } });
  res.json({ ok: true });
});

batchesRouter.post('/:id/receipts', requirePerm('batch.manage'), async (req, res) => {
  const b = await loadBatch(idParam(req.params.id));
  const body = batchAddSchema.parse(req.body);
  const late = lateAddSchema.parse(req.body ?? {});
  res.json(await addReceipts(req, b.id, body.receiptIds, late));
});

batchesRouter.delete('/:id/receipts/:rid', requirePerm('batch.manage'), async (req, res) => {
  const b = await loadBatch(idParam(req.params.id));
  const rid = idParam(req.params.rid, 'Receipt');
  const r = await prisma.receipt.findFirst({ where: { AND: [{ id: rid, batchId: b.id }, visibleWhere(req.auth!)] }, select: { id: true, refNo: true, status: true } });
  if (!r) throw notFound('That receipt is not in this batch.');
  if (!canRemoveFromBatch(r.status)) throw conflict('A paid receipt stays in its batch, so the batch shows what was paid together.', 'PAID_IN_BATCH');
  const done = await prisma.receipt.updateMany({ where: { id: r.id, batchId: b.id, status: { not: 'paid' } }, data: { batchId: null, batchLateAt: null, batchLateNote: null } });
  if (!done.count) throw conflict('It changed meanwhile. Reload and try again.', 'RECORD_CHANGED');
  await audit(req, { action: 'batch.receipt_removed', entityType: 'receipt', entityId: r.id, summary: `removed from batch ${b.code}`, before: { batch: b.code } });
  res.json({ ok: true });
});

/* ---------- working on the whole batch ---------- */

const listOf = (rows: { refNo: string; payee: string; amount: number }[]) => {
  const shown = rows.slice(0, 30).map((r) => `• ${r.refNo} · ${r.payee} · ${php(r.amount)}`);
  return [...shown, ...(rows.length > shown.length ? [`… and ${rows.length - shown.length} more`] : [])].join('\n');
};

/**
 * Checks or approves every receipt in the batch that is waiting for this person. Each one goes through exactly the same rules
 * as one done by hand (evidence opened, company details confirmed, not their own), so anything not ready is skipped and the
 * reason is listed. People hear about it once, in a summary, instead of once per receipt.
 */
batchesRouter.post('/:id/process', async (req, res) => {
  const auth = req.auth!;
  const body = batchActionSchema.parse(req.body);
  const step = body.action;
  if (!auth.permissions.has(BATCH_ACTION_PERMISSION[step])) throw forbidden();
  const b = await loadBatch(idParam(req.params.id));
  const rows = await prisma.receipt.findMany({
    where: { AND: [{ batchId: b.id }, visibleWhere(auth), readyWhere(auth, step)] },
    select: { id: true, refNo: true, version: true, encoderId: true, checkedById: true, payee: true, amount: true },
    orderBy: { id: 'asc' }, take: BATCH_MAX,
  });
  if (!rows.length) throw conflict(`Nothing in this batch is waiting for you to ${step}.`, 'NOTHING_READY');

  const results: { id: number; refNo: string; ok: boolean; message: string }[] = [];
  for (const r of rows) {
    try {
      await runAction(req, step, r.id, { note: body.note, version: r.version }, { quiet: true });
      results.push({ id: r.id, refNo: r.refNo, ok: true, message: 'Done.' });
    } catch (e) {
      results.push({ id: r.id, refNo: r.refNo, ok: false, message: e instanceof HttpError ? e.message : 'Something went wrong.' });
    }
  }
  const done = rows.filter((r) => results.find((x) => x.id === r.id)!.ok).map((r) => ({ ...r, amount: Number(r.amount) }));
  await audit(req, { action: 'batch.processed', entityType: 'batch', entityId: b.id, summary: `ran "${step}" on batch ${b.code}: ${done.length} of ${rows.length} done`, after: { action: step, done: done.map((r) => r.refNo), skipped: results.filter((x) => !x.ok).map((x) => x.refNo) } });
  if (done.length) await announceBatch(auth, b, step, done);
  res.json({ results, done: done.length, skipped: results.length - done.length });
});

/** One notice (and email where the single-receipt step would email) per person, listing their receipts. */
async function announceBatch(auth: AuthContext, b: { id: number; code: string; name: string | null }, step: BatchAction, done: { id: number; refNo: string; encoderId: number; checkedById: number | null; payee: string; amount: number }[]) {
  const who = auth.user.name;
  const label = batchLabel(b);
  const mail = (summary: string, rows: typeof done) => ({ actorName: who, batchCode: label, summary, receiptList: listOf(rows) });
  // Med Refs cannot open batch pages, so their links go to their receipts.
  const receiptsLink = `${config.webOrigin}/receipts`;
  const others = (ids: number[]) => ids.filter((id) => id !== auth.user.id);
  const owners = [...new Set(done.map((r) => r.encoderId))];

  if (step === 'check') {
    const summary = `${batchDoneText('check', done.length)} by ${who} and ${done.length === 1 ? 'is' : 'are'} ready for your decision.`;
    await notify({ userIds: others(await usersWithPermission('review.decide')), type: 'batch.checked', batchId: b.id, text: `${label}: ${summary}`, email: { template: 'batch_update', data: mail(summary, done) } });
    for (const o of others(owners)) {
      const mine = done.filter((r) => r.encoderId === o);
      await notify({ userIds: [o], type: 'batch.checked', batchId: b.id, text: `${mine.length} of your receipts in ${b.code} ${mine.length === 1 ? 'was' : 'were'} checked by ${who} and ${mine.length === 1 ? 'is' : 'are'} now with the Approver.` });
    }
    return;
  }
  // Approved: the Med Ref and the Checker of each receipt, then Accounting.
  const people = new Map<number, typeof done>();
  for (const r of done) for (const id of others([r.encoderId, ...(r.checkedById ? [r.checkedById] : [])])) people.set(id, [...(people.get(id) ?? []), r]);
  for (const [id, mine] of people) {
    const own = owners.includes(id);
    const was = mine.length === 1 ? 'was' : 'were';
    const summary = own ? `${mine.length} of your receipts ${was} approved by ${who}.` : `${mine.length} receipt${mine.length === 1 ? '' : 's'} you checked ${was} approved by ${who}.`;
    await notify({ userIds: [id], type: 'batch.approved', batchId: b.id, text: `${b.code}: ${summary}`, email: { template: 'batch_update', data: mail(summary, mine), ...(own ? { link: receiptsLink } : {}) } });
  }
  const payers = others(await usersWithPermission('payment.mark')).filter((id) => !people.has(id));
  const summary = `${batchDoneText('approve', done.length)} by ${who} and ${done.length === 1 ? 'is' : 'are'} ready to pay.`;
  await notify({ userIds: payers, type: 'batch.ready_to_pay', batchId: b.id, text: `${label}: ${summary}`, email: { template: 'batch_update', data: mail(summary, done) } });
}

/** Pays the batch: one date, method and proof, one payment per person. Every receipt must still be in the batch and payable, or nothing is recorded. */
batchesRouter.post('/:id/pay', requirePerm('payment.mark'), payLimiter, upload.single('proof'), async (req, res) => {
  const b = await loadBatch(idParam(req.params.id));
  let lines: unknown;
  try { lines = cleanDeep(JSON.parse(String(req.body?.lines ?? ''))); } catch { throw badRequest('The list of receipts could not be read. Reload and try again.', 'BAD_LINES'); }
  const body = batchPaySchema.parse({ method: req.body?.method, paidOn: req.body?.paidOn, lines });
  const payments = await recordPayments(req, body, req.file, { onePerson: false, batchId: b.id });
  const count = payments.reduce((s, p) => s + p.count, 0);
  await audit(req, { action: 'batch.paid', entityType: 'batch', entityId: b.id, summary: `paid ${count} receipt${count === 1 ? '' : 's'} of batch ${b.code} (${payments.map((p) => p.paymentNo).join(', ')})`, after: { payments: payments.map((p) => ({ paymentNo: p.paymentNo, count: p.count, total: p.total })) } });
  res.status(201).json({ payments: payments.map((p) => ({ id: p.id, paymentNo: p.paymentNo, count: p.count, total: p.total })) });
});

