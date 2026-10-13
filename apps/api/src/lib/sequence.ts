import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';

/** Next value of a named counter. The row lock inside a transaction keeps numbers unique under concurrency. */
export async function nextSequence(key: string, tx?: Prisma.TransactionClient): Promise<number> {
  const run = async (c: Prisma.TransactionClient) => {
    const row = await c.sequence.upsert({ where: { key }, update: { value: { increment: 1 } }, create: { key, value: 1 } });
    return row.value;
  };
  return tx ? run(tx) : prisma.$transaction(run);
}

export const formatNumber = (prefix: string, n: number, year = new Date().getFullYear()) => `${prefix}-${year}-${String(n).padStart(6, '0')}`;

export async function nextReceiptRef(tx?: Prisma.TransactionClient) {
  const y = new Date().getFullYear();
  return formatNumber('RC', await nextSequence(`receipt-${y}`, tx), y);
}
export async function nextDocNo(tx?: Prisma.TransactionClient) {
  const y = new Date().getFullYear();
  return formatNumber('REIM', await nextSequence(`document-${y}`, tx), y);
}
