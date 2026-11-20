import { Router, type Request } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import type { Prisma } from '@prisma/client';
import {
  BATCHABLE_STATUSES, BATCH_ACTION_PERMISSION, BATCH_MAX, EVIDENCE_MAX_BYTES, STATUS_LABEL,
  batchActionSchema, batchAddSchema, batchCreateSchema, batchDoneText, batchLabel, batchListQuerySchema, batchPaySchema, batchUpdateSchema,
  canAddToBatch, canRemoveFromBatch, canViewBatches, cleanDeep, type BatchAction, type ReceiptStatus,
} from '@reimsys/shared';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
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

async function loadBatch(id: number) {
  const b = await prisma.batch.findUnique({ where: { id }, include: { createdBy: { select: { id: true, name: true } } } });
  if (!b) throw notFound('Batch not found.');
  return b;
}
type BatchRow = Awaited<ReturnType<typeof loadBatch>>;
const batchHead = (b: BatchRow) => ({ id: b.id, code: b.code, name: b.name, closed: !!b.closedAt, closedAt: b.closedAt, createdAt: b.createdAt, createdBy: b.createdBy });
const php = (n: number) => 'PHP ' + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ---------- list and find ---------- */

batchesRouter.get('/', async (req, res) => {
  const auth = req.auth!;
  const q = batchListQuerySchema.parse(req.query);
  const where: Prisma.BatchWhereInput = {
    AND: [
      q.state === 'open' ? { closedAt: null } : q.state === 'closed' ? { closedAt: { not: null } } : {},
      q.q ? { OR: [{ code: { contains: q.q } }, { name: { contains: q.q } }] } : {},
    ],
  };
  const batches = await prisma.batch.findMany({ where, include: { createdBy: { select: { id: true, name: true } } }, orderBy: { id: 'desc' }, take: 100 });
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
  res.json({
    batch: {
      ...batchHead(b),
      count: rows.length,
      total: rows.reduce((s, r) => s + Math.round(Number(r.amount) * 100), 0) / 100,
      counts,
      // Receipts in the batch at a step this person cannot see (a Checker's batch may hold receipts Accounting cannot see yet).
      hidden: all - rows.length,
      canManage: auth.permissions.has('batch.manage'),
      steps,
      ready: Object.fromEntries(steps.map((s) => [s, rows.filter((r) => isReady(auth, s, r)).length])),
      receipts: rows.map((r) => ({ ...receiptBrief(r), readyFor: readyFor(r), canRemove: canRemoveFromBatch(r.status) })),
      // What the payment form needs for the receipts this person may pay now.
      payable: steps.includes('pay') ? rows.filter((r) => isReady(auth, 'pay', r)).map((r) => ({ id: r.id, refNo: r.refNo, vendor: r.payee, amount: Number(r.amount), version: r.version, person: r.encoder.name, personId: r.encoder.id })) : [],
    },
  });
});

/** Adds receipts one by one, each with its reason when it cannot go in. The batch row is locked meanwhile, so it is never overfilled or filled after closing. */
async function addReceipts(req: Request, batchId: number, receiptIds: number[]) {
  const auth = req.auth!;
  const unique = [...new Set(receiptIds)];
  const rows = await prisma.receipt.findMany({ where: { AND: [{ id: { in: unique } }, visibleWhere(auth)] }, select: { id: true, refNo: true, status: true, batchId: true, batch: { select: { code: true } } } });
  const results: { id: number; refNo: string | null; ok: boolean; message: string }[] = [];
  const added: { id: number; refNo: string }[] = [];
  const code = await prisma.$transaction(async (tx) => {
    // Touching the row locks it until the end of the transaction.
    const touched = await tx.batch.updateMany({ where: { id: batchId }, data: { updatedAt: new Date() } });
    const b = touched.count ? await tx.batch.findUnique({ where: { id: batchId } }) : null;
    if (!b) throw notFound('Batch not found.');
    if (b.closedAt) throw conflict('This batch is closed. Reopen it to add receipts.', 'BATCH_CLOSED');
    let room = BATCH_MAX - (await tx.receipt.count({ where: { batchId } }));
    for (const id of unique) {
      const r = rows.find((x) => x.id === id);
      if (!r) { results.push({ id, refNo: null, ok: false, message: 'Not found.' }); continue; }
      const fail = (message: string) => results.push({ id, refNo: r.refNo, ok: false, message });
      if (r.batchId === batchId) { results.push({ id, refNo: r.refNo, ok: true, message: 'Already in this batch.' }); continue; }
      if (r.batchId) { fail(`Already in batch ${r.batch?.code ?? ''}. Remove it from there first.`); continue; }
      if (r.status === 'draft') { fail('A draft can be added once the Med Ref submits it.'); continue; }
      if (!canAddToBatch(r.status)) { fail(`It is ${STATUS_LABEL[r.status as ReceiptStatus].toLowerCase()}, so it is finished and cannot be added.`); continue; }
      if (room <= 0) { fail(`The batch is full (${BATCH_MAX} receipts).`); continue; }
      const done = await tx.receipt.updateMany({ where: { id, batchId: null, status: { in: [...BATCHABLE_STATUSES] } }, data: { batchId } });
      if (!done.count) { fail('It changed meanwhile. Reload and try again.'); continue; }
      room--;
      added.push({ id, refNo: r.refNo });
      results.push({ id, refNo: r.refNo, ok: true, message: 'Added.' });
    }
    return b.code;
  }, { timeout: 60_000 });
  for (const a of added) await audit(req, { action: 'batch.receipt_added', entityType: 'receipt', entityId: a.id, summary: `added to batch ${code}`, after: { batch: code } });
  if (added.length) await audit(req, { action: 'batch.receipts_added', entityType: 'batch', entityId: batchId, summary: `added ${added.length} receipt${added.length === 1 ? '' : 's'} to batch ${code}`, after: { receipts: added.map((a) => a.refNo) } });
  return { results, added: added.length, skipped: results.filter((r) => !r.ok).length };
}

