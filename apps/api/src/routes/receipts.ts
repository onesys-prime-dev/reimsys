import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import ExcelJS from 'exceljs';
import type { Prisma } from '@prisma/client';
import {
  EVIDENCE_MAX_BYTES, EVIDENCE_MAX_FILES, TRANSITIONS, actionBodySchema, listQuerySchema, receiptInputSchema,
  type ReceiptAction, type ReceiptStatus, canEditReceipt, transitionFor,
} from '@reimsis/shared';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { enqueue } from '../lib/jobs.js';
import { notify, usersWithPermission } from '../lib/notify.js';
import { assertOwner, dateOnly, filterWhere, loadVisible, receiptBrief, receiptDetail, receiptInclude, visibleWhere } from '../lib/receipts.js';
import { nextDocNo, nextReceiptRef } from '../lib/sequence.js';
import { copyFile, readFile, removeFile, saveFile, sha256Of, sniff } from '../lib/storage.js';
import { toCsv } from '../lib/reports.js';
import { requireAuth, requirePerm } from '../middleware/auth.js';

export const receiptsRouter = Router();
receiptsRouter.use(requireAuth);

const idParam = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw notFound('Receipt not found.');
  return n;
};

async function assertCategory(id: number) {
  const c = await prisma.category.findUnique({ where: { id } });
  if (!c || !c.isActive) throw badRequest('Choose an active category.', 'BAD_CATEGORY');
  return c;
}

/* ---------- list, export, create ---------- */

