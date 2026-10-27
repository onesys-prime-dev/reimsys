import type { Prisma } from '@prisma/client';
import { availableActions, canEditReceipt, receiptWarnings, taxImpact, incompleteReasons, parseIssues, TRANSACTION_LABEL, CLASSIFICATION_LABEL, type ReceiptStatus } from '@reimsys/shared';
import { prisma } from '../db.js';
import { forbidden, notFound } from './errors.js';
import { getSettings } from './appSettings.js';
import type { AuthContext } from '../types.js';

/** Which receipts this user may see. Driven by permissions, not role names. */
export function visibleWhere(auth: AuthContext): Prisma.ReceiptWhereInput {
  const p = auth.permissions;
  // Drafts stay private to the person who is still writing them. Everything submitted is visible to people who can see all.
  if (p.has('receipt.view_all')) return { OR: [{ status: { not: 'draft' } }, { encoderId: auth.user.id }] };
  const ors: Prisma.ReceiptWhereInput[] = [];
  if (p.has('receipt.create')) ors.push({ encoderId: auth.user.id });
  if (p.has('review.decide')) ors.push({ status: { in: ['checked', 'reserved', 'approved', 'disapproved', 'paid'] } });
  // Accounting sees what is waiting to be paid and what was paid, nothing earlier in the workflow.
  if (p.has('payment.mark')) ors.push({ status: { in: ['approved', 'paid'] } });
  return ors.length ? { OR: ors } : { id: -1 };
}

export const receiptInclude = {
  category: true,
  encoder: { select: { id: true, name: true } },
  document: true,
  chargeLocation: { select: { id: true, name: true } },
  payment: { include: { recordedBy: { select: { id: true, name: true } } } },
} satisfies Prisma.ReceiptInclude;

type ReceiptRow = Prisma.ReceiptGetPayload<{ include: typeof receiptInclude }>;

export const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
/** What the receipt is, for lists, emails and reports: Product or Service, or the old category on receipts made before the form changed. */
export const typeLabel = (r: { transactionType: string | null; classification?: string | null; category: { name: string } | null }) =>
  r.transactionType ? TRANSACTION_LABEL[r.transactionType as keyof typeof TRANSACTION_LABEL] ?? r.transactionType
    : r.classification ? CLASSIFICATION_LABEL[r.classification as keyof typeof CLASSIFICATION_LABEL] ?? r.classification
    : r.category?.name ?? '';
const dec = (v: { toString(): string } | null) => (v === null ? null : Number(v));

/** The answers on the client's reimbursement form, in the shape the screens use. Old receipts have these empty. */
export function receiptForm(r: ReceiptRow) {
  return {
    birInvoice: r.birInvoice, invoiceUnderCompany: r.invoiceUnderCompany, reasonForSpending: r.reasonForSpending, classification: r.classification, classificationOther: r.classificationOther, seenCompany: r.seenCompany, seenTin: r.seenTin, seenAddress: r.seenAddress, noBirReason: r.noBirReason,
    invoiceNo: r.invoiceNo, vendorAddress: r.vendorAddress, vendorTin: r.vendorTin, transactionType: r.transactionType,
    vatType: r.vatType, vatableAmount: dec(r.vatableAmount), vatAmount: dec(r.vatAmount), vatExemptAmount: dec(r.vatExemptAmount), discountAmount: dec(r.discountAmount),
    chargeLocation: r.chargeLocation, detailsReviewed: r.detailsReviewed,
    withheld: r.withheld, whtRate: dec(r.whtRate), whtAmount: dec(r.whtAmount),
    checked: r.ckCompany === null && r.ckTin === null && r.ckAddress === null ? null : { company: r.ckCompany, tin: r.ckTin, address: r.ckAddress },
  };
}

export function receiptBrief(r: ReceiptRow) {
  return {
    id: r.id,
    refNo: r.refNo,
    status: r.status as ReceiptStatus,
    version: r.version,
    payee: r.payee,
    receiptDate: dateOnly(r.receiptDate),
    amount: Number(r.amount),
    invoiceNo: r.invoiceNo,
    transactionType: r.transactionType,
    birInvoice: r.birInvoice,
    category: r.category ? { id: r.category.id, name: r.category.name } : null,
    encoder: r.encoder,
    submittedAt: r.submittedAt,
    checkedAt: r.checkedAt,
    updatedAt: r.updatedAt,
    docNo: r.document?.docNo ?? null,
  };
}

export async function loadVisible(auth: AuthContext, id: number) {
  const r = await prisma.receipt.findFirst({ where: { AND: [{ id }, visibleWhere(auth)] }, include: receiptInclude });
  if (!r) throw notFound('Receipt not found.');
  return r;
}

