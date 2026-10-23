import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import ExcelJS from 'exceljs';
import { EVIDENCE_MAX_BYTES, cleanDeep, paymentIssues, paymentMethodsSchema, paymentRequestSchema, totalOf } from '@reimsys/shared';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { getSettings } from '../lib/appSettings.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { getPaymentMethods, savePaymentMethods } from '../lib/paymentMethods.js';
import { announcePaid } from '../lib/paymentNotices.js';
import { dateOnly, receiptBrief, receiptInclude, visibleWhere } from '../lib/receipts.js';
import { toCsv } from '../lib/reports.js';
import { nextPaymentNo } from '../lib/sequence.js';
import { readFile, removeFile, saveFile, sha256Of, sniff } from '../lib/storage.js';
import { requireAuth, requirePerm } from '../middleware/auth.js';

export const paymentsRouter = Router();
paymentsRouter.use(requireAuth);

const idParam = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw notFound('Payment not found.');
  return n;
};
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: EVIDENCE_MAX_BYTES, files: 1 } });
const payLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false, message: { error: { code: 'RATE_LIMIT', message: 'Too many payments in a minute. Wait a moment.' } } });

/* ---------- payment methods ---------- */

paymentsRouter.get('/methods', async (_req, res) => {
  res.json({ methods: await getPaymentMethods() });
});

paymentsRouter.put('/methods', requirePerm('settings.manage'), async (req, res) => {
  const { methods } = paymentMethodsSchema.parse(req.body);
  const before = await getPaymentMethods();
  await savePaymentMethods(methods, req.auth!.user.id);
  await audit(req, { action: 'settings.payment_methods', entityType: 'settings', entityId: 'payment.methods', summary: `changed the payment methods to ${methods.join(', ')}`, before: { methods: before }, after: { methods } });
  res.json({ methods });
});

/* ---------- what is waiting to be paid ---------- */

paymentsRouter.get('/queue', requirePerm('payment.mark'), async (req, res) => {
  const auth = req.auth!;
  const rows = await prisma.receipt.findMany({
    where: { AND: [visibleWhere(auth), { status: 'approved', encoderId: { not: auth.user.id } }] },
    include: receiptInclude, orderBy: [{ decidedAt: 'asc' }, { id: 'asc' }], take: 1000,
  });
  const people = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.encoderId))] } }, select: { id: true, name: true, branch: true } });
  const groups = people.map((payee) => {
    const mine = rows.filter((r) => r.encoderId === payee.id);
    return { payee, count: mine.length, total: totalOf(mine.map((r) => ({ amount: Number(r.amount) }))), receipts: mine.map(receiptBrief) };
  }).sort((a, b) => a.payee.name.localeCompare(b.payee.name));
  res.json({ groups, totals: { count: rows.length, total: totalOf(rows.map((r) => ({ amount: Number(r.amount) }))) } });
});

/* ---------- mark as paid ---------- */