receiptsRouter.get('/', async (req, res) => {
  const q = listQuerySchema.parse(req.query);
  const scope = visibleWhere(req.auth!);
  const base = filterWhere({ ...q, status: undefined });
  const where: Prisma.ReceiptWhereInput = { AND: [scope, base, q.status ? { status: q.status } : {}] };
  const [total, rows, grouped] = await Promise.all([
    prisma.receipt.count({ where }),
    prisma.receipt.findMany({ where, include: receiptInclude, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.receipt.groupBy({ by: ['status'], where: { AND: [scope, base] }, _count: { _all: true } }),
  ]);
  const counts: Record<string, number> = {};
  for (const g of grouped) counts[g.status] = g._count._all;
  res.json({ total, page: q.page, pageSize: q.pageSize, counts, items: rows.map(receiptBrief) });
});

receiptsRouter.get('/export', async (req, res) => {
  const format = req.query.format === 'xlsx' ? 'xlsx' : 'csv';
  const q = listQuerySchema.parse({ ...req.query, page: 1, pageSize: 100 });
  const where: Prisma.ReceiptWhereInput = { AND: [visibleWhere(req.auth!), filterWhere(q)] };
  const rows = await prisma.receipt.findMany({ where, include: receiptInclude, orderBy: { id: 'asc' }, take: 20000 });
  const head = ['Reference', 'Status', 'Receipt date', 'Paid to', 'Category', 'Description', 'Encoded by', 'Amount (PHP)', 'Document no.'];
  const data = rows.map((r) => [r.refNo, r.status, dateOnly(r.receiptDate), r.payee, r.category.name, r.description ?? '', r.encoder.name, Number(r.amount), r.document?.docNo ?? '']);
  await audit(req, { action: 'receipt.exported', entityType: 'export', summary: `exported ${rows.length} receipt${rows.length === 1 ? '' : 's'} as ${format.toUpperCase()}` });
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'csv') {
    res.type('text/csv').attachment(`receipts-${stamp}.csv`).send(toCsv([head, ...data]));
    return;
  }
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Receipts');
  ws.addRow(head).font = { bold: true };
  data.forEach((d) => ws.addRow(d));
  ws.getColumn(8).numFmt = '#,##0.00';
  [16, 12, 14, 30, 16, 36, 22, 16, 16].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment(`receipts-${stamp}.xlsx`).send(Buffer.from(await wb.xlsx.writeBuffer()));
});

receiptsRouter.post('/', requirePerm('receipt.create'), async (req, res) => {
  const data = receiptInputSchema.parse(req.body);
  await assertCategory(data.categoryId);
  const r = await prisma.$transaction(async (tx) =>
    tx.receipt.create({
      data: {
        refNo: await nextReceiptRef(tx), encoderId: req.auth!.user.id, payee: data.payee, receiptDate: new Date(data.receiptDate + 'T00:00:00Z'),
        amount: data.amount, categoryId: data.categoryId, description: data.description || null,
      },
      include: receiptInclude,
    }),
  );
  await audit(req, { action: 'receipt.created', entityType: 'receipt', entityId: r.id, summary: `created the draft ${r.refNo}`, after: { payee: r.payee, amount: data.amount } });
  res.status(201).json({ receipt: await receiptDetail(req.auth!, r) });
});

/* ---------- one receipt ---------- */

receiptsRouter.get('/:id', async (req, res) => {
  const r = await loadVisible(req.auth!, idParam(req.params.id));
  res.json({ receipt: await receiptDetail(req.auth!, r) });
});

receiptsRouter.patch('/:id', requirePerm('receipt.create'), async (req, res) => {
  const r = await loadVisible(req.auth!, idParam(req.params.id));
  assertOwner(req.auth!, r);
  if (!canEditReceipt(r.status as ReceiptStatus)) throw conflict('This receipt can no longer be edited.', 'INVALID_STATE');
  const data = receiptInputSchema.parse(req.body);
  await assertCategory(data.categoryId);
  const updated = await prisma.receipt.update({
    where: { id: r.id },
    data: { payee: data.payee, receiptDate: new Date(data.receiptDate + 'T00:00:00Z'), amount: data.amount, categoryId: data.categoryId, description: data.description || null },
    include: receiptInclude,
  });
  await audit(req, {
    action: 'receipt.updated', entityType: 'receipt', entityId: r.id, summary: 'updated the receipt',
    before: { payee: r.payee, amount: Number(r.amount), date: dateOnly(r.receiptDate), categoryId: r.categoryId },
    after: { payee: data.payee, amount: data.amount, date: data.receiptDate, categoryId: data.categoryId },
  });
  res.json({ receipt: await receiptDetail(req.auth!, updated) });
});

receiptsRouter.post('/:id/copy', requirePerm('receipt.create'), async (req, res) => {
  const r = await loadVisible(req.auth!, idParam(req.params.id));
  assertOwner(req.auth!, r);
  if (r.status !== 'disapproved') throw conflict('Only disapproved receipts can be copied.', 'INVALID_STATE');
  const copy = await prisma.$transaction(async (tx) =>
    tx.receipt.create({
      data: { refNo: await nextReceiptRef(tx), encoderId: r.encoderId, payee: r.payee, receiptDate: r.receiptDate, amount: r.amount, categoryId: r.categoryId, description: r.description },
      include: receiptInclude,
    }),
  );
  const files = await prisma.receiptEvidence.findMany({ where: { receiptId: r.id, deletedAt: null } });
  for (const f of files) {
    const storedName = await copyFile(f.storedName, `evidence/${copy.id}`);
    await prisma.receiptEvidence.create({ data: { receiptId: copy.id, fileName: f.fileName, storedName, mime: f.mime, size: f.size, sha256: f.sha256, uploadedById: req.auth!.user.id } });
  }
  await audit(req, { action: 'receipt.created', entityType: 'receipt', entityId: copy.id, summary: `created the draft ${copy.refNo} as a copy of ${r.refNo}` });
  res.status(201).json({ receipt: await receiptDetail(req.auth!, copy) });
});

/* ---------- evidence ---------- */

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: EVIDENCE_MAX_BYTES, files: EVIDENCE_MAX_FILES } });
const uploadLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false, message: { error: { code: 'RATE_LIMIT', message: 'Too many uploads. Wait a minute.' } } });

