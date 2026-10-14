import { Router } from 'express';
import { reportRequestSchema } from '@reimsys/shared';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { enqueue } from '../lib/jobs.js';
import { loadVisible, visibleWhere } from '../lib/receipts.js';
import { filterLabel, reportRows } from '../lib/reports.js';
import { abs } from '../lib/storage.js';
import { requireAuth, requirePerm } from '../middleware/auth.js';

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

const idParam = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw notFound();
  return n;
};
const MIME: Record<string, string> = {
  pdf: 'application/pdf', csv: 'text/csv; charset=utf-8', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** Someone without "view all" can only ever report on their own receipts, whatever filters they send. */
const scopeFor = (req: import('express').Request) => visibleWhere(req.auth!);

reportsRouter.get('/preview', requirePerm('report.generate'), async (req, res) => {
  const q = reportRequestSchema.omit({ format: true }).parse({
    from: req.query.from, to: req.query.to,
    categoryId: req.query.categoryId ? Number(req.query.categoryId) : null,
    encoderId: req.query.encoderId ? Number(req.query.encoderId) : null,
  });
  const { rows, total } = await reportRows({ ...q, scope: scopeFor(req) });
  res.json({ count: rows.length, total });
});

reportsRouter.post('/', requirePerm('report.generate'), async (req, res) => {
  const body = reportRequestSchema.parse(req.body);
  if (body.from > body.to) throw conflict('The start date must be before the end date.', 'BAD_RANGE');
  const filters = { from: body.from, to: body.to, categoryId: body.categoryId ?? null, encoderId: body.encoderId ?? null, scope: scopeFor(req) };
  const rep = await prisma.liquidationReport.create({ data: { requestedById: req.auth!.user.id, format: body.format, filters: JSON.stringify(filters) } });
  await enqueue('report', { reportId: rep.id });
  await audit(req, { action: 'report.requested', entityType: 'report', entityId: rep.id, summary: `requested a ${body.format.toUpperCase()} liquidation report for ${body.from} to ${body.to}` });
  res.status(202).json({ report: { id: rep.id, status: rep.status } });
});

reportsRouter.get('/', async (req, res) => {
  const all = req.auth!.permissions.has('audit.view');
  const rows = await prisma.liquidationReport.findMany({ where: all ? {} : { requestedById: req.auth!.user.id }, orderBy: { id: 'desc' }, take: 50 });
  const parsed = rows.map((r) => JSON.parse(r.filters) as { encoderId?: number | null; categoryId?: number | null });
  const personIds = [...new Set(parsed.map((f) => f.encoderId).filter((x): x is number => !!x))];
  const users = await prisma.user.findMany({ where: { id: { in: [...rows.map((r) => r.requestedById), ...personIds] } }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name]));
  const catRows = await prisma.category.findMany({ select: { id: true, name: true } });
  const cats = new Map(catRows.map((c) => [c.id, c.name]));
  res.json({
    reports: rows.map((r) => {
      const f = JSON.parse(r.filters);
      return { id: r.id, format: r.format, status: r.status, from: f.from, to: f.to, personId: f.encoderId ?? null, person: f.encoderId ? names.get(f.encoderId) ?? null : null, category: f.categoryId ? cats.get(f.categoryId) ?? null : null, rowCount: r.rowCount, total: r.total == null ? null : Number(r.total), error: r.error, createdAt: r.createdAt, requestedBy: users.find((u) => u.id === r.requestedById)?.name ?? '' };
    }),
  });
});

