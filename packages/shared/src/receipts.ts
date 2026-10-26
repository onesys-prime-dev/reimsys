import { z } from 'zod';
import { DEFAULT_SETTINGS, type AppSettings } from './settings';
import { RETURN_ISSUE_CODES } from './returnIssues';
import { formatTin, isCompleteTin, vatChecks } from './tax';
export const RECEIPT_STATUSES = ['draft', 'submitted', 'returned', 'checked', 'approved', 'disapproved', 'reserved', 'paid'] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

export const STATUS_LABEL: Record<ReceiptStatus, string> = {
  draft: 'Draft', submitted: 'Submitted', returned: 'Returned', checked: 'Checked',
  approved: 'Approved', disapproved: 'Disapproved', reserved: 'Reserved', paid: 'Paid',
};

export type ReceiptAction = 'submit' | 'withdraw' | 'check' | 'return' | 'approve' | 'disapprove' | 'reserve' | 'release' | 'undo' | 'request' | 'pay' | 'reverse_payment';
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
  /** Paying is done from the payment form (it needs a date, method, proof and amounts), so the API has no plain /pay action route. */
  { action: 'pay', from: ['approved'], to: 'paid', permission: 'payment.mark', note: 'none', notOwner: true },
  { action: 'reverse_payment', from: ['paid'], to: 'approved', permission: 'payment.mark', note: 'required', notOwner: true },
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
/** In the same order and words as the client's form. "Other" comes with the person's own words. */
export const CLASSIFICATIONS = ['fuel', 'meeting', 'representation', 'transportation', 'parking', 'printing', 'meal', 'other'] as const;
export const CLASSIFICATION_LABEL: Record<(typeof CLASSIFICATIONS)[number], string> = {
  fuel: 'Fuel', meeting: 'Meeting, Seminar, or Convention', representation: 'Representation', transportation: 'Transportation',
  parking: 'Parking', printing: 'Printing or Photocopying', meal: 'Meal', other: 'Other',
};
/** The classification as people read it: the label, or "Other: what they wrote". */
export const classificationText = (c: string | null | undefined, other?: string | null) =>
  !c ? '' : c === 'other' && other ? `Other: ${other}` : CLASSIFICATION_LABEL[c as keyof typeof CLASSIFICATION_LABEL] ?? c;
export const VAT_LABEL: Record<(typeof VAT_TYPES)[number], string> = { vatable: 'Vatable', non_vatable: 'Non-vatable' };

/** The client's reimbursement form. What is required depends on the answers, so it is checked as a whole. */
const receiptShape = z.object({
  birInvoice: flag,
  invoiceUnderCompany: optional(flag),
  reasonForSpending: optional(z.string().trim().max(300)),
  classification: optional(z.enum(CLASSIFICATIONS)),
  classificationOther: optional(z.string().trim().max(100)),
  seenCompany: optional(z.boolean()),
  seenTin: optional(z.boolean()),
  seenAddress: optional(z.boolean()),
  noBirReason: optional(z.string().trim().max(500)),
  receiptDate: dateString.refine((s) => s <= new Date(Date.now() + 86_400_000).toISOString().slice(0, 10), 'The invoice date cannot be in the future.'),
  invoiceNo: optional(z.string().trim().max(60)),
  payee: z.string().trim().min(2, 'Enter the vendor name.').max(160),
  vendorAddress: optional(z.string().trim().max(300)),
  vendorTin: optional(z.string().trim().max(30).transform(formatTin).refine((s) => s === '' || isCompleteTin(s), 'Enter the complete TIN: 14 digits, written 000-000-000-00000.').transform((s) => s || null)),
  amount: z.coerce.number({ invalid_type_error: 'Enter a valid amount.' }).positive('Enter an amount greater than zero.').max(9_999_999.99, 'That amount is too large.').transform((n) => Math.round(n * 100) / 100),
  transactionType: optional(z.enum(TRANSACTION_TYPES, { errorMap: () => ({ message: 'Choose Product or Service.' }) })),
  vatType: optional(z.enum(VAT_TYPES)),
  vatableAmount: optional(money('vatable amount')),
  vatAmount: optional(money('VAT amount')),
  withheld: optional(flag),
  whtRate: optional(money('withholding rate').refine((n) => n <= 100, 'The rate cannot be over 100.')),
  whtAmount: optional(money('withholding amount')),
  description: z.string().trim().max(500).nullish(),
});

/** What the "it depends on the answers" rules look at. Every field may be missing. */
interface Answers {
  birInvoice?: boolean | null; invoiceUnderCompany?: boolean | null; reasonForSpending?: string | null; classification?: string | null; classificationOther?: string | null; transactionType?: string | null; seenCompany?: boolean | null; seenTin?: boolean | null; seenAddress?: boolean | null; noBirReason?: string | null;
  invoiceNo?: string | null; vendorAddress?: string | null; vendorTin?: string | null; vatType?: string | null;
  vatableAmount?: number | null; vatAmount?: number | null; withheld?: boolean | null; whtRate?: number | null; whtAmount?: number | null;
}
const needsReason = (d: Answers, rules: AppSettings) => d.birInvoice === false || (d.birInvoice === true && !(rules.askWithholding && d.withheld === true));