paymentsRouter.post('/', requirePerm('payment.mark'), payLimiter, upload.single('proof'), async (req, res) => {
  const auth = req.auth!;
  let lines: unknown;
  try { lines = cleanDeep(JSON.parse(String(req.body?.lines ?? ''))); } catch { throw badRequest('The list of receipts could not be read. Reload and try again.', 'BAD_LINES'); }
  const body = paymentRequestSchema.parse({ method: req.body?.method, paidOn: req.body?.paidOn, lines });

  const method = (await getPaymentMethods()).find((m) => m.toLowerCase() === body.method.toLowerCase());
  if (!method) throw badRequest('Choose one of the listed payment methods.', 'BAD_METHOD');
  const file = req.file;
  if (!file) throw badRequest('Attach the proof of payment (a photo or PDF).', 'PROOF_REQUIRED');
  const kind = sniff(file.buffer);
  if (!kind) throw badRequest('The proof must be a JPG, PNG, WEBP, HEIC or PDF file.', 'BAD_FILE');
  const maxMb = getSettings().evidenceMaxMb;
  if (file.size > maxMb * 1_048_576) throw badRequest(`The proof is over ${maxMb} MB.`, 'FILE_TOO_LARGE');

  const ids = body.lines.map((l) => l.receiptId);
  if (new Set(ids).size !== ids.length) throw badRequest('The same receipt is listed twice.', 'DUPLICATE_RECEIPT');
  const receipts = await prisma.receipt.findMany({ where: { AND: [{ id: { in: ids } }, visibleWhere(auth)] } });
  if (receipts.length !== ids.length) throw notFound('One of the receipts was not found.');
  for (const r of receipts) {
    if (r.encoderId === auth.user.id) throw forbidden('You cannot pay a receipt you encoded.', 'OWN_RECEIPT');
    if (r.checkedById === auth.user.id || r.decidedById === auth.user.id) throw forbidden('You checked or approved this receipt, so someone else has to pay it.', 'SAME_PERSON');
    if (r.status !== 'approved') throw conflict(`${r.refNo} is ${r.status}, so it cannot be paid.`, 'INVALID_STATE');
    if (body.lines.find((l) => l.receiptId === r.id)!.version !== r.version) throw conflict(`${r.refNo} changed since you opened it. Reload and try again.`, 'RECORD_CHANGED');
  }
  if (new Set(receipts.map((r) => r.encoderId)).size !== 1) throw badRequest('One payment can only cover the receipts of one person.', 'MIXED_PAYEES');
  const issue = paymentIssues(body, new Map(receipts.map((r) => [r.id, Number(r.amount)])))[0];
  if (issue) {
    const ref = receipts.find((r) => r.id === issue.receiptId)?.refNo;
    throw badRequest(ref ? `${ref}: ${issue.message}` : issue.message, issue.code);
  }

  const payeeId = receipts[0]!.encoderId;
  const proofFile = await saveFile('proofs', kind.ext, file.buffer);
  const now = new Date();
  let payment: { id: number; paymentNo: string };
  try {
    // Every receipt changes in the same transaction, and only if it is still approved at the version that was shown, so nobody pays twice.
    payment = await prisma.$transaction(async (tx) => {
      const p = await tx.payment.create({
        data: { paymentNo: await nextPaymentNo(tx), payeeId, method, paidOn: new Date(body.paidOn + 'T00:00:00Z'), proofFile, proofMime: kind.mime, proofSize: file.size, proofSha256: sha256Of(file.buffer), recordedById: auth.user.id },
      });
      for (const l of body.lines) {
        const done = await tx.receipt.updateMany({
          where: { id: l.receiptId, version: l.version, status: 'approved' },
          data: { status: 'paid', version: { increment: 1 }, paymentId: p.id, paidAmount: l.amount, paidShortReason: l.shortReason, paidAt: now },
        });
        if (!done.count) throw conflict('Someone else changed one of these receipts. Reload and try again.', 'RECORD_CHANGED');
      }
      return p;
    });
  } catch (err) {
    await removeFile(proofFile).catch(() => undefined);
    throw err;
  }

  for (const r of receipts) {
    const l = body.lines.find((x) => x.receiptId === r.id)!;
    await audit(req, {
      action: 'payment.marked', entityType: 'receipt', entityId: r.id, summary: `marked as paid (${payment.paymentNo})`,
      before: { status: 'approved' }, after: { status: 'paid', paymentNo: payment.paymentNo, amount: l.amount, method, paidOn: body.paidOn, ...(l.shortReason ? { note: l.shortReason } : {}) },
    });
  }
  await announcePaid({
    payeeId, paymentNo: payment.paymentNo, method, paidOn: body.paidOn, actorName: auth.user.name,
    lines: body.lines.map((l) => { const r = receipts.find((x) => x.id === l.receiptId)!; return { id: r.id, refNo: r.refNo, payee: r.payee, amount: Number(r.amount), paid: l.amount }; }),
  });
  res.status(201).json({ payment: { id: payment.id, paymentNo: payment.paymentNo, method, paidOn: body.paidOn, count: body.lines.length, total: totalOf(body.lines) } });
});

/* ---------- proof of payment ---------- */

const MODES = { view: ['evidence.view', 'inline', 'viewed'], print: ['evidence.print', 'inline', 'printed'], download: ['evidence.download', 'attachment', 'downloaded'] } as const;
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'application/pdf': 'pdf' };