/** The report as rows on screen, using the filters it was generated with. */
reportsRouter.get('/:id/data', async (req, res) => {
  const rep = await prisma.liquidationReport.findUnique({ where: { id: idParam(req.params.id) } });
  if (!rep) throw notFound('Report not found.');
  if (rep.requestedById !== req.auth!.user.id && !req.auth!.permissions.has('audit.view')) throw forbidden();
  const f = JSON.parse(rep.filters);
  const { rows, total } = await reportRows(f);
  const byCategory = new Map<string, { count: number; total: number }>();
  for (const r of rows) {
    const c = byCategory.get(r.category) ?? { count: 0, total: 0 };
    c.count += 1;
    c.total = Math.round((c.total + r.amount) * 100) / 100;
    byCategory.set(r.category, c);
  }
  const byPerson = new Map<string, { count: number; total: number }>();
  for (const r of rows) {
    const c = byPerson.get(r.encoder) ?? { count: 0, total: 0 };
    c.count += 1;
    c.total = Math.round((c.total + r.amount) * 100) / 100;
    byPerson.set(r.encoder, c);
  }
  const requester = await prisma.user.findUnique({ where: { id: rep.requestedById }, select: { name: true } });
  const person = f.encoderId ? (await prisma.user.findUnique({ where: { id: f.encoderId }, select: { name: true } }))?.name ?? null : null;
  const category = f.categoryId ? (await prisma.category.findUnique({ where: { id: f.categoryId }, select: { name: true } }))?.name ?? null : null;
  const rank = (m: Map<string, { count: number; total: number }>, key: string) => [...m.entries()].map(([k, v]) => ({ [key]: k, ...v })).sort((a, b) => b.total - a.total);
  res.json({
    report: { id: rep.id, format: rep.format, status: rep.status, from: f.from, to: f.to, person, category, createdAt: rep.createdAt, requestedBy: requester?.name ?? '' },
    rows, total,
    byCategory: rank(byCategory, 'category'),
    byPerson: rank(byPerson, 'person'),
  });
});

reportsRouter.get('/:id/file', async (req, res) => {
  const rep = await prisma.liquidationReport.findUnique({ where: { id: idParam(req.params.id) } });
  if (!rep) throw notFound('Report not found.');
  if (rep.requestedById !== req.auth!.user.id && !req.auth!.permissions.has('audit.view')) throw forbidden();
  if (rep.status !== 'ready' || !rep.filePath) throw conflict('This report is not ready yet.', 'NOT_READY');
  const mode = req.query.mode === 'print' ? 'print' : 'download';
  await audit(req, { action: `report.${mode === 'print' ? 'printed' : 'downloaded'}`, entityType: 'report', entityId: rep.id, summary: `${mode === 'print' ? 'printed' : 'downloaded'} liquidation report #${rep.id}` });
  const label = await filterLabel(JSON.parse(rep.filters));
  const slug = label.replace(/(Person|Category): /g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  const name = `liquidation-${rep.id}${slug ? '-' + slug : ''}.${rep.format}`;
  res.setHeader('Content-Type', MIME[rep.format]!);
  res.setHeader('Content-Disposition', `${mode === 'print' && rep.format === 'pdf' ? 'inline' : 'attachment'}; filename="${name}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.sendFile(abs(rep.filePath));
});

/* ---------- reimbursement documents ---------- */
export const documentsRouter = Router();
documentsRouter.use(requireAuth);

documentsRouter.get('/:id/file', async (req, res) => {
  const doc = await prisma.reimbursementDocument.findUnique({ where: { id: idParam(req.params.id) } });
  if (!doc) throw notFound('Document not found.');
  await loadVisible(req.auth!, doc.receiptId);
  if (doc.status !== 'ready' || !doc.filePath) throw conflict('The document is still being prepared. Try again in a moment.', 'NOT_READY');
  const mode = req.query.mode === 'print' ? 'print' : req.query.mode === 'view' ? 'view' : 'download';
  const verb = mode === 'print' ? 'printed' : mode === 'view' ? 'viewed' : 'downloaded';
  await audit(req, { action: `document.${verb}`, entityType: 'receipt', entityId: doc.receiptId, summary: `${verb} reimbursement document ${doc.docNo}` });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${mode === 'download' ? 'attachment' : 'inline'}; filename="${doc.docNo}.pdf"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.sendFile(abs(doc.filePath));
});