function conditionalIssues(d: Answers, rules: AppSettings): { path: string; message: string }[] {
  const out: { path: string; message: string }[] = [];
  const need = (ok: unknown, path: string, message: string) => { if (!ok) out.push({ path, message }); };
  const missing = (v: unknown, path: string, message: string) => { if (v === null || v === undefined) out.push({ path, message }); };
  if (d.birInvoice === true) {
    missing(d.invoiceUnderCompany, 'invoiceUnderCompany', 'Choose Yes or No.');
    if (d.invoiceUnderCompany === true) {
      need(d.seenCompany, 'seenCompany', 'Tick to confirm the company name can be seen completely on the invoice.');
      need(d.seenTin, 'seenTin', 'Tick to confirm the TIN can be seen completely on the invoice.');
      need(d.seenAddress, 'seenAddress', 'Tick to confirm the complete address can be seen on the invoice.');
    }
    need(d.transactionType, 'transactionType', 'Choose Product or Service.');
    if (rules.requireInvoiceNo) need(d.invoiceNo, 'invoiceNo', 'Enter the invoice number.');
    if (rules.requireVendorAddress) need(d.vendorAddress, 'vendorAddress', 'Enter the vendor address.');
    if (rules.requireVendorTin) need(d.vendorTin, 'vendorTin', 'Enter the vendor TIN.');
    need(d.vatType, 'vatType', 'Choose Vatable or Non-vatable.');
    missing(d.vatableAmount, 'vatableAmount', 'Enter the vatable amount.');
    missing(d.vatAmount, 'vatAmount', 'Enter the VAT amount, or 0 if there is none.');
    if (rules.askWithholding) missing(d.withheld, 'withheld', 'Choose Yes or No.');
    if (d.withheld && rules.askWithholding) {
      missing(d.whtRate, 'whtRate', 'Enter the withholding tax rate.');
      missing(d.whtAmount, 'whtAmount', 'Enter the withholding tax amount.');
    }
  } else if (d.birInvoice === false && !rules.allowNoBir) {
    out.push({ path: 'birInvoice', message: 'Receipts without a BIR-registered invoice are not accepted.' });
  } else if (d.birInvoice === false) {
    need(d.vendorAddress, 'vendorAddress', 'Enter the vendor address.');
  }
  // The reason and classification are asked on every path except when tax was withheld, which finishes right after that step.
  if (needsReason(d, rules)) {
    need((d.reasonForSpending ?? '').length >= 3, 'reasonForSpending', 'Write the specific reason for spending.');
    need(d.classification, 'classification', 'Choose a classification.');
    if (d.classification === 'other') need((d.classificationOther ?? '').length >= 2, 'classificationOther', 'Write what the other classification is.');
  }
  return out;
}

/** The form's rules with the administrator's settings applied. */
export const makeReceiptSchema = (rules: AppSettings = DEFAULT_SETTINGS) =>
  receiptShape.superRefine((d, ctx) => {
    for (const i of conditionalIssues(d, rules)) ctx.addIssue({ code: 'custom', path: [i.path], message: i.message });
  });
export const receiptInputSchema = makeReceiptSchema();

/**
 * Every problem in the form, by field, even when several things are wrong at once. (A schema stops at the first kind of
 * mistake, which would hide the "tick this box" messages behind an empty vendor name.)
 */
export function receiptProblems(raw: Record<string, unknown>, rules: AppSettings = DEFAULT_SETTINGS): Record<string, string> {
  const out: Record<string, string> = {};
  const r = receiptShape.safeParse(raw);
  if (!r.success) for (const i of r.error.issues) out[String(i.path[0])] ||= i.message;
  const n = (v: unknown) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));
  const b = (v: unknown) => (v === true || v === 'yes' || v === 'true' ? true : v === false || v === 'no' || v === 'false' ? false : null);
  const t = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  for (const i of conditionalIssues({
    birInvoice: b(raw.birInvoice), invoiceUnderCompany: b(raw.invoiceUnderCompany), reasonForSpending: t(raw.reasonForSpending), classification: t(raw.classification), classificationOther: t(raw.classificationOther), transactionType: t(raw.transactionType), seenCompany: raw.seenCompany === true, seenTin: raw.seenTin === true, seenAddress: raw.seenAddress === true, noBirReason: t(raw.noBirReason),
    invoiceNo: t(raw.invoiceNo), vendorAddress: t(raw.vendorAddress), vendorTin: t(raw.vendorTin), vatType: t(raw.vatType),
    vatableAmount: n(raw.vatableAmount), vatAmount: n(raw.vatAmount), withheld: b(raw.withheld), whtRate: n(raw.whtRate), whtAmount: n(raw.whtAmount),
  }, rules)) out[i.path] ||= i.message;
  return out;
}
export type ReceiptInput = z.infer<typeof receiptInputSchema>;

