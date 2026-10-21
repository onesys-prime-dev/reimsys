import { Router } from 'express';
import { audit } from '../lib/audit.js';
import { getSettings } from '../lib/appSettings.js';
import { prisma } from '../db.js';
import { toCsv } from '../lib/reports.js';
import { requireAuth, requirePerm } from '../middleware/auth.js';

/**
 * Keeping records, phase 1: SHOWS which finished receipts are older than the keeping period. It never changes or deletes anything.
 * Finished means paid (counted from the payment date) or disapproved (from the decision date). Approved-but-unpaid, waiting, returned and draft
 * receipts are never listed. The history log and payments are never touched by anything here.
 */
export const retentionRouter = Router();
retentionRouter.use(requireAuth, requirePerm('settings.manage'));

const monthsAgo = (months: number) => { const d = new Date(); d.setMonth(d.getMonth() - months); return d; };
const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

async function eligible() {
  const months = getSettings().retentionMonths;
  if (!months) return { months: 0, cutoff: null as Date | null, rows: [] as Row[] };
  const cutoff = monthsAgo(months);
  const where = { OR: [{ status: 'paid', paidAt: { lt: cutoff } }, { status: 'disapproved', decidedAt: { lt: cutoff } }] };
  const found = await prisma.receipt.findMany({ where, orderBy: { id: 'asc' }, take: 50_000, select: { id: true, refNo: true, payee: true, amount: true, status: true, paidAt: true, decidedAt: true, encoder: { select: { name: true } } } });
  const rows: Row[] = found.map((r) => ({ id: r.id, refNo: r.refNo, payee: r.payee, amount: Number(r.amount), status: r.status, on: (r.status === 'paid' ? r.paidAt : r.decidedAt) as Date, person: r.encoder.name }));
  return { months, cutoff, rows, where };
}
interface Row { id: number; refNo: string; payee: string; amount: number; status: string; on: Date; person: string }

retentionRouter.get('/preview', async (req, res) => {
  const { months, cutoff, rows, where } = await eligible();
  if (!months || !cutoff) { res.json({ enabled: false, months: 0 }); return; }
  const byStatus: Record<string, { count: number; amount: number }> = {};
  const byMonth = new Map<string, { count: number; amount: number }>();
  for (const r of rows) {
    const s = (byStatus[r.status] ??= { count: 0, amount: 0 }); s.count++; s.amount += r.amount;
    const m = byMonth.get(ym(r.on)) ?? { count: 0, amount: 0 }; m.count++; m.amount += r.amount; byMonth.set(ym(r.on), m);
  }
  const files = rows.length ? await prisma.receiptEvidence.aggregate({ where: { receipt: where }, _count: { _all: true }, _sum: { size: true } }) : null;
  const totalAmount = rows.reduce((n, r) => n + r.amount, 0);
  await audit(req, { action: 'retention.previewed', entityType: 'settings', entityId: 'retention', summary: `previewed finished records older than ${months} months (${rows.length} found, nothing changed)` });
  res.json({
    enabled: true, months, cutoff: cutoff.toISOString().slice(0, 10), total: rows.length, totalAmount: Math.round(totalAmount * 100) / 100,
    byStatus, byMonth: [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({ month, ...v })),
    oldest: rows.length ? rows.reduce((a, r) => (r.on < a ? r.on : a), rows[0]!.on).toISOString().slice(0, 10) : null,
    files: { count: files?._count._all ?? 0, bytes: files?._sum.size ?? 0 },
    note: 'Preview only. Nothing is deleted, hidden or changed. The history log and the payment records are never touched.',
  });
});

retentionRouter.get('/preview.csv', async (req, res) => {
  const { months, rows } = await eligible();
  const day = (d: Date) => d.toISOString().slice(0, 10);
  await audit(req, { action: 'retention.exported', entityType: 'settings', entityId: 'retention', summary: `downloaded the list of ${rows.length} finished records older than ${months || 0} months` });
  res.type('text/csv').attachment(`records-older-than-${months || 0}-months-${new Date().toISOString().slice(0, 10)}.csv`)
    .send(toCsv([['Reference', 'Vendor', 'Amount (PHP)', 'Status', 'Paid or disapproved on', 'Encoded by'], ...rows.map((r) => [r.refNo, r.payee, r.amount, r.status, day(r.on), r.person])]));
});
