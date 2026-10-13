import type { Prisma } from '@prisma/client';
import { availableActions, canEditReceipt, type ReceiptStatus } from '@reimsis/shared';
import { prisma } from '../db.js';
import { forbidden, notFound } from './errors.js';
import type { AuthContext } from '../types.js';

/** Which receipts this user may see. Driven by permissions, not role names. */
export function visibleWhere(auth: AuthContext): Prisma.ReceiptWhereInput {
  const p = auth.permissions;
  // Drafts stay private to the person who is still writing them. Everything submitted is visible to people who can see all.
  if (p.has('receipt.view_all')) return { OR: [{ status: { not: 'draft' } }, { encoderId: auth.user.id }] };
  const ors: Prisma.ReceiptWhereInput[] = [];
  if (p.has('receipt.create')) ors.push({ encoderId: auth.user.id });
  if (p.has('review.decide')) ors.push({ status: { in: ['checked', 'reserved', 'approved', 'disapproved'] } });
  return ors.length ? { OR: ors } : { id: -1 };
}

export const receiptInclude = {
  category: true,
  encoder: { select: { id: true, name: true } },
  document: true,
} satisfies Prisma.ReceiptInclude;

type ReceiptRow = Prisma.ReceiptGetPayload<{ include: typeof receiptInclude }>;

export const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

export function receiptBrief(r: ReceiptRow) {
  return {
    id: r.id,
    refNo: r.refNo,
    status: r.status as ReceiptStatus,
    version: r.version,
    payee: r.payee,
    receiptDate: dateOnly(r.receiptDate),
    amount: Number(r.amount),
    category: { id: r.category.id, name: r.category.name },
    encoder: r.encoder,
    submittedAt: r.submittedAt,
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
  return {
    ...receiptBrief(r),
    description: r.description,
    checkedBy: name(r.checkedById), checkedAt: r.checkedAt, checkNote: r.checkNote,
    decidedBy: name(r.decidedById), decidedAt: r.decidedAt, decisionNote: r.decisionNote,
    lastNote: r.lastNote,
    createdAt: r.createdAt,
    isOwner,
    canEdit: isOwner && auth.permissions.has('receipt.create') && canEditReceipt(status),
    actions: availableActions(status, auth.permissions, isOwner).map((t) => ({ action: t.action, note: t.note })),
    evidence: evidence.map((e) => ({ id: e.id, fileName: e.fileName, mime: e.mime, size: e.size, createdAt: e.createdAt })),
    document: r.document ? { id: r.document.id, docNo: r.document.docNo, status: r.document.status } : null,
    canCopy: isOwner && status === 'disapproved',
  };
}

export const assertOwner = (auth: AuthContext, r: { encoderId: number }) => {
  if (r.encoderId !== auth.user.id) throw forbidden('Only the person who encoded this receipt can do that.');
};

/** Shared list filters used by the list, export and report endpoints. */
export function filterWhere(q: { status?: string; q?: string; categoryId?: number; encoderId?: number; from?: string; to?: string }): Prisma.ReceiptWhereInput {
  const w: Prisma.ReceiptWhereInput = {};
  if (q.status) w.status = q.status;
  if (q.categoryId) w.categoryId = q.categoryId;
  if (q.encoderId) w.encoderId = q.encoderId;
  if (q.from || q.to) {
    w.receiptDate = {};
    if (q.from) w.receiptDate.gte = new Date(q.from + 'T00:00:00Z');
    if (q.to) w.receiptDate.lte = new Date(q.to + 'T00:00:00Z');
  }
  if (q.q) w.OR = [{ payee: { contains: q.q } }, { refNo: { contains: q.q } }, { description: { contains: q.q } }, { encoder: { name: { contains: q.q } } }];
  return w;
}
