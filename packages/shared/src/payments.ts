import { z } from 'zod';
import { BULK_MAX } from './receipts';

/** What the Super Admin sees until they edit the list. */
export const DEFAULT_PAYMENT_METHODS = ['Bank transfer', 'Cheque', 'Cash', 'E-wallet'];
export const PAYMENT_METHODS_MAX = 12;

export const paymentMethodsSchema = z
  .object({
    methods: z
      .array(z.string().trim().min(1, 'A payment method cannot be empty.').max(40, 'Keep each payment method under 40 characters.'))
      .min(1, 'Keep at least one payment method.')
      .max(PAYMENT_METHODS_MAX, `Use at most ${PAYMENT_METHODS_MAX} payment methods.`),
  })
  .refine((d) => new Set(d.methods.map((m) => m.toLowerCase())).size === d.methods.length, { message: 'Each payment method can only be listed once.', path: ['methods'] });

export const paymentLineSchema = z.object({
  receiptId: z.number().int().positive(),
  /** The version of the receipt the person was looking at, so a receipt that changed meanwhile is not paid blindly. */
  version: z.number().int().min(0),
  amount: z
    .coerce.number({ error: 'Enter the amount paid.' })
    .positive('The amount paid must be more than zero.')
    .max(9_999_999.99, 'That amount is too large.')
    .transform((n) => Math.round(n * 100) / 100)
    .refine((n) => n > 0, 'The amount paid must be at least 0.01.'),
  shortReason: z.string().trim().max(300, 'Keep the reason under 300 characters.').nullish().transform((v) => v || null),
});
export type PaymentLine = z.infer<typeof paymentLineSchema>;

export const paymentRequestSchema = z.object({
  method: z.string().trim().min(1, 'Choose how it was paid.').max(40),
  // A date like 2026-02-31 parses (as 3 March), so it must also come back unchanged.
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date format YYYY-MM-DD.').refine((s) => !Number.isNaN(Date.parse(s)) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s, 'Enter a valid date.'),
  lines: z.array(paymentLineSchema).min(1, 'Choose at least one receipt.').max(BULK_MAX, `Pay up to ${BULK_MAX} receipts at a time.`),
});
export type PaymentRequest = z.infer<typeof paymentRequestSchema>;

export interface PaymentIssue {
  code: 'DATE_FUTURE' | 'DUPLICATE_RECEIPT' | 'OVERPAID' | 'SHORT_REASON';
  message: string;
  receiptId?: number;
}

const cents = (n: number) => Math.round(n * 100);

/** Sum of the amounts, added in centavos so the result has no floating-point crumbs. */
export const totalOf = (lines: { amount: number }[]) => lines.reduce((s, l) => s + cents(l.amount), 0) / 100;

/**
 * The money and date rules for one payment. Used by the server (the real check) and by the payment dialog (so people see the
 * problem before they press the button). `receiptAmounts` maps each receipt id to the amount on the receipt.
 */
export function paymentIssues(
  input: { paidOn: string; lines: { receiptId: number; amount: number; shortReason: string | null }[] },
  receiptAmounts: ReadonlyMap<number, number>,
  now = new Date(),
): PaymentIssue[] {
  const out: PaymentIssue[] = [];
  // One day of room, the same as the receipt date, so "today" is never refused for someone ahead of the server's clock (Manila is 8 hours ahead of UTC).
  if (input.paidOn > new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10)) out.push({ code: 'DATE_FUTURE', message: 'The payment date cannot be in the future.' });
  const seen = new Set<number>();
  for (const l of input.lines) {
    if (seen.has(l.receiptId)) { out.push({ code: 'DUPLICATE_RECEIPT', message: 'The same receipt is listed twice.', receiptId: l.receiptId }); continue; }
    seen.add(l.receiptId);
    const full = receiptAmounts.get(l.receiptId);
    if (full === undefined) continue;
    if (cents(l.amount) > cents(full)) out.push({ code: 'OVERPAID', message: `The amount paid cannot be more than the receipt amount (${full.toFixed(2)}).`, receiptId: l.receiptId });
    else if (cents(l.amount) < cents(full) && !l.shortReason) out.push({ code: 'SHORT_REASON', message: 'Say why less than the full amount was paid.', receiptId: l.receiptId });
  }
  return out;
}
