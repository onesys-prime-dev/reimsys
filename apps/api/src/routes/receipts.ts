import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import ExcelJS from 'exceljs';
import type { Prisma } from '@prisma/client';
import {
  EVIDENCE_MAX_BYTES, EVIDENCE_MAX_FILES, TRANSITIONS, actionBodySchema, listQuerySchema, makeReceiptSchema, receiptWarnings,
  type ReceiptAction, type ReceiptStatus, canEditReceipt, transitionFor, bulkSchema, commentSchema,
  cleanFormData, VAT_LABEL, classificationText, issuesText, joinIssues, fixStepFor, type ReturnIssueCode,
} from '@reimsys/shared';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { enqueue } from '../lib/jobs.js';
import { getSettings } from '../lib/appSettings.js';
import { receiptData } from '../lib/emailTemplates.js';
import { notify, receiptUrl, usersWithPermission } from '../lib/notify.js';
import { assertOwner, typeLabel, dateOnly, filterWhere, loadVisible, receiptBrief, receiptDetail, receiptInclude, visibleWhere } from '../lib/receipts.js';
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

const yn = (v: boolean | null) => (v === null ? '' : v ? 'Yes' : 'No');
const num = (v: { toString(): string } | null) => (v === null ? '' : Number(v));

/** The fields of the form as they are written to the database. */
function formColumns(data: ReturnType<ReturnType<typeof makeReceiptSchema>['parse']>) {
  return {
    payee: data.payee, receiptDate: new Date(data.receiptDate + 'T00:00:00Z'), amount: data.amount, description: data.description || null,
    ...cleanFormData(data, getSettings()),
  };
}

/* ---------- list, export, create ---------- */

const SORTS: Record<string, Prisma.ReceiptOrderByWithRelationInput[]> = {
  updated: [{ updatedAt: 'desc' }, { id: 'desc' }],
  newest: [{ receiptDate: 'desc' }, { id: 'desc' }],
  oldest: [{ receiptDate: 'asc' }, { id: 'asc' }],
  amount_high: [{ amount: 'desc' }, { id: 'desc' }],
  amount_low: [{ amount: 'asc' }, { id: 'asc' }],
};

