import { z } from 'zod';
import { paymentLineSchema, paymentRequestSchema } from './payments';
import type { ReceiptStatus } from './receipts';

/**
 * A batch is a code that groups receipts so they can be found and worked on together. It is a label, not a second workflow:
 * every receipt in it keeps its own status and goes through exactly the same rules as one done by hand.
 */
export const BATCH_MAX = 300;

/** Statuses a receipt can be added to a batch in. Drafts are private to the Med Ref; paid and disapproved receipts are finished. */
export const BATCHABLE_STATUSES: readonly ReceiptStatus[] = ['submitted', 'returned', 'checked', 'reserved', 'approved'];
export const canAddToBatch = (status: string) => (BATCHABLE_STATUSES as readonly string[]).includes(status);
/** A paid receipt stays in its batch, so the batch keeps a true record of what was paid together. */
export const canRemoveFromBatch = (status: string) => status !== 'paid';

/** Who may open the batch pages: those who make batches and those who act on the receipts in them. */
export const BATCH_VIEW_PERMISSIONS = ['batch.manage', 'review.check', 'review.decide', 'payment.mark'] as const;
export const canViewBatches = (perms: ReadonlySet<string> | ((code: string) => boolean)) =>
  BATCH_VIEW_PERMISSIONS.some((p) => (typeof perms === 'function' ? perms(p) : perms.has(p)));

/** The steps a batch can be worked on at once, and the permission each needs. */
export const BATCH_ACTIONS = ['check', 'approve'] as const;
export type BatchAction = (typeof BATCH_ACTIONS)[number];
export const BATCH_ACTION_PERMISSION: Record<BatchAction | 'pay', string> = { check: 'review.check', approve: 'review.decide', pay: 'payment.mark' };

const batchName = z.string().trim().max(80, 'Keep the name under 80 characters.');
const ids = z.array(z.number().int().positive().max(2_147_483_647)).min(1, 'Choose at least one receipt.').max(BATCH_MAX, `A batch holds up to ${BATCH_MAX} receipts.`);

export const batchCreateSchema = z.object({
  name: batchName.optional().transform((v) => v || null),
  receiptIds: ids.optional(),
});
export const batchUpdateSchema = z.object({
  name: batchName.optional().transform((v) => (v === undefined ? undefined : v || null)),
  closed: z.boolean().optional(),
}).refine((d) => d.name !== undefined || d.closed !== undefined, 'Nothing to change.');
export const batchAddSchema = z.object({ receiptIds: ids });
export const batchActionSchema = z.object({
  action: z.enum(BATCH_ACTIONS),
  note: z.string().trim().max(1000).optional(),
});
/** Paying a batch: one date, method and proof for every receipt, one payment per person. */
export const batchPaySchema = paymentRequestSchema.extend({
  lines: z.array(paymentLineSchema).min(1, 'Choose at least one receipt.').max(BATCH_MAX, `Pay up to ${BATCH_MAX} receipts at a time.`),
});

export const batchListQuerySchema = z.object({
  state: z.enum(['open', 'closed', 'all']).default('open'),
  q: z.string().trim().max(60).optional(),
});

/** "B-2026-000004" or "B-2026-000004 · Pasig week 3". */
export const batchLabel = (b: { code: string; name: string | null }) => (b.name ? `${b.code} · ${b.name}` : b.code);

const PAST: Record<BatchAction, string> = { check: 'checked', approve: 'approved' };
/** "3 receipts were approved" / "1 receipt was checked". */
export const batchDoneText = (action: BatchAction, n: number) => `${n} receipt${n === 1 ? ' was' : 's were'} ${PAST[action]}`;

export type BatchStep = BatchAction | 'pay';
export const BATCH_STEP_LABEL: Record<BatchStep, string> = { check: 'to check', approve: 'to decide', pay: 'to pay' };
/** "3 to check · 2 to pay": what is waiting for this person in a batch. Empty when nothing is. */
export const batchWaitingText = (w: Partial<Record<BatchStep, number>>) =>
  (Object.entries(w) as [BatchStep, number][]).filter(([, n]) => n > 0).map(([s, n]) => `${n} ${BATCH_STEP_LABEL[s]}`).join(' · ');

/** A Med Ref choosing the batch their own receipt belongs to (null = no batch). A draft keeps the choice and joins when submitted. */
export const batchChoiceSchema = z.object({ batchId: z.number().int().positive().max(2_147_483_647).nullable() });