/** The person who was paid, Accounting, and anyone who can see a receipt in the payment. Everyone else gets "not found". */
/* ---------- export for the accountant ---------- */

const day = (v: unknown, label: string) => {
  const s = typeof v === 'string' ? v : '';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T00:00:00Z') : null;
  if (!d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw badRequest(`${label} must be a date like 2026-10-31.`, 'BAD_DATE');
  return d;
};

/** One row per receipt paid in the period, ordered by payment date, as CSV or Excel. */
paymentsRouter.get('/export', requirePerm('payment.mark'), async (req, res) => {
  const from = day(req.query.from, 'The start date');
  const to = day(req.query.to, 'The end date');
  if (from > to) throw badRequest('The start date is after the end date.', 'BAD_PERIOD');
  const rows = await prisma.receipt.findMany({
    where: { AND: [visibleWhere(req.auth!), { paymentId: { not: null }, payment: { paidOn: { gte: from, lte: to } } }] },
    include: { payment: { include: { payee: { select: { name: true } }, recordedBy: { select: { name: true } } } } },
    take: 20000,
  });
  rows.sort((a, b) => a.payment!.paidOn.getTime() - b.payment!.paidOn.getTime() || a.payment!.paymentNo.localeCompare(b.payment!.paymentNo) || a.id - b.id);
  const head = ['Payment no.', 'Paid on', 'Method', 'Paid to', 'Receipt ref.', 'Vendor', 'Invoice no.', 'Invoice date', 'Receipt amount (PHP)', 'Amount paid (PHP)', 'Short-payment reason', 'Recorded by'];
  const data = rows.map((r) => [r.payment!.paymentNo, dateOnly(r.payment!.paidOn), r.payment!.method, r.payment!.payee.name, r.refNo, r.payee, r.invoiceNo ?? '', dateOnly(r.receiptDate), Number(r.amount), Number(r.paidAmount ?? 0), r.paidShortReason ?? '', r.payment!.recordedBy.name]);
  await audit(req, { action: 'payment.exported', entityType: 'export', summary: `exported ${rows.length} paid receipt${rows.length === 1 ? '' : 's'} (${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)})` });
  const name = `payments-${from.toISOString().slice(0, 10)}-to-${to.toISOString().slice(0, 10)}`;
  if (req.query.format !== 'xlsx') {
    res.type('text/csv').attachment(`${name}.csv`).send(toCsv([head, ...data]));
    return;
  }
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Payments');
  ws.addRow(head).font = { bold: true };
  data.forEach((d) => ws.addRow(d));
  ws.columns.forEach((c) => { c.width = 20; });
  ws.getColumn(9).numFmt = '#,##0.00';
  ws.getColumn(10).numFmt = '#,##0.00';
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment(`${name}.xlsx`).send(Buffer.from(await wb.xlsx.writeBuffer()));
});

paymentsRouter.get('/:id/proof', async (req, res) => {
  const auth = req.auth!;
  const mode = (typeof req.query.mode === 'string' && req.query.mode in MODES ? req.query.mode : 'view') as keyof typeof MODES;
  const [perm, disposition, verb] = MODES[mode];
  if (!auth.permissions.has(perm)) throw forbidden();
  const p = await prisma.payment.findUnique({ where: { id: idParam(req.params.id) } });
  if (!p) throw notFound('Payment not found.');
  const allowed = p.payeeId === auth.user.id || auth.permissions.has('payment.mark')
    || !!(await prisma.receipt.findFirst({ where: { AND: [{ paymentId: p.id }, visibleWhere(auth)] }, select: { id: true } }));
  if (!allowed) throw notFound('Payment not found.');
  // The audit row is written before any byte is sent.
  await audit(req, { action: `payment.proof_${verb}`, entityType: 'payment', entityId: p.id, summary: `${verb} the proof of payment ${p.paymentNo}` });
  const buf = await readFile(p.proofFile);
  res.setHeader('Content-Type', p.proofMime);
  res.setHeader('Content-Disposition', `${disposition}; filename="${p.paymentNo}.${EXT[p.proofMime] ?? 'bin'}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(buf);
});
