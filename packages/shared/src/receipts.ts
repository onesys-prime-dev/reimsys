import { z } from 'zod';
export const RECEIPT_STATUSES = ['draft', 'submitted', 'returned', 'checked', 'approved', 'disapproved', 'reserved'] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

export const STATUS_LABEL: Record<ReceiptStatus, string> = {
  draft: 'Draft', submitted: 'Submitted', returned: 'Returned', checked: 'Checked',
  approved: 'Approved', disapproved: 'Disapproved', reserved: 'Reserved',
};

export type ReceiptAction = 'submit' | 'withdraw' | 'check' | 'return' | 'approve' | 'disapprove' | 'reserve' | 'release' | 'undo' | 'request';
export type NoteRule = 'none' | 'optional' | 'required';

export interface Transition {
  action: ReceiptAction;
  from: ReceiptStatus[];
  to: ReceiptStatus;
  permission: string;
  note: NoteRule;
  /** Only the person who encoded the receipt may do this. */
  owner?: boolean;
  /** Reviewers may not act on receipts they encoded. */
  notOwner?: boolean;
}

/** The single source of truth for status changes. The API enforces it, the UI reads it. */
export const TRANSITIONS: Transition[] = [
  { action: 'submit', from: ['draft', 'returned'], to: 'submitted', permission: 'receipt.create', note: 'none', owner: true },
  { action: 'withdraw', from: ['submitted'], to: 'draft', permission: 'receipt.create', note: 'optional', owner: true },
  { action: 'check', from: ['submitted'], to: 'checked', permission: 'review.check', note: 'optional', notOwner: true },
  { action: 'return', from: ['submitted'], to: 'returned', permission: 'review.check', note: 'required', notOwner: true },
  { action: 'approve', from: ['checked'], to: 'approved', permission: 'review.decide', note: 'optional', notOwner: true },
  { action: 'disapprove', from: ['checked'], to: 'disapproved', permission: 'review.decide', note: 'required', notOwner: true },
  { action: 'reserve', from: ['checked'], to: 'reserved', permission: 'review.decide', note: 'required', notOwner: true },
  { action: 'request', from: ['checked'], to: 'returned', permission: 'review.decide', note: 'required', notOwner: true },
  { action: 'undo', from: ['approved', 'disapproved'], to: 'checked', permission: 'review.decide', note: 'required', notOwner: true },
  { action: 'release', from: ['reserved'], to: 'checked', permission: 'review.decide', note: 'optional', notOwner: true },
];

/** How long the person who decided has to take a decision back. */
export const UNDO_WINDOW_MINUTES = 10;
export const BULK_MAX = 25;

export const transitionFor = (action: string) => TRANSITIONS.find((t) => t.action === action);

export function availableActions(status: ReceiptStatus, perms: ReadonlySet<string>, isOwner: boolean): Transition[] {
  return TRANSITIONS.filter(
    (t) => t.from.includes(status) && perms.has(t.permission) && (!t.owner || isOwner) && (!t.notOwner || !isOwner),
  );
}

export const canEditReceipt = (status: ReceiptStatus) => status === 'draft' || status === 'returned';

/* ---------- validation ---------- */
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date format YYYY-MM-DD.').refine((s) => !Number.isNaN(Date.parse(s)), 'Enter a valid date.');

export const receiptInputSchema = z.object({
  payee: z.string().trim().min(2, 'Enter who was paid.').max(160),
  receiptDate: dateString.refine((s) => s <= new Date(Date.now() + 86_400_000).toISOString().slice(0, 10), 'The receipt date cannot be in the future.'),
  amount: z.coerce.number({ invalid_type_error: 'Enter a valid amount.' }).positive('Enter an amount greater than zero.').max(9_999_999.99, 'That amount is too large.').transform((n) => Math.round(n * 100) / 100),
  categoryId: z.coerce.number().int().positive('Choose a category.'),
  description: z.string().trim().max(500).nullish(),
});
export type ReceiptInput = z.infer<typeof receiptInputSchema>;

export const actionBodySchema = z.object({
  note: z.string().trim().max(1000).optional(),
  version: z.number().int().min(0),
});

export const categorySchema = z.object({
  name: z.string().trim().min(2).max(80),
  isActive: z.boolean().optional(),
});

export const reportRequestSchema = z.object({
  from: dateString,
  to: dateString,
  categoryId: z.number().int().positive().nullish(),
  encoderId: z.number().int().positive().nullish(),
  format: z.enum(['pdf', 'xlsx', 'csv']),
});

export const listQuerySchema = z.object({
  status: z.enum(RECEIPT_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  encoderId: z.coerce.number().int().positive().optional(),
  from: dateString.optional(),
  to: dateString.optional(),
  sort: z.enum(['updated', 'newest', 'oldest', 'amount_high', 'amount_low']).default('updated'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const EVIDENCE_MIME: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'application/pdf': 'pdf',
};
export const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;
export const EVIDENCE_MAX_FILES = 10;

export const peso = (n: number | string) => '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const bulkSchema = z.object({
  action: z.enum(['check', 'approve']),
  ids: z.array(z.number().int().positive()).min(1, 'Select at least one receipt.').max(BULK_MAX, `Select up to ${BULK_MAX} receipts at a time.`),
  note: z.string().trim().max(1000).optional(),
});

export const commentSchema = z.object({ body: z.string().trim().min(1, 'Write a comment first.').max(1000, 'Keep it under 1,000 characters.') });