receiptsRouter.post('/:id/evidence', requirePerm('receipt.create'), uploadLimiter, upload.array('files', EVIDENCE_MAX_FILES), async (req, res) => {
  const r = await loadVisible(req.auth!, idParam(req.params.id));
  assertOwner(req.auth!, r);
  if (!canEditReceipt(r.status as ReceiptStatus)) throw conflict('Evidence is locked while this receipt is in review.', 'INVALID_STATE');
  const files = (req.files as Express.Multer.File[]) ?? [];
  if (!files.length) throw badRequest('Choose at least one file.');
  const existing = await prisma.receiptEvidence.findMany({ where: { receiptId: r.id, deletedAt: null } });
  if (existing.length + files.length > EVIDENCE_MAX_FILES) throw badRequest(`A receipt can have up to ${EVIDENCE_MAX_FILES} files.`, 'TOO_MANY_FILES');

  const created: Awaited<ReturnType<typeof prisma.receiptEvidence.create>>[] = [];
  const warnings: string[] = [];
  for (const f of files) {
    const kind = sniff(f.buffer);
    if (!kind) throw badRequest(`"${f.originalname}" is not a JPG, PNG, WEBP, HEIC or PDF file.`, 'BAD_FILE');
    const hash = sha256Of(f.buffer);
    if (existing.some((e) => e.sha256 === hash) || created.some((c) => c.sha256 === hash)) throw badRequest(`"${f.originalname}" is already attached to this receipt.`, 'DUPLICATE_FILE');
    const other = await prisma.receiptEvidence.findFirst({ where: { sha256: hash, deletedAt: null, receiptId: { not: r.id } }, include: { receipt: { select: { refNo: true } } } });
    if (other) warnings.push(`"${f.originalname}" was also used on ${other.receipt.refNo}.`);
    const storedName = await saveFile(`evidence/${r.id}`, kind.ext, f.buffer);
    const row = await prisma.receiptEvidence.create({
      data: { receiptId: r.id, fileName: f.originalname.slice(0, 200), storedName, mime: kind.mime, size: f.size, sha256: hash, uploadedById: req.auth!.user.id },
    });
    created.push(row);
    await audit(req, { action: 'evidence.uploaded', entityType: 'receipt', entityId: r.id, summary: `uploaded evidence "${row.fileName}"` });
  }
  const fresh = await loadVisible(req.auth!, r.id);
  res.status(201).json({ receipt: await receiptDetail(req.auth!, fresh), warnings });
});

receiptsRouter.delete('/:id/evidence/:eid', requirePerm('receipt.create'), async (req, res) => {
  const r = await loadVisible(req.auth!, idParam(req.params.id));
  assertOwner(req.auth!, r);
  if (!canEditReceipt(r.status as ReceiptStatus)) throw conflict('Evidence is locked while this receipt is in review.', 'INVALID_STATE');
  const ev = await prisma.receiptEvidence.findFirst({ where: { id: idParam(req.params.eid), receiptId: r.id, deletedAt: null } });
  if (!ev) throw notFound('File not found.');
  // Soft delete. The file stays on disk so the audit trail still points at something real.
  await prisma.receiptEvidence.update({ where: { id: ev.id }, data: { deletedAt: new Date() } });
  await audit(req, { action: 'evidence.removed', entityType: 'receipt', entityId: r.id, summary: `removed evidence "${ev.fileName}"` });
  res.json({ receipt: await receiptDetail(req.auth!, await loadVisible(req.auth!, r.id)) });
});

const MODES = { view: ['evidence.view', 'inline', 'viewed'], print: ['evidence.print', 'inline', 'printed'], download: ['evidence.download', 'attachment', 'downloaded'] } as const;

