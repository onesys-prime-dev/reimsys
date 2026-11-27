import { BATCHABLE_STATUSES, BATCH_MAX, CUTOFF_CLAIM_MS, isLateBatch } from '@reimsys/shared';
import { prisma } from '../db.js';
import { conflict, notFound } from './errors.js';

/**
 * A Med Ref choosing the batch of their own receipt (see "Med Ref chooses the batch" in docs/PLAN.md). Only a batch that is still open,
 * whose cutoff has not run and is not running right now, can be chosen or left: after that it is Accounting's (adding late, removing).
 */
type BatchState = { code: string; closedAt: Date | null; cutoffAt: Date | null; cutoffDoneAt: Date | null; cutoffClaimedAt?: Date | null };

const running = (b: BatchState) => !!b.cutoffClaimedAt && Date.now() - b.cutoffClaimedAt.getTime() < CUTOFF_CLAIM_MS;
export const isChoosable = (b: BatchState) => !isLateBatch(b) && !running(b);
export const notChoosable = (b: BatchState) => running(b)
  ? conflict(`Batch ${b.code} is running its cutoff right now. Try again in a minute.`, 'BATCH_NOT_OPEN')
  : conflict(`Batch ${b.code} is closed or its cutoff has run. Accounting can still add your receipt to it late.`, 'BATCH_NOT_OPEN');

/** Checks a batch can be chosen for a draft (it joins when the draft is submitted). */
export async function checkChoosable(batchId: number) {
  const b = await prisma.batch.findUnique({ where: { id: batchId } });
  if (!b) throw notFound('That batch no longer exists.');
  if (!isChoosable(b)) throw notChoosable(b);
  return b;
}

/**
 * Moves a submitted receipt from its batch (or none) into another (or none). Both batch rows are locked, lower id first, so it never
 * overfills a batch, never lands in two, and cannot slip into one whose cutoff is running.
 */
export async function moveOwnReceipt(receiptId: number, fromId: number | null, toId: number | null) {
  return prisma.$transaction(async (tx) => {
    for (const id of [fromId, toId].filter((x): x is number => !!x).sort((a, b) => a - b)) await tx.batch.updateMany({ where: { id }, data: { updatedAt: new Date() } });
    const from = fromId ? await tx.batch.findUnique({ where: { id: fromId } }) : null;
    const to = toId ? await tx.batch.findUnique({ where: { id: toId } }) : null;
    if (toId && !to) throw notFound('That batch no longer exists.');
    if (from && !isChoosable(from)) throw conflict(`It is in batch ${from.code}, which is closed or already cut off. Ask Accounting to move it.`, 'BATCH_NOT_OPEN');
    if (to && !isChoosable(to)) throw notChoosable(to);
    if (to && (await tx.receipt.count({ where: { batchId: to.id } })) >= BATCH_MAX) throw conflict(`Batch ${to.code} is full (${BATCH_MAX} receipts). Choose another.`, 'BATCH_FULL');
    const n = await tx.receipt.updateMany({ where: { id: receiptId, batchId: fromId, status: { in: [...BATCHABLE_STATUSES] } }, data: { batchId: toId, wantBatchId: null, batchLateAt: null, batchLateNote: null } });
    if (!n.count) throw conflict('It changed meanwhile. Reload and try again.', 'RECORD_CHANGED');
    return { from, to };
  });
}
