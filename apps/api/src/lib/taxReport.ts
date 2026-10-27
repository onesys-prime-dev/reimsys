import type { Prisma } from '@prisma/client';
import { incompleteReasons, round2, taxImpact } from '@reimsys/shared';
import { prisma } from '../db.js';
import { getSettings } from './appSettings.js';
import { visibleWhere } from './receipts.js';
import type { AuthContext } from '../types.js';

const dec = (v: { toString(): string } | null) => (v === null ? null : Number(v));

/** Management sees every employee; a Med Ref sees only their own receipts, which visibleWhere already limits. */
export const seesEveryone = (auth: AuthContext) => {
  const p = auth.permissions;
  return p.has('receipt.view_all') || p.has('review.check') || p.has('review.decide') || p.has('audit.view');
};

export interface ImpactRow {
  id: number; refNo: string; status: string; vendor: string; date: string; employeeId: number; employee: string; gross: number;
  withheld: boolean | null; taxWithheld: number; potentialLoss: number; potentialSavings: number; computable: boolean; reasons: string[];
}

/**
 * The tax figures of every receipt this person can see, worked out from the saved answers with the same shared code the form uses.
 * Drafts and disapproved receipts are left out: they never reach payment. Everything is a potential figure, not a verified one.
 */
export async function impactRows(auth: AuthContext, filter: { from?: string; to?: string; employeeId?: number } = {}): Promise<ImpactRow[]> {
  const rules = getSettings();
  const where: Prisma.ReceiptWhereInput = {
    AND: [
      visibleWhere(auth),
      { birInvoice: true, status: { notIn: ['draft', 'disapproved'] } },
      // Only management sees other people's receipts here. Anyone else (Accounting can see approved receipts of everyone) gets their own.
      seesEveryone(auth) ? (filter.employeeId ? { encoderId: filter.employeeId } : {}) : { encoderId: auth.user.id },
      filter.from || filter.to ? { receiptDate: { ...(filter.from ? { gte: new Date(filter.from + 'T00:00:00Z') } : {}), ...(filter.to ? { lte: new Date(filter.to + 'T00:00:00Z') } : {}) } } : {},
    ],
  };
  const rows = await prisma.receipt.findMany({ where, include: { encoder: { select: { id: true, name: true } } }, orderBy: { receiptDate: 'desc' }, take: 5000 });
  return rows.map((r) => {
    const f = { birInvoice: r.birInvoice, amount: Number(r.amount), vatableAmount: dec(r.vatableAmount), vatAmount: dec(r.vatAmount), vatExemptAmount: dec(r.vatExemptAmount), withheld: r.withheld, whtRate: dec(r.whtRate) };
    const t = taxImpact(f, rules);
    return {
      id: r.id, refNo: r.refNo, status: r.status, vendor: r.payee, date: r.receiptDate.toISOString().slice(0, 10), employeeId: r.encoder.id, employee: r.encoder.name,
      gross: f.amount, withheld: r.withheld, taxWithheld: r.withheld ? dec(r.whtAmount) ?? 0 : 0,
      potentialLoss: t.potentialLoss, potentialSavings: t.potentialSavings, computable: t.computable,
      reasons: incompleteReasons({ birInvoice: r.birInvoice, invoiceNo: r.invoiceNo, vendorAddress: r.vendorAddress, vendorTin: r.vendorTin, vatType: r.vatType, vatableAmount: f.vatableAmount, vatAmount: f.vatAmount, withheld: r.withheld }, rules),
    };
  });
}

const sum = (rows: ImpactRow[], pick: (r: ImpactRow) => number) => round2(rows.reduce((t, r) => t + pick(r), 0));

export function totalsOf(rows: ImpactRow[]) {
  const incomplete = rows.filter((r) => r.reasons.length);
  return {
    receipts: rows.length,
    answeredYes: rows.filter((r) => r.withheld === true).length,
    answeredNo: rows.filter((r) => r.withheld === false).length,
    taxWithheld: sum(rows, (r) => r.taxWithheld),
    potentialLoss: sum(rows, (r) => r.potentialLoss),
    potentialSavings: sum(rows, (r) => r.potentialSavings),
    incomplete: incomplete.length,
    // The money tied up in receipts that are incomplete: their potential loss, which is zero when it cannot be worked out.
    incompleteLoss: sum(incomplete, (r) => r.potentialLoss),
    notEstimable: incomplete.filter((r) => !r.computable).length,
  };
}

export function byEmployee(rows: ImpactRow[]) {
  const groups = new Map<number, ImpactRow[]>();
  for (const r of rows) groups.set(r.employeeId, [...(groups.get(r.employeeId) ?? []), r]);
  return [...groups.values()].map((g) => {
    const t = totalsOf(g);
    const issues = g.filter((r) => r.reasons.length);
    return {
      employeeId: g[0]!.employeeId, employee: g[0]!.employee, receipts: t.receipts, answeredNo: t.answeredNo, incomplete: t.incomplete,
      potentialLoss: t.potentialLoss, potentialSavings: t.potentialSavings,
      // The same kind of problem keeps coming back: three or more flagged receipts.
      recurring: issues.length >= 3,
      submissions: issues.slice(0, 50).map((r) => ({ id: r.id, refNo: r.refNo, vendor: r.vendor, date: r.date, potentialLoss: r.potentialLoss, reasons: r.reasons })),
    };
  }).filter((e) => e.incomplete > 0 || e.potentialSavings > 0).sort((a, b) => b.potentialLoss - a.potentialLoss || b.incomplete - a.incomplete);
}

export function byMonth(rows: ImpactRow[]) {
  const m = new Map<string, ImpactRow[]>();
  for (const r of rows) m.set(r.date.slice(0, 7), [...(m.get(r.date.slice(0, 7)) ?? []), r]);
  return [...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).slice(-12).map(([month, g]) => ({ month, potentialLoss: sum(g, (r) => r.potentialLoss), potentialSavings: sum(g, (r) => r.potentialSavings) }));
}