batchesRouter.post('/', requirePerm('batch.manage'), async (req, res) => {
  const body = batchCreateSchema.parse(req.body);
  const b = await prisma.$transaction(async (tx) => tx.batch.create({ data: { code: await nextBatchCode(tx), name: body.name, createdById: req.auth!.user.id } }));
  await audit(req, { action: 'batch.created', entityType: 'batch', entityId: b.id, summary: `created batch ${batchLabel(b)}`, after: { code: b.code, name: b.name } });
  const added = body.receiptIds ? await addReceipts(req, b.id, body.receiptIds) : null;
  res.status(201).json({ batch: { id: b.id, code: b.code, name: b.name }, ...(added ? { added } : {}) });
});

batchesRouter.patch('/:id', requirePerm('batch.manage'), async (req, res) => {
  const b = await loadBatch(idParam(req.params.id));
  const body = batchUpdateSchema.parse(req.body);
  const data: Prisma.BatchUpdateInput = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.closed !== undefined) data.closedAt = body.closed ? b.closedAt ?? new Date() : null;
  const u = await prisma.batch.update({ where: { id: b.id }, data, include: { createdBy: { select: { id: true, name: true } } } });
  const what = body.closed === true && !b.closedAt ? 'closed' : body.closed === false && b.closedAt ? 'reopened' : 'renamed';
  await audit(req, { action: `batch.${what}`, entityType: 'batch', entityId: b.id, summary: `${what} batch ${u.code}`, before: { name: b.name, closed: !!b.closedAt }, after: { name: u.name, closed: !!u.closedAt } });
  res.json({ batch: batchHead(u) });
});

/** Only an empty batch can be deleted, so no record of what was grouped is lost. */
batchesRouter.delete('/:id', requirePerm('batch.manage'), async (req, res) => {
  const b = await loadBatch(idParam(req.params.id));
  const done = await prisma.batch.deleteMany({ where: { id: b.id, receipts: { none: {} } } });
  if (!done.count) throw conflict('Remove its receipts first. A batch with paid receipts is kept for the record.', 'BATCH_NOT_EMPTY');
  await audit(req, { action: 'batch.deleted', entityType: 'batch', entityId: b.id, summary: `deleted the empty batch ${b.code}`, before: { code: b.code, name: b.name } });
  res.json({ ok: true });
});

batchesRouter.post('/:id/receipts', requirePerm('batch.manage'), async (req, res) => {
  const b = await loadBatch(idParam(req.params.id));
  const body = batchAddSchema.parse(req.body);
  res.json(await addReceipts(req, b.id, body.receiptIds));
});

batchesRouter.delete('/:id/receipts/:rid', requirePerm('batch.manage'), async (req, res) => {
  const b = await loadBatch(idParam(req.params.id));
  const rid = idParam(req.params.rid, 'Receipt');
  const r = await prisma.receipt.findFirst({ where: { AND: [{ id: rid, batchId: b.id }, visibleWhere(req.auth!)] }, select: { id: true, refNo: true, status: true } });
  if (!r) throw notFound('That receipt is not in this batch.');
  if (!canRemoveFromBatch(r.status)) throw conflict('A paid receipt stays in its batch, so the batch shows what was paid together.', 'PAID_IN_BATCH');
  const done = await prisma.receipt.updateMany({ where: { id: r.id, batchId: b.id, status: { not: 'paid' } }, data: { batchId: null } });
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