receiptsRouter.get('/', async (req, res) => {
  const q = listQuerySchema.parse(req.query);
  const scope = visibleWhere(req.auth!);
  const base = filterWhere({ ...q, status: undefined });
  const where: Prisma.ReceiptWhereInput = { AND: [scope, base, q.status ? { status: q.status } : {}] };
  const [total, rows, grouped] = await Promise.all([
    prisma.receipt.count({ where }),
    prisma.receipt.findMany({ where, include: receiptInclude, orderBy: SORTS[q.sort], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.receipt.groupBy({ by: ['status'], where: { AND: [scope, base] }, _count: { _all: true } }),
  ]);
  const counts: Record<string, number> = {};
  for (const g of grouped) counts[g.status] = g._count._all;
  res.json({ total, page: q.page, pageSize: q.pageSize, counts, items: rows.map(receiptBrief) });
});

/** People who have receipts this user can see. Used for the "person" filter on reports and lists. */
receiptsRouter.get('/encoders', async (req, res) => {
  const rows = await prisma.receipt.findMany({ where: visibleWhere(req.auth!), distinct: ['encoderId'], select: { encoder: { select: { id: true, name: true } } } });
  res.json({ people: rows.map((r) => r.encoder).sort((a, b) => a.name.localeCompare(b.name)) });
});

receiptsRouter.get('/export', async (req, res) => {
  const format = req.query.format === 'xlsx' ? 'xlsx' : 'csv';
  const q = listQuerySchema.parse({ ...req.query, page: 1, pageSize: 100 });
  const where: Prisma.ReceiptWhereInput = { AND: [visibleWhere(req.auth!), filterWhere(q)] };
  const rows = await prisma.receipt.findMany({ where, include: receiptInclude, orderBy: { id: 'asc' }, take: 20000 });
  const head = ['Reference', 'Status', 'Invoice date', 'Invoice no.', 'Vendor', 'Vendor TIN', 'Vendor address', 'Type', 'BIR invoice', 'Gross amount (PHP)', 'VAT type', 'Vatable amount', 'VAT amount', 'Withheld', 'Withholding rate %', 'Withholding amount', 'Classification', 'Reason for spending', 'Description', 'Encoded by', 'Document no.', 'Payment no.', 'Paid on', 'Amount paid (PHP)'];
  const data = rows.map((r) => [r.refNo, r.status, dateOnly(r.receiptDate), r.invoiceNo ?? '', r.payee, r.vendorTin ?? '', r.vendorAddress ?? '', typeLabel(r), yn(r.birInvoice), Number(r.amount), r.vatType ? VAT_LABEL[r.vatType as keyof typeof VAT_LABEL] ?? r.vatType : '', num(r.vatableAmount), num(r.vatAmount), yn(r.withheld), num(r.whtRate), num(r.whtAmount), classificationText(r.classification, r.classificationOther), r.reasonForSpending ?? '', r.description ?? '', r.encoder.name, r.document?.docNo ?? '', r.payment?.paymentNo ?? '', r.payment ? dateOnly(r.payment.paidOn) : '', num(r.paidAmount)]);
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
  for (const c of [10, 12, 13, 15, 16, 24]) ws.getColumn(c).numFmt = '#,##0.00';
  [16, 12, 13, 16, 28, 18, 30, 10, 11, 16, 12, 14, 12, 10, 12, 14, 22, 30, 30, 20, 16, 18, 12, 16].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment(`receipts-${stamp}.xlsx`).send(Buffer.from(await wb.xlsx.writeBuffer()));
});

receiptsRouter.post('/', requirePerm('receipt.create'), async (req, res) => {
  const data = makeReceiptSchema(getSettings()).parse(req.body);
  const r = await prisma.$transaction(async (tx) =>
    tx.receipt.create({ data: { refNo: await nextReceiptRef(tx), encoderId: req.auth!.user.id, ...formColumns(data) }, include: receiptInclude }),
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
  const data = makeReceiptSchema(getSettings()).parse(req.body);
  const updated = await prisma.receipt.update({ where: { id: r.id }, data: formColumns(data), include: receiptInclude });
  await audit(req, {
    action: 'receipt.updated', entityType: 'receipt', entityId: r.id, summary: 'updated the receipt',
    before: { vendor: r.payee, amount: Number(r.amount), date: dateOnly(r.receiptDate), invoiceNo: r.invoiceNo, vendorTin: r.vendorTin, type: r.transactionType, bir: r.birInvoice, vatType: r.vatType, vatable: num(r.vatableAmount), vat: num(r.vatAmount), withheld: r.withheld, whtRate: num(r.whtRate), whtAmount: num(r.whtAmount) },
    after: { vendor: data.payee, amount: data.amount, date: data.receiptDate, invoiceNo: data.invoiceNo ?? null, vendorTin: data.vendorTin ?? null, type: data.transactionType, bir: data.birInvoice, vatType: data.vatType ?? null, vatable: data.vatableAmount ?? null, vat: data.vatAmount ?? null, withheld: data.withheld ?? null, whtRate: data.whtRate ?? null, whtAmount: data.whtAmount ?? null },
  });
  res.json({ receipt: await receiptDetail(req.auth!, updated) });
});

/** A draft that was started by mistake can be thrown away. Anything that was submitted must be withdrawn first. */
receiptsRouter.delete('/:id', requirePerm('receipt.create'), async (req, res) => {
  const r = await loadVisible(req.auth!, idParam(req.params.id));
  assertOwner(req.auth!, r);
  if (r.status !== 'draft') throw conflict('Only a draft can be deleted. If it was submitted, withdraw it first.', 'INVALID_STATE');
  const files = await prisma.receiptEvidence.findMany({ where: { receiptId: r.id } });
  await prisma.receipt.delete({ where: { id: r.id } });
  for (const f of files) await removeFile(f.storedName);
  await audit(req, { action: 'receipt.deleted', entityType: 'receipt', entityId: r.id, summary: `deleted the draft ${r.refNo}`, before: { payee: r.payee, amount: Number(r.amount), files: files.length } });
  res.json({ ok: true });
});

receiptsRouter.post('/:id/copy', requirePerm('receipt.create'), async (req, res) => {
  const r = await loadVisible(req.auth!, idParam(req.params.id));
  assertOwner(req.auth!, r);
  if (r.status !== 'disapproved') throw conflict('Only disapproved receipts can be copied.', 'INVALID_STATE');
  const copy = await prisma.$transaction(async (tx) =>
    tx.receipt.create({
      data: {
        refNo: await nextReceiptRef(tx), encoderId: r.encoderId, payee: r.payee, receiptDate: r.receiptDate, amount: r.amount, categoryId: r.categoryId, description: r.description,
        birInvoice: r.birInvoice, invoiceUnderCompany: r.invoiceUnderCompany, reasonForSpending: r.reasonForSpending, classification: r.classification, classificationOther: r.classificationOther,
        seenCompany: r.seenCompany, seenTin: r.seenTin, seenAddress: r.seenAddress, noBirReason: r.noBirReason, invoiceNo: r.invoiceNo,
        vendorAddress: r.vendorAddress, vendorTin: r.vendorTin, transactionType: r.transactionType, vatType: r.vatType, vatableAmount: r.vatableAmount,
        vatAmount: r.vatAmount, withheld: r.withheld, whtRate: r.whtRate, whtAmount: r.whtAmount,
      },
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
  if (existing.length + files.length > getSettings().evidenceMaxFiles) throw badRequest(`A receipt can have up to ${getSettings().evidenceMaxFiles} files.`, 'TOO_MANY_FILES');

  const maxMb = getSettings().evidenceMaxMb;
  const tooBig = files.find((f) => f.size > maxMb * 1_048_576);
  if (tooBig) throw badRequest(`"${tooBig.originalname}" is over ${maxMb} MB.`, 'FILE_TOO_LARGE');

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
  const rows = await prisma.auditLog.findMany({
    where: { entityType: 'receipt', entityId: String(r.id), NOT: { action: 'evidence.viewed', actorId: r.encoderId } },
    orderBy: { id: 'desc' }, take: 200,
  });
  const after = (a: { after: string | null }) => { try { return a.after ? JSON.parse(a.after) : {}; } catch { return {}; } };
  // Every payment ever recorded on this receipt, so a reversed one (no longer linked to the receipt) can still be found with its proof.
  const paymentNos = rows.filter((a) => a.action === 'payment.marked').map((a) => after(a).paymentNo).filter((x): x is string => typeof x === 'string');
  const payments = paymentNos.length ? await prisma.payment.findMany({ where: { paymentNo: { in: paymentNos } }, select: { id: true, paymentNo: true, payeeId: true } }) : [];
  const auth = req.auth!;
  // The same rule as the proof download: the person paid, Accounting, or anyone who can see a receipt the payment still covers.
  const canOpen = (p: { id: number; payeeId: number }) => auth.permissions.has('evidence.view') && (p.payeeId === auth.user.id || auth.permissions.has('payment.mark') || p.id === r.paymentId);
  res.json({
    items: rows.map((a) => {
      const data = after(a);
      const p = a.action === 'payment.marked' ? payments.find((x) => x.paymentNo === data.paymentNo) : undefined;
      return {
        id: a.id, actor: a.actorName, action: a.action, summary: a.summary, note: data.note ?? null, createdAt: a.createdAt,
        ...(p ? { payment: { id: p.id, paymentNo: p.paymentNo, reversed: p.id !== r.paymentId, canOpenProof: canOpen(p) } } : {}),
      };
    }),
  });
});

/* ---------- workflow actions ---------- */

const SUMMARY: Record<ReceiptAction, string> = {
  submit: 'submitted for checking', withdraw: 'withdrew the receipt', check: 'marked as checked', return: 'returned the record',
  pay: 'marked as paid', reverse_payment: 'reversed the payment',
  undo: 'took back the decision', request: 'asked for more proof', approve: 'approved the record', disapprove: 'disapproved the record', reserve: 'put the record on hold', release: 'released the reservation',
};

async function runAction(req: import('express').Request, action: ReceiptAction, receiptId: number = idParam(req.params.id), rawBody: unknown = req.body) {
  const auth = req.auth!;
  const t = transitionFor(action)!;
  if (action === 'pay') throw badRequest('Use the payment form to mark receipts as paid.', 'USE_PAYMENT_FORM');
  const body = actionBodySchema.parse(rawBody);
  const r = await loadVisible(auth, receiptId);
  if (!auth.permissions.has(t.permission)) throw forbidden();
  const isOwner = r.encoderId === auth.user.id;
  if (t.owner && !isOwner) throw forbidden('Only the person who encoded this receipt can do that.');
  if (t.notOwner && isOwner) throw forbidden('You cannot review a receipt you encoded.', 'OWN_RECEIPT');
  if (!t.from.includes(r.status as ReceiptStatus)) throw conflict(`This receipt is ${r.status}, so it cannot be changed this way.`, 'INVALID_STATE');
  if (body.version !== r.version) throw conflict('Someone else changed this receipt. Reload and try again.', 'RECORD_CHANGED');
  const note = body.note?.trim() || null;
  // Sending a receipt back: the problems ticked from the short list, with or without a typed note.
  const issues: ReturnIssueCode[] = action === 'return' || action === 'request' ? [...new Set(body.issues ?? [])] : [];
  if (body.issues?.length && !issues.length) throw badRequest('Problems can only be listed when sending a receipt back.', 'ISSUES_NOT_ALLOWED');
  // What people read in notices, emails and the history: the ticked problems, then the note.
  const reason = issues.length ? issuesText(issues, note) : note;
  const hasReason = !!note || issues.some((c) => c !== 'other');
  if (t.note === 'required' && !hasReason) throw badRequest(action === 'return' ? 'Tell the Med Ref what to fix.' : action === 'disapprove' ? 'A reason is required.' : 'A note is required.', 'NOTE_REQUIRED');
  if (issues.includes('other') && !note) throw badRequest('Say what the other problem is.', 'NOTE_REQUIRED');

  if (action === 'submit') {
    const n = await prisma.receiptEvidence.count({ where: { receiptId: r.id, deletedAt: null } });
    if (!n) throw badRequest('Add at least one photo or PDF of the receipt before submitting.', 'NO_EVIDENCE');
    // Receipts made before the form changed, or imported from the old template, have no invoice answers yet.
    if (r.birInvoice === null || (r.birInvoice && !r.transactionType)) throw badRequest('Open the receipt and fill in the invoice details before submitting.', 'FORM_INCOMPLETE');
    if (getSettings().warningsBlock) {
      const num = (v: { toString(): string } | null) => (v === null ? null : Number(v));
      const w = receiptWarnings({ birInvoice: r.birInvoice, amount: Number(r.amount), vendorTin: r.vendorTin, vatType: r.vatType, vatableAmount: num(r.vatableAmount), vatAmount: num(r.vatAmount), withheld: r.withheld, whtRate: num(r.whtRate), whtAmount: num(r.whtAmount) }, getSettings());
      if (w.length) throw badRequest(`Fix these before submitting: ${w.join(' ')}`, 'WARNINGS_BLOCK');
    }
  }
  const now = new Date();
  // Defence in depth: whatever the status says, a decision needs a recorded check by someone else.
  if ((action === 'approve' || action === 'disapprove' || action === 'reserve') && (!r.checkedById || !r.checkedAt)) {
    throw conflict('This receipt has not been checked yet, so it cannot be decided.', 'NOT_CHECKED');
  }
  if (action === 'approve' || action === 'disapprove' || action === 'reserve') {
    const seen = await prisma.auditLog.count({
      where: { actorId: auth.user.id, entityType: 'receipt', entityId: String(r.id), action: 'evidence.viewed', createdAt: { gte: r.checkedAt ?? r.submittedAt ?? new Date(0) } },
    });
    if (!seen) throw badRequest('Open the evidence before deciding on this receipt.', 'EVIDENCE_NOT_VIEWED');
  }
  if (action === 'undo') {
    if (r.decidedById !== auth.user.id) throw forbidden('Only the person who made the decision can take it back.', 'NOT_DECIDER');
    if (!r.decidedAt || now.getTime() - r.decidedAt.getTime() > getSettings().undoMinutes * 60_000) {
      throw conflict(`A decision can only be taken back within ${getSettings().undoMinutes} minutes.`, 'UNDO_EXPIRED');
    }
  }
  if (action === 'check') {
    const viewed = await prisma.auditLog.count({
      where: { actorId: auth.user.id, entityType: 'receipt', entityId: String(r.id), action: 'evidence.viewed', createdAt: { gte: r.submittedAt ?? new Date(0) } },
    });
    if (!viewed) throw badRequest('Open the evidence before marking this checked.', 'EVIDENCE_NOT_VIEWED');
    // A receipt with a BIR invoice needs the Checker's own answer on the company name, TIN and address. Anything not seen needs a reason.
    if (r.birInvoice && r.invoiceUnderCompany !== false) {
      if (!body.seen) throw badRequest('Confirm whether the company name, TIN and address can be seen completely on the invoice.', 'SEEN_REQUIRED');
      if ((!body.seen.company || !body.seen.tin || !body.seen.address) && !note) throw badRequest('Say what could not be seen on the invoice.', 'NOTE_REQUIRED');
    }
  }

  const data: Prisma.ReceiptUncheckedUpdateManyInput = { status: t.to, version: { increment: 1 } };
  if (action === 'withdraw') Object.assign(data, { submittedAt: null, lastNote: null });
  if (action === 'submit') Object.assign(data, { submittedAt: now, checkedById: null, checkedAt: null, checkNote: null, lastNote: null, ckCompany: null, ckTin: null, ckAddress: null });
  if (action === 'check') Object.assign(data, { checkedById: auth.user.id, checkedAt: now, checkNote: note, ckCompany: body.seen?.company ?? null, ckTin: body.seen?.tin ?? null, ckAddress: body.seen?.address ?? null });
  if (action === 'return' || action === 'reserve' || action === 'request') data.lastNote = note;
  // The ticked problems belong to one return: replaced on every return, cleared by every other action.
  data.returnIssues = action === 'return' || action === 'request' ? joinIssues(issues) : null;
  // Asking for more proof sends it back to be checked again from the start.
  if (action === 'request') Object.assign(data, { checkedById: null, checkedAt: null, checkNote: null, ckCompany: null, ckTin: null, ckAddress: null });
  if (action === 'release') data.lastNote = null;
  if (action === 'undo') Object.assign(data, { decidedById: null, decidedAt: null, decisionNote: null, lastNote: null });
  // The payment row stays (it is the record of what happened); only the receipt's link to it is cleared.
  if (action === 'reverse_payment') Object.assign(data, { paymentId: null, paidAmount: null, paidShortReason: null, paidAt: null });
  if (action === 'approve' || action === 'disapprove') Object.assign(data, { decidedById: auth.user.id, decidedAt: now, decisionNote: note, lastNote: action === 'disapprove' ? note : null });

  let docNo: string | null = null;
  await prisma.$transaction(async (tx) => {
    const res = await tx.receipt.updateMany({ where: { id: r.id, version: r.version, status: r.status }, data });
    if (!res.count) throw conflict('Someone else changed this receipt. Reload and try again.', 'RECORD_CHANGED');
    if (action === 'undo' && r.status === 'approved') await tx.reimbursementDocument.deleteMany({ where: { receiptId: r.id } });
    if (action === 'approve') {
      docNo = await nextDocNo(tx);
      await tx.reimbursementDocument.create({ data: { receiptId: r.id, docNo } });
    }
  });
  if (action === 'approve') await enqueue('document', { receiptId: r.id });
  if (action === 'undo' && r.document?.filePath) await removeFile(r.document.filePath).catch(() => undefined);

  await audit(req, {
    action: action === 'reverse_payment' ? 'payment.reversed' : `receipt.${action}`, entityType: 'receipt', entityId: r.id, summary: SUMMARY[action],
    before: { status: r.status, ...(action === 'reverse_payment' && r.payment ? { paymentNo: r.payment.paymentNo, amount: Number(r.paidAmount) } : {}) }, after: { status: t.to, ...(reason ? { note: reason } : {}), ...(issues.length ? { issues } : {}), ...(docNo ? { docNo } : {}), ...(action === 'check' && body.seen ? { seen: body.seen } : {}) },
  });

  /* notifications */
  const who = auth.user.name;
  const ref = `${r.refNo} (${r.payee})`;
  const others = (ids: (number | null | undefined)[]) => ids.filter((x): x is number => !!x && x !== auth.user.id);
  const mail = receiptData({ refNo: r.refNo, payee: r.payee, amount: Number(r.amount), status: t.to, receiptDate: dateOnly(r.receiptDate), category: typeLabel(r) }, { actorName: who, note: reason, docNo });
  if (action === 'withdraw') await notify({ userIds: others(await usersWithPermission('review.check')), type: 'receipt.withdrawn', receiptId: r.id, text: `${ref} was withdrawn by ${who}.` });
  if (action === 'submit') await notify({ userIds: others(await usersWithPermission('review.check')), type: 'receipt.submitted', receiptId: r.id, text: `${ref} is waiting to be checked.` });
  if (action === 'check') await notify({ userIds: others(await usersWithPermission('review.decide')), type: 'receipt.checked', receiptId: r.id, text: `${ref} was checked and is ready for your decision.` });
  // The Med Ref's email button opens the form on the first problem that has a step to fix.
  const firstStep = issues.map(fixStepFor).find((s) => s);
  const fixLink = issues.length ? `${receiptUrl(r.id)}/edit${firstStep ? `?step=${firstStep}` : ''}` : undefined;
  if (action === 'return') await notify({ userIds: [r.encoderId], type: 'receipt.returned', receiptId: r.id, text: `${ref} was returned. ${reason}`, email: { template: 'returned', data: mail, link: fixLink } });
  if (action === 'request') await notify({ userIds: [r.encoderId], type: 'receipt.returned', receiptId: r.id, text: `${ref}: ${who} needs more proof. ${reason}`, email: { template: 'returned', data: mail, link: fixLink } });
  if (action === 'request' && r.checkedById && r.checkedById !== auth.user.id) await notify({ userIds: [r.checkedById], type: 'receipt.requested', receiptId: r.id, text: `${who} asked the Med Ref for more proof on ${ref}. It will come back to you to check.` });
  if (action === 'approve') await notify({ userIds: [r.encoderId, ...others([r.checkedById])], type: 'receipt.approved', receiptId: r.id, text: `${ref} was approved. Document ${docNo} is ready.`, email: { template: 'approved', data: mail } });
  if (action === 'approve') await notify({ userIds: others(await usersWithPermission('payment.mark')).filter((id) => id !== r.encoderId), type: 'receipt.ready_to_pay', receiptId: r.id, text: `${ref} was approved and is ready to pay.` });
  if (action === 'reverse_payment') await notify({ userIds: [r.encoderId], type: 'payment.reversed', receiptId: r.id, text: `The payment for ${ref} was reversed. ${note}`, email: { template: 'payment_reversed', data: { ...mail, paymentNo: r.payment?.paymentNo ?? '' } } });
  if (action === 'disapprove') await notify({ userIds: [r.encoderId, ...others([r.checkedById])], type: 'receipt.disapproved', receiptId: r.id, text: `${ref} was disapproved. ${note}`, email: { template: 'disapproved', data: mail } });
  if (action === 'reserve') await notify({ userIds: [r.encoderId, ...others([r.checkedById])], type: 'receipt.reserved', receiptId: r.id, text: `${ref} is on hold. ${note}`, email: { template: 'reserved', data: mail } });
  if (action === 'undo') await notify({ userIds: [r.encoderId, ...others([r.checkedById])], type: 'receipt.reversed', receiptId: r.id, text: `The decision on ${ref} was reversed. ${note}`, email: { template: 'reversed', data: mail } });
  if (action === 'release') await notify({ userIds: [r.encoderId], type: 'receipt.released', receiptId: r.id, text: `The hold on ${ref} was released.`, email: { template: 'released', data: mail, respectPref: 'reservationReleased' } });

  // Reload without the visibility filter: the action may have moved the receipt out of this person's view (an approver sending one back), and they should still get a proper reply.
  const fresh = await prisma.receipt.findUniqueOrThrow({ where: { id: r.id }, include: receiptInclude });
  return receiptDetail(auth, fresh);
}

/* ---------- bulk: check or approve several at once ---------- */

/** Each receipt goes through exactly the same rules as one done by hand, so a bulk action can never skip the evidence or the "checked first" rule. */
receiptsRouter.post('/bulk', async (req, res) => {
  const b = bulkSchema.parse(req.body);
  const results: { id: number; refNo: string | null; ok: boolean; message: string }[] = [];
  for (const id of [...new Set(b.ids)]) {
    const rec = await prisma.receipt.findFirst({ where: { AND: [{ id }, visibleWhere(req.auth!)] }, select: { id: true, refNo: true, version: true } });
    if (!rec) { results.push({ id, refNo: null, ok: false, message: 'Not found.' }); continue; }
    try {
      await runAction(req, b.action, id, { note: b.note, version: rec.version });
      results.push({ id, refNo: rec.refNo, ok: true, message: 'Done.' });
    } catch (e) {
      results.push({ id, refNo: rec.refNo, ok: false, message: e instanceof HttpError ? e.message : 'Something went wrong.' });
    }
  }
  await audit(req, { action: 'receipt.bulk', entityType: 'receipt', summary: `ran "${b.action}" on ${results.length} receipts (${results.filter((x) => x.ok).length} done)` });
  res.json({ results, done: results.filter((x) => x.ok).length, skipped: results.filter((x) => !x.ok).length });
});

/* ---------- comments ---------- */

receiptsRouter.get('/:id/comments', async (req, res) => {
  const r = await loadVisible(req.auth!, idParam(req.params.id));
  const rows = await prisma.comment.findMany({ where: { receiptId: r.id }, include: { author: { select: { id: true, name: true } } }, orderBy: { id: 'asc' }, take: 300 });
  res.json({ comments: rows.map((c) => ({ id: c.id, body: c.body, createdAt: c.createdAt, author: c.author, mine: c.authorId === req.auth!.user.id })) });
});

const commentLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: { code: 'RATE_LIMIT', message: 'You are commenting very fast. Wait a moment.' } } });

receiptsRouter.post('/:id/comments', commentLimiter, async (req, res) => {
  const r = await loadVisible(req.auth!, idParam(req.params.id));
  const { body } = commentSchema.parse(req.body);
  const me = req.auth!.user;
  const c = await prisma.comment.create({ data: { receiptId: r.id, authorId: me.id, body } });
  await audit(req, { action: 'receipt.commented', entityType: 'receipt', entityId: r.id, summary: 'added a comment', after: { note: body } });
  // Everyone who has touched this receipt hears about it, except the person who wrote it.
  const earlier = await prisma.comment.findMany({ where: { receiptId: r.id }, select: { authorId: true }, distinct: ['authorId'] });
  const people = [r.encoderId, r.checkedById, r.decidedById, ...earlier.map((x) => x.authorId)].filter((x): x is number => !!x && x !== me.id);
  await notify({ userIds: people, type: 'receipt.commented', receiptId: r.id, text: `${me.name} commented on ${r.refNo}: ${body.slice(0, 120)}` });
  res.status(201).json({ comment: { id: c.id, body: c.body, createdAt: c.createdAt, author: { id: me.id, name: me.name }, mine: true } });
});

for (const t of TRANSITIONS) {
  if (t.action === 'pay') continue; // paying needs the proof and amounts: POST /api/payments
  receiptsRouter.post(`/:id/${t.action}`, async (req, res) => {
    res.json({ receipt: await runAction(req, t.action) });
  });
}
