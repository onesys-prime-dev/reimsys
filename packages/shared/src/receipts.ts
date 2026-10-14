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

const money = (label: string) =>
  z.coerce.number({ invalid_type_error: `Enter a valid ${label}.` }).min(0, `The ${label} cannot be negative.`).max(9_999_999.99, 'That amount is too large.').transform((n) => Math.round(n * 100) / 100);
const optional = <T extends z.ZodTypeAny>(t: T) => z.preprocess((v) => (v === '' || v === undefined ? null : v), t.nullish());
const flag = z.preprocess((v) => (v === 'true' || v === 'yes' ? true : v === 'false' || v === 'no' ? false : v), z.boolean({ invalid_type_error: 'Choose Yes or No.', required_error: 'Choose Yes or No.' }));

export const TRANSACTION_TYPES = ['product', 'service'] as const;
export const VAT_TYPES = ['vatable', 'non_vatable'] as const;
export const TRANSACTION_LABEL: Record<(typeof TRANSACTION_TYPES)[number], string> = { product: 'Product', service: 'Service' };
export const VAT_LABEL: Record<(typeof VAT_TYPES)[number], string> = { vatable: 'Vatable', non_vatable: 'Non-vatable' };

/** The client's reimbursement form. What is required depends on the answers, so it is checked as a whole. */
export const receiptInputSchema = z.object({
  birInvoice: flag,
  seenCompany: optional(z.boolean()),
  seenTin: optional(z.boolean()),
  seenAddress: optional(z.boolean()),
  noBirReason: optional(z.string().trim().max(500)),
  receiptDate: dateString.refine((s) => s <= new Date(Date.now() + 86_400_000).toISOString().slice(0, 10), 'The invoice date cannot be in the future.'),
  invoiceNo: optional(z.string().trim().max(60)),
  payee: z.string().trim().min(2, 'Enter the vendor name.').max(160),
  vendorAddress: optional(z.string().trim().max(300)),
  vendorTin: optional(z.string().trim().max(30)),
  amount: z.coerce.number({ invalid_type_error: 'Enter a valid amount.' }).positive('Enter an amount greater than zero.').max(9_999_999.99, 'That amount is too large.').transform((n) => Math.round(n * 100) / 100),
  transactionType: z.enum(TRANSACTION_TYPES, { errorMap: () => ({ message: 'Choose Product or Service.' }) }),
  vatType: optional(z.enum(VAT_TYPES)),
  vatableAmount: optional(money('vatable amount')),
  vatAmount: optional(money('VAT amount')),
  withheld: optional(flag),
  whtRate: optional(money('withholding rate').refine((n) => n <= 100, 'The rate cannot be over 100.')),
  whtAmount: optional(money('withholding amount')),
  description: z.string().trim().max(500).nullish(),
}).superRefine((d, ctx) => {
  const need = (ok: unknown, path: string, message: string) => { if (!ok) ctx.addIssue({ code: 'custom', path: [path], message }); };
  const missing = (v: unknown, path: string, message: string) => { if (v === null || v === undefined) ctx.addIssue({ code: 'custom', path: [path], message }); };
  if (d.birInvoice) {
    need(d.seenCompany, 'seenCompany', 'Tick to confirm the company name can be seen completely on the invoice.');
    need(d.seenTin, 'seenTin', 'Tick to confirm the TIN can be seen completely on the invoice.');
    need(d.seenAddress, 'seenAddress', 'Tick to confirm the complete address can be seen on the invoice.');
    need(d.invoiceNo, 'invoiceNo', 'Enter the invoice number.');
    need(d.vendorAddress, 'vendorAddress', 'Enter the vendor address.');
    need(d.vendorTin, 'vendorTin', 'Enter the vendor TIN.');
    need(d.vatType, 'vatType', 'Choose Vatable or Non-vatable.');
    missing(d.vatableAmount, 'vatableAmount', 'Enter the vatable amount.');
    missing(d.vatAmount, 'vatAmount', 'Enter the VAT amount, or 0 if there is none.');
    missing(d.withheld, 'withheld', 'Choose Yes or No.');
    if (d.withheld) {
      missing(d.whtRate, 'whtRate', 'Enter the withholding tax rate.');
      missing(d.whtAmount, 'whtAmount', 'Enter the withholding tax amount.');
    }
  } else if (!d.noBirReason || d.noBirReason.length < 5) {
    ctx.addIssue({ code: 'custom', path: ['noBirReason'], message: 'Explain why there is no BIR-registered invoice.' });
  }
});
export type ReceiptInput = z.infer<typeof receiptInputSchema>;

