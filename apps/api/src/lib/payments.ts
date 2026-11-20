import type { Request } from 'express';
import { paymentIssues, totalOf, type PaymentLine } from '@reimsys/shared';
import { prisma } from '../db.js';
import { audit } from './audit.js';
import { getSettings } from './appSettings.js';
import { badRequest, conflict, forbidden, notFound } from './errors.js';
import { getPaymentMethods } from './paymentMethods.js';
import { announcePaid } from './paymentNotices.js';
import { visibleWhere } from './receipts.js';
import { nextPaymentNo } from './sequence.js';
import { removeFile, saveFile, sha256Of, sniff } from './storage.js';

export interface RecordedPayment { id: number; paymentNo: string; payeeId: number; count: number; total: number }

/**
 * Checks and records payments for approved receipts: one payment per person whose receipts are listed, all with the same
 * date, method and proof. Every rule is checked for every receipt before anything is saved, and every receipt changes in
 * one transaction, so either all of it is recorded or none of it is.
 *
 * `onePerson` keeps the rule of the plain payment form (one payment covers one person). A batch may cover several people.
 * `batchId`, when set, refuses any receipt that is not in that batch.
 */
export async function recordPayments(
  req: Request,
  body: { method: string; paidOn: string; lines: PaymentLine[] },
  file: Express.Multer.File | undefined,
  opts: { onePerson: boolean; batchId?: number },
): Promise<RecordedPayment[]> {
  const auth = req.auth!;
  const method = (await getPaymentMethods()).find((m) => m.toLowerCase() === body.method.toLowerCase());
  if (!method) throw badRequest('Choose one of the listed payment methods.', 'BAD_METHOD');
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
    if (opts.batchId !== undefined && r.batchId !== opts.batchId) throw conflict(`${r.refNo} is no longer in this batch. Reload and try again.`, 'NOT_IN_BATCH');
    if (r.encoderId === auth.user.id) throw forbidden('You cannot pay a receipt you encoded.', 'OWN_RECEIPT');
    if (r.checkedById === auth.user.id || r.decidedById === auth.user.id) throw forbidden('You checked or approved this receipt, so someone else has to pay it.', 'SAME_PERSON');
    if (r.status !== 'approved') throw conflict(`${r.refNo} is ${r.status}, so it cannot be paid.`, 'INVALID_STATE');
    if (body.lines.find((l) => l.receiptId === r.id)!.version !== r.version) throw conflict(`${r.refNo} changed since you opened it. Reload and try again.`, 'RECORD_CHANGED');
  }
  if (opts.onePerson && new Set(receipts.map((r) => r.encoderId)).size !== 1) throw badRequest('One payment can only cover the receipts of one person.', 'MIXED_PAYEES');
  const issue = paymentIssues(body, new Map(receipts.map((r) => [r.id, Number(r.amount)])))[0];
  if (issue) {
    const ref = receipts.find((r) => r.id === issue.receiptId)?.refNo;
    throw badRequest(ref ? `${ref}: ${issue.message}` : issue.message, issue.code);
  }

  // One payment per person, in the order their receipts were listed.
  const payees = [...new Set(body.lines.map((l) => receipts.find((r) => r.id === l.receiptId)!.encoderId))];
  const linesOf = (payeeId: number) => body.lines.filter((l) => receipts.find((r) => r.id === l.receiptId)!.encoderId === payeeId);
  // Several payments share one stored proof file. Nothing ever deletes a proof once it is recorded (a reversal keeps the payment row).
  const proofFile = await saveFile('proofs', kind.ext, file.buffer);
  const sha = sha256Of(file.buffer);
  const now = new Date();
  let payments: { id: number; paymentNo: string; payeeId: number }[];
  try {
    // Every receipt changes in the same transaction, and only if it is still approved at the version that was shown, so nobody pays twice.
    payments = await prisma.$transaction(async (tx) => {
      const out: { id: number; paymentNo: string; payeeId: number }[] = [];
      for (const payeeId of payees) {
        const p = await tx.payment.create({
          data: { paymentNo: await nextPaymentNo(tx), payeeId, method, paidOn: new Date(body.paidOn + 'T00:00:00Z'), proofFile, proofMime: kind.mime, proofSize: file.size, proofSha256: sha, recordedById: auth.user.id },
        });
        for (const l of linesOf(payeeId)) {
          const done = await tx.receipt.updateMany({
            where: { id: l.receiptId, version: l.version, status: 'approved', ...(opts.batchId !== undefined ? { batchId: opts.batchId } : {}) },
            data: { status: 'paid', version: { increment: 1 }, paymentId: p.id, paidAmount: l.amount, paidShortReason: l.shortReason, paidAt: now },
          });
          if (!done.count) throw conflict('Someone else changed one of these receipts. Reload and try again.', 'RECORD_CHANGED');
        }
        out.push({ id: p.id, paymentNo: p.paymentNo, payeeId });
      }
      return out;
    }, { timeout: 60_000 });
  } catch (err) {
    await removeFile(proofFile).catch(() => undefined);
    throw err;
  }

  for (const p of payments) {
    const lines = linesOf(p.payeeId);
    for (const l of lines) {
      await audit(req, {
        action: 'payment.marked', entityType: 'receipt', entityId: l.receiptId, summary: `marked as paid (${p.paymentNo})`,
        before: { status: 'approved' }, after: { status: 'paid', paymentNo: p.paymentNo, amount: l.amount, method, paidOn: body.paidOn, ...(l.shortReason ? { note: l.shortReason } : {}) },
      });
    }
    await announcePaid({
      payeeId: p.payeeId, paymentNo: p.paymentNo, method, paidOn: body.paidOn, actorName: auth.user.name,
      lines: lines.map((l) => { const r = receipts.find((x) => x.id === l.receiptId)!; return { id: r.id, refNo: r.refNo, payee: r.payee, amount: Number(r.amount), paid: l.amount }; }),
    });
  }
  return payments.map((p) => { const lines = linesOf(p.payeeId); return { ...p, count: lines.length, total: totalOf(lines) }; });
}