/** Full detail with evidence, names of reviewers, and the actions this user may take right now. */
export async function receiptDetail(auth: AuthContext, r: ReceiptRow) {
  const evidence = await prisma.receiptEvidence.findMany({ where: { receiptId: r.id, deletedAt: null }, orderBy: { id: 'asc' } });
  const ids = [r.checkedById, r.decidedById].filter((x): x is number => !!x);
  const people = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const name = (id: number | null) => people.find((p) => p.id === id)?.name ?? null;
  const isOwner = r.encoderId === auth.user.id;
  const status = r.status as ReceiptStatus;
  // The same invoice (vendor TIN + invoice no.), or the same vendor, amount and date, as another receipt this person can see: worth a second look before paying twice.
  const sameInvoice: Prisma.ReceiptWhereInput[] = r.vendorTin && r.invoiceNo ? [{ vendorTin: r.vendorTin, invoiceNo: r.invoiceNo }] : [];
  const dupes = await prisma.receipt.findMany({
    where: { AND: [visibleWhere(auth), { id: { not: r.id }, status: { not: 'disapproved' }, OR: [...sameInvoice, { payee: r.payee, amount: r.amount, receiptDate: r.receiptDate }] }] },
    select: { id: true, refNo: true, status: true, encoder: { select: { name: true } } }, orderBy: { id: 'desc' }, take: 3,
  });
  return {
    ...receiptBrief(r),
    description: r.description,
    form: receiptForm(r),
    warnings: receiptWarnings({ birInvoice: r.birInvoice, amount: Number(r.amount), vendorTin: r.vendorTin, vatType: r.vatType, vatableAmount: dec(r.vatableAmount), vatAmount: dec(r.vatAmount), vatExemptAmount: dec(r.vatExemptAmount), withheld: r.withheld, whtRate: dec(r.whtRate), whtAmount: dec(r.whtAmount) }, getSettings()),
    impact: taxImpact({ birInvoice: r.birInvoice, amount: Number(r.amount), vatableAmount: dec(r.vatableAmount), vatAmount: dec(r.vatAmount), vatExemptAmount: dec(r.vatExemptAmount), withheld: r.withheld, whtRate: dec(r.whtRate) }, getSettings()),
    incompleteReasons: incompleteReasons({ birInvoice: r.birInvoice, invoiceNo: r.invoiceNo, vendorAddress: r.vendorAddress, vendorTin: r.vendorTin, vatType: r.vatType, vatableAmount: dec(r.vatableAmount), vatAmount: dec(r.vatAmount), withheld: r.withheld }, getSettings()),
    checkedBy: name(r.checkedById), checkedAt: r.checkedAt, checkNote: r.checkNote,
    decidedBy: name(r.decidedById), decidedAt: r.decidedAt, decisionNote: r.decisionNote,
    lastNote: r.lastNote,
    returnIssues: parseIssues(r.returnIssues),
    createdAt: r.createdAt,
    isOwner,
    canEdit: isOwner && auth.permissions.has('receipt.create') && canEditReceipt(status),
    actions: availableActions(status, auth.permissions, isOwner).filter((t) => t.action !== 'undo' || (r.decidedById === auth.user.id && !!r.decidedAt && Date.now() - r.decidedAt.getTime() <= getSettings().undoMinutes * 60_000)).map((t) => ({ action: t.action, note: t.note })),
    evidence: evidence.map((e) => ({ id: e.id, fileName: e.fileName, mime: e.mime, size: e.size, createdAt: e.createdAt })),
    document: r.document ? { id: r.document.id, docNo: r.document.docNo, status: r.document.status } : null,
    payment: r.payment ? {
      id: r.payment.id, paymentNo: r.payment.paymentNo, method: r.payment.method, paidOn: dateOnly(r.payment.paidOn),
      amount: dec(r.paidAmount) ?? 0, shortReason: r.paidShortReason, recordedBy: r.payment.recordedBy.name, recordedAt: r.paidAt,
      proof: { mime: r.payment.proofMime, size: r.payment.proofSize },
    } : null,
    canCopy: isOwner && status === 'disapproved',
    undoUntil: r.decidedById === auth.user.id && r.decidedAt && (status === 'approved' || status === 'disapproved') ? new Date(r.decidedAt.getTime() + getSettings().undoMinutes * 60_000).toISOString() : null,
    canDelete: isOwner && auth.permissions.has('receipt.create') && status === 'draft',
    possibleDuplicates: dupes.map((d) => ({ id: d.id, refNo: d.refNo, status: d.status as ReceiptStatus, encoder: d.encoder.name })),
  };
}

export const assertOwner = (auth: AuthContext, r: { encoderId: number }) => {
  if (r.encoderId !== auth.user.id) throw forbidden('Only the person who encoded this receipt can do that.');
};

/** Shared list filters used by the list, export and report endpoints. */
export function filterWhere(q: { status?: string; q?: string; categoryId?: number; transactionType?: string; vatType?: string; encoderId?: number; from?: string; to?: string }): Prisma.ReceiptWhereInput {
  const w: Prisma.ReceiptWhereInput = {};
  if (q.status) w.status = q.status;
  if (q.categoryId) w.categoryId = q.categoryId;
  if (q.transactionType) w.transactionType = q.transactionType;
  if (q.vatType) w.vatType = q.vatType;
  if (q.encoderId) w.encoderId = q.encoderId;
  if (q.from || q.to) {
    w.receiptDate = {};
    if (q.from) w.receiptDate.gte = new Date(q.from + 'T00:00:00Z');
    if (q.to) w.receiptDate.lte = new Date(q.to + 'T00:00:00Z');
  }
  if (q.q) w.OR = [{ payee: { contains: q.q } }, { refNo: { contains: q.q } }, { description: { contains: q.q } }, { invoiceNo: { contains: q.q } }, { vendorTin: { contains: q.q } }, { encoder: { name: { contains: q.q } } }];
  return w;
}