export const actionBodySchema = z.object({
  note: z.string().trim().max(1000).optional(),
  /** The problems the Checker or Approver ticked when sending a receipt back to the Med Ref. */
  issues: z.array(z.enum(RETURN_ISSUE_CODES)).max(10).optional(),
  /** The Checker's answer to "can it be seen completely on the invoice?" for the company name, TIN and address. */
  seen: z.object({ company: z.boolean(), tin: z.boolean(), address: z.boolean() }).optional(),
  version: z.number().int().min(0),
});

export const categorySchema = z.object({
  name: z.string().trim().min(2).max(80),
  isActive: z.boolean().optional(),
});

export const PAYMENT_FILTERS = ['all', 'paid', 'unpaid'] as const;
export type PaymentFilter = (typeof PAYMENT_FILTERS)[number];
export const PAYMENT_FILTER_LABEL: Record<PaymentFilter, string> = { all: 'Paid and not yet paid', paid: 'Paid', unpaid: 'Not yet paid' };

export const reportRequestSchema = z.object({
  from: dateString,
  to: dateString,
  categoryId: z.number().int().positive().nullish(),
  transactionType: z.enum(TRANSACTION_TYPES).nullish(),
  encoderId: z.number().int().positive().nullish(),
  payment: z.enum(PAYMENT_FILTERS).default('all'),
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
export const VAT_RATE = DEFAULT_SETTINGS.vatRate;

export interface FormFigures {
  birInvoice?: boolean | null; amount: number; vendorTin?: string | null; vatType?: string | null;
  vatableAmount?: number | null; vatAmount?: number | null; withheld?: boolean | null; whtRate?: number | null; whtAmount?: number | null;
}

/** Things worth a second look, as plain sentences. The Checker and Approver see them on the receipt. See vatChecks for the same checks with a level. */
export function receiptWarnings(f: FormFigures, rules: AppSettings = DEFAULT_SETTINGS): string[] {
  const out: string[] = [];
  if (f.vendorTin && !isCompleteTin(f.vendorTin.trim())) out.push('The vendor TIN does not look right. It is usually written 000-000-000-00000.');
  if (f.birInvoice === false) return out;
  const n = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
  for (const c of vatChecks(f, rules)) out.push(c.message);
  if (f.withheld === false && ((n(f.whtAmount) ?? 0) > 0 || (n(f.whtRate) ?? 0) > 0)) out.push('Tax withheld was answered No, but a rate or amount was entered.');
  return out;
}

/** The fields the form saves, cleaned so that answers that no longer apply are not kept. */
export function cleanFormData(d: ReceiptInput, rules: AppSettings = DEFAULT_SETTINGS) {
  const bir = d.birInvoice;
  const under = bir && d.invoiceUnderCompany === true;
  const wht = bir && rules.askWithholding && d.withheld === true;
  const t = (v: string | null | undefined) => (v ? v : null);
  const reason = needsReason({ birInvoice: bir, withheld: d.withheld }, rules);
  return {
    birInvoice: bir,
    invoiceUnderCompany: bir ? d.invoiceUnderCompany ?? null : null,
    seenCompany: under ? !!d.seenCompany : null, seenTin: under ? !!d.seenTin : null, seenAddress: under ? !!d.seenAddress : null,
    noBirReason: null,
    invoiceNo: bir ? t(d.invoiceNo) : null, vendorAddress: t(d.vendorAddress), vendorTin: bir ? t(d.vendorTin) : null,
    transactionType: bir ? d.transactionType ?? null : null,
    reasonForSpending: reason ? t(d.reasonForSpending) : null,
    classification: reason ? d.classification ?? null : null,
    classificationOther: reason && d.classification === 'other' ? t(d.classificationOther) : null,
    vatType: bir ? d.vatType ?? null : null,
    vatableAmount: bir ? d.vatableAmount ?? null : null,
    vatAmount: bir ? d.vatAmount ?? null : null,
    withheld: bir ? (rules.askWithholding ? d.withheld ?? null : false) : null,
    whtRate: wht ? d.whtRate ?? null : null,
    whtAmount: wht ? d.whtAmount ?? null : null,
  };
}

/** The company the invoices must be addressed to. The Med Ref confirms these can be seen completely on the invoice. */
export const companySchema = z.object({
  name: z.string().trim().min(2, 'Enter the company name.').max(160),
  tin: z.string().trim().min(5, 'Enter the company TIN.').max(30),
  address: z.string().trim().min(5, 'Enter the company address.').max(300),
});
export type Company = z.infer<typeof companySchema>;
export const DEFAULT_COMPANY: Company = {
  name: 'SOLARA PHARMA CORP.', tin: '801-590-238-00000', address: 'U-1704 Empire Tower AIC Burgandy Bldg. ADB Ave. Ortigas Center, San Antonio, Pasig City',
};
