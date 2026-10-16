import { DEFAULT_PAYMENT_METHODS, paymentMethodsSchema } from '@reimsys/shared';
import { prisma } from '../db.js';

const KEY = 'payment.methods';

/** The methods Accounting can choose from. A missing or damaged saved list falls back to the defaults, never to an empty list. */
export async function getPaymentMethods(): Promise<string[]> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  if (!row) return [...DEFAULT_PAYMENT_METHODS];
  try {
    const parsed = paymentMethodsSchema.safeParse({ methods: JSON.parse(row.value) });
    if (parsed.success) return parsed.data.methods;
  } catch {
    /* fall back below */
  }
  return [...DEFAULT_PAYMENT_METHODS];
}

export async function savePaymentMethods(methods: string[], userId: number) {
  const value = JSON.stringify(methods);
  await prisma.setting.upsert({ where: { key: KEY }, update: { value, updatedById: userId }, create: { key: KEY, value, updatedById: userId } });
}