receiptsRouter.get('/:id/evidence/:eid/file', async (req, res) => {
  const mode = (typeof req.query.mode === 'string' && req.query.mode in MODES ? req.query.mode : 'view') as keyof typeof MODES;
  const [perm, disposition, verb] = MODES[mode];
  if (!req.auth!.permissions.has(perm)) throw forbidden();
  const r = await loadVisible(req.auth!, idParam(req.params.id));
  const ev = await prisma.receiptEvidence.findFirst({ where: { id: idParam(req.params.eid), receiptId: r.id, deletedAt: null } });
  if (!ev) throw notFound('File not found.');
  // The audit row is written before any byte is sent.
  await audit(req, { action: `evidence.${verb}`, entityType: 'receipt', entityId: r.id, summary: `${verb} evidence "${ev.fileName}"` });
  const buf = await readFile(ev.storedName);
  res.setHeader('Content-Type', ev.mime);
  res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(ev.fileName)}`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(buf);
});

/* ---------- history ---------- */

receiptsRouter.get('/:id/history', async (req, res) => {
  const r = await loadVisible(req.auth!, idParam(req.params.id));
  const rows = await prisma.auditLog.findMany({ where: { entityType: 'receipt', entityId: String(r.id) }, orderBy: { id: 'desc' }, take: 200 });
  res.json({
    items: rows.map((a) => {
      let note: string | null = null;
      try { note = a.after ? (JSON.parse(a.after).note ?? null) : null; } catch { /* ignore */ }
      return { id: a.id, actor: a.actorName, action: a.action, summary: a.summary, note, createdAt: a.createdAt };
    }),
  });
});

/* ---------- workflow actions ---------- */

const SUMMARY: Record<ReceiptAction, string> = {
  submit: 'submitted for checking', check: 'marked as checked', return: 'returned the record',
  approve: 'approved the record', disapprove: 'disapproved the record', reserve: 'put the record on hold', release: 'released the reservation',
};

async function runAction(req: import('express').Request, action: ReceiptAction) {
  const auth = req.auth!;
  const t = transitionFor(action)!;
  const body = actionBodySchema.parse(req.body);
  const r = await loadVisible(auth, idParam(req.params.id));
  if (!auth.permissions.has(t.permission)) throw forbidden();
  const isOwner = r.encoderId === auth.user.id;
  if (t.owner && !isOwner) throw forbidden('Only the person who encoded this receipt can do that.');
  if (t.notOwner && isOwner) throw forbidden('You cannot review a receipt you encoded.', 'OWN_RECEIPT');
  if (!t.from.includes(r.status as ReceiptStatus)) throw conflict(`This receipt is ${r.status}, so it cannot be changed this way.`, 'INVALID_STATE');
  if (body.version !== r.version) throw conflict('Someone else changed this receipt. Reload and try again.', 'RECORD_CHANGED');
  const note = body.note?.trim() || null;
  if (t.note === 'required' && !note) throw badRequest(action === 'return' ? 'Tell the Med Ref what to fix.' : action === 'disapprove' ? 'A reason is required.' : 'A note is required.', 'NOTE_REQUIRED');

  if (action === 'submit') {
    const n = await prisma.receiptEvidence.count({ where: { receiptId: r.id, deletedAt: null } });
    if (!n) throw badRequest('Add at least one photo or PDF of the receipt before submitting.', 'NO_EVIDENCE');
  }
  const now = new Date();
  if (action === 'check') {
    const viewed = await prisma.auditLog.count({
      where: { actorId: auth.user.id, entityType: 'receipt', entityId: String(r.id), action: 'evidence.viewed', createdAt: { gte: r.submittedAt ?? new Date(0) } },
    });
    if (!viewed) throw badRequest('Open the evidence before marking this checked.', 'EVIDENCE_NOT_VIEWED');
  }

  const data: Prisma.ReceiptUncheckedUpdateManyInput = { status: t.to, version: { increment: 1 } };
  if (action === 'submit') Object.assign(data, { submittedAt: now, checkedById: null, checkedAt: null, checkNote: null, lastNote: null });
  if (action === 'check') Object.assign(data, { checkedById: auth.user.id, checkedAt: now, checkNote: note });
  if (action === 'return' || action === 'reserve') data.lastNote = note;
  if (action === 'release') data.lastNote = null;
  if (action === 'approve' || action === 'disapprove') Object.assign(data, { decidedById: auth.user.id, decidedAt: now, decisionNote: note, lastNote: action === 'disapprove' ? note : null });

  let docNo: string | null = null;
  await prisma.$transaction(async (tx) => {
    const res = await tx.receipt.updateMany({ where: { id: r.id, version: r.version, status: r.status }, data });
    if (!res.count) throw conflict('Someone else changed this receipt. Reload and try again.', 'RECORD_CHANGED');
    if (action === 'approve') {
      docNo = await nextDocNo(tx);
      await tx.reimbursementDocument.create({ data: { receiptId: r.id, docNo } });
    }
  });
  if (action === 'approve') await enqueue('document', { receiptId: r.id });

  await audit(req, {
    action: `receipt.${action}`, entityType: 'receipt', entityId: r.id, summary: SUMMARY[action],
    before: { status: r.status }, after: { status: t.to, ...(note ? { note } : {}), ...(docNo ? { docNo } : {}) },
  });

  /* notifications */
  const who = auth.user.name;
  const ref = `${r.refNo} (${r.payee})`;
  const others = (ids: (number | null | undefined)[]) => ids.filter((x): x is number => !!x && x !== auth.user.id);
  const mailLines = (head: string) => [head, ...(note ? [`Note: ${note}`] : []), `Amount: PHP ${Number(r.amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`];
  if (action === 'submit') await notify({ userIds: others(await usersWithPermission('review.check')), type: 'receipt.submitted', receiptId: r.id, text: `${ref} is waiting to be checked.` });
  if (action === 'check') await notify({ userIds: others(await usersWithPermission('review.decide')), type: 'receipt.checked', receiptId: r.id, text: `${ref} was checked and is ready for your decision.` });
  if (action === 'return') await notify({ userIds: [r.encoderId], type: 'receipt.returned', receiptId: r.id, text: `${ref} was returned. ${note}`, email: { template: 'returned', subject: `Receipt ${r.refNo} was returned`, heading: 'Your receipt needs a correction', lines: mailLines(`${who} returned ${ref}.`) } });
  if (action === 'approve') await notify({ userIds: [r.encoderId, ...others([r.checkedById])], type: 'receipt.approved', receiptId: r.id, text: `${ref} was approved. Document ${docNo} is ready.`, email: { template: 'approved', subject: `Receipt ${r.refNo} was approved`, heading: 'Receipt approved', lines: mailLines(`${who} approved ${ref}. Reimbursement document ${docNo} has been created.`) } });
  if (action === 'disapprove') await notify({ userIds: [r.encoderId, ...others([r.checkedById])], type: 'receipt.disapproved', receiptId: r.id, text: `${ref} was disapproved. ${note}`, email: { template: 'disapproved', subject: `Receipt ${r.refNo} was disapproved`, heading: 'Receipt disapproved', lines: mailLines(`${who} disapproved ${ref}.`) } });
  if (action === 'reserve') await notify({ userIds: [r.encoderId, ...others([r.checkedById])], type: 'receipt.reserved', receiptId: r.id, text: `${ref} is on hold. ${note}`, email: { template: 'reserved', subject: `Receipt ${r.refNo} is on hold`, heading: 'Receipt on hold', lines: mailLines(`${who} put ${ref} on hold.`) } });
  if (action === 'release') await notify({ userIds: [r.encoderId], type: 'receipt.released', receiptId: r.id, text: `The hold on ${ref} was released.`, email: { template: 'released', subject: `Hold released on ${r.refNo}`, heading: 'Hold released', lines: mailLines(`${who} released the hold on ${ref}. It is back in review.`), respectPref: 'reservationReleased' } });

  return receiptDetail(auth, await loadVisible(auth, r.id));
}

for (const t of TRANSITIONS) {
  receiptsRouter.post(`/:id/${t.action}`, async (req, res) => {
    res.json({ receipt: await runAction(req, t.action) });
  });
}
