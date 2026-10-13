import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth, requirePerm } from '../middleware/auth.js';

export const auditRouter = Router();
auditRouter.use(requireAuth, requirePerm('audit.view'));

const parse = (s: string | null) => {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return s; }
};
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

auditRouter.get('/', async (req, res) => {
  const q = str(req.query.q);
  const where: Prisma.AuditLogWhereInput = {};
  if (q) where.OR = [{ actorName: { contains: q } }, { action: { contains: q } }, { summary: { contains: q } }, { entityId: { contains: q } }];
  if (str(req.query.action)) where.action = { startsWith: str(req.query.action)! };
  if (str(req.query.entityType)) where.entityType = str(req.query.entityType);
  if (str(req.query.actorId)) where.actorId = Number(req.query.actorId);
  const from = str(req.query.from), to = str(req.query.to);
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from + 'T00:00:00');
    if (to) where.createdAt.lte = new Date(to + 'T23:59:59.999');
  }
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
  const page = Math.max(1, Number(req.query.page) || 1);
  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  res.json({
    total, page, pageSize,
    items: rows.map((r) => ({
      id: r.id, actorId: r.actorId, actorName: r.actorName, action: r.action, entityType: r.entityType, entityId: r.entityId,
      summary: r.summary, before: parse(r.before), after: parse(r.after), ip: r.ip, createdAt: r.createdAt,
    })),
  });
});

auditRouter.get('/export', async (req, res) => {
  const q = str(req.query.q);
  const where: Prisma.AuditLogWhereInput = {};
  if (q) where.OR = [{ actorName: { contains: q } }, { action: { contains: q } }, { summary: { contains: q } }, { entityId: { contains: q } }];
  if (str(req.query.action)) where.action = { startsWith: str(req.query.action)! };
  const from = str(req.query.from), to = str(req.query.to);
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from + 'T00:00:00');
    if (to) where.createdAt.lte = new Date(to + 'T23:59:59.999');
  }
  const rows = await prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, take: 50000 });
  const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = '﻿' + [['Time', 'Person', 'Action', 'Summary', 'Record', 'IP'].join(','), ...rows.map((r) => [r.createdAt.toISOString(), r.actorName, r.action, r.summary, `${r.entityType}${r.entityId ? ' #' + r.entityId : ''}`, r.ip].map(esc).join(','))].join('\r\n');
  res.type('text/csv').attachment(`audit-log-${new Date().toISOString().slice(0, 10)}.csv`).send(csv);
});