export const actionBodySchema = z.object({
  note: z.string().trim().max(1000).optional(),
  /** The Checker's answer to "can it be seen completely on the invoice?" for the company name, TIN and address. */
  seen: z.object({ company: z.boolean(), tin: z.boolean(), address: z.boolean() }).optional(),
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
  transactionType: z.enum(TRANSACTION_TYPES).nullish(),
  encoderId: z.number().int().positive().nullish(),
  format: z.enum(['pdf', 'xlsx', 'csv']),
});

export const listQuerySchema = z.object({
  status: z.enum(RECEIPT_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  transactionType: z.enum(TRANSACTION_TYPES).optional(),
  vatType: z.enum(VAT_TYPES).optional(),
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

/* ---------- warnings (never block, only flag) ---------- */
export const TIN_PATTERN = /^\d{3}-?\d{3}-?\d{3}(-?\d{3,5})?$/;
export const VAT_RATE = 12;

export interface FormFigures {
  birInvoice?: boolean | null; amount: number; vendorTin?: string | null; vatType?: string | null;
  vatableAmount?: number | null; vatAmount?: number | null; withheld?: boolean | null; whtRate?: number | null; whtAmount?: number | null;
}
const close = (a: number, b: number) => Math.abs(a - b) <= 0.02;

/** Things worth a second look. The Med Ref sees them while typing; the Checker and Approver see them on the receipt. */
export function receiptWarnings(f: FormFigures): string[] {
  const out: string[] = [];
  const n = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
  const vatable = n(f.vatableAmount), vat = n(f.vatAmount), rate = n(f.whtRate), wht = n(f.whtAmount);
  if (f.vendorTin && !TIN_PATTERN.test(f.vendorTin.trim())) out.push('The vendor TIN does not look right. It is usually written 000-000-000-00000.');
  if (f.birInvoice === false) return out;
  if (f.vatType === 'vatable' && vatable !== null && vat !== null) {
    if (!close(vatable + vat, f.amount)) out.push(`Vatable amount plus VAT (${(vatable + vat).toFixed(2)}) is not the same as the invoice gross amount (${f.amount.toFixed(2)}).`);
    if (!close(vatable * (VAT_RATE / 100), vat)) out.push(`VAT is usually ${VAT_RATE}% of the vatable amount (${(vatable * VAT_RATE / 100).toFixed(2)}), but ${vat.toFixed(2)} was entered.`);
  }
  if (f.vatType === 'non_vatable' && vat !== null && vat !== 0) out.push('The invoice is marked non-vatable, but a VAT amount was entered.');
  if (f.vatType === 'non_vatable' && vatable !== null && !close(vatable, f.amount)) out.push('For a non-vatable invoice the amount without VAT is usually the same as the gross amount.');
  if (f.withheld && rate !== null && wht !== null) {
    const base = vatable ?? f.amount;
    if (!close(base * rate / 100, wht)) out.push(`${rate}% of ${base.toFixed(2)} is ${(base * rate / 100).toFixed(2)}, but a withholding amount of ${wht.toFixed(2)} was entered.`);
  }
  if (f.withheld === false && ((wht ?? 0) > 0 || (rate ?? 0) > 0)) out.push('Withholding tax was answered No, but a rate or amount was entered.');
  return out;
}

/** The fields the form saves, cleaned so that answers that no longer apply are not kept. */
export function cleanFormData(d: ReceiptInput) {
  const bir = d.birInvoice;
  const wht = bir && d.withheld === true;
  const t = (v: string | null | undefined) => (v ? v : null);
  return {
    birInvoice: bir,
    seenCompany: bir ? !!d.seenCompany : null, seenTin: bir ? !!d.seenTin : null, seenAddress: bir ? !!d.seenAddress : null,
    noBirReason: bir ? null : t(d.noBirReason),
    invoiceNo: t(d.invoiceNo), vendorAddress: t(d.vendorAddress), vendorTin: t(d.vendorTin),
    transactionType: d.transactionType,
    vatType: bir ? d.vatType ?? null : null,
    vatableAmount: bir ? d.vatableAmount ?? null : null,
    vatAmount: bir ? d.vatAmount ?? null : null,
    withheld: bir ? d.withheld ?? null : null,
    whtRate: wht ? d.whtRate ?? null : null,
    whtAmount: wht ? d.whtAmount ?? null : null,
  };
}
