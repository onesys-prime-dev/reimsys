import { Router } from 'express';
import { chargeLocationSchema } from '@reimsys/shared';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { conflict, notFound } from '../lib/errors.js';
import { requireAuth, requirePerm } from '../middleware/auth.js';

export const chargeLocationsRouter = Router();
chargeLocationsRouter.use(requireAuth);

const idParam = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0 || n > 2_147_483_647) throw notFound();
  return n;
};
const out = (c: { id: number; name: string; isActive: boolean }, receiptCount?: number) => ({ id: c.id, name: c.name, isActive: c.isActive, ...(receiptCount === undefined ? {} : { receiptCount }) });

/** Everyone signed in sees the active places (the form's dropdown). Administrators can ask for all of them, switched off ones included. */
chargeLocationsRouter.get('/', async (req, res) => {
  const all = req.query.all === 'true' && req.auth!.permissions.has('settings.manage');
  const rows = await prisma.chargeLocation.findMany({ where: all ? {} : { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], include: { _count: { select: { receipts: true } } } });
  res.json({ locations: rows.map((c) => out(c, c._count.receipts)) });
});

chargeLocationsRouter.post('/', requirePerm('settings.manage'), async (req, res) => {
  const data = chargeLocationSchema.parse(req.body);
  if (await prisma.chargeLocation.findUnique({ where: { name: data.name } })) throw conflict('That name is already in the list.', 'DUPLICATE');
  const last = await prisma.chargeLocation.aggregate({ _max: { sortOrder: true } });
  const c = await prisma.chargeLocation.create({ data: { name: data.name, isActive: data.isActive ?? true, sortOrder: (last._max.sortOrder ?? 0) + 1 } });
  await audit(req, { action: 'chargelocation.created', entityType: 'charge_location', entityId: c.id, summary: `added "${c.name}" to where to charge` });
  res.status(201).json({ location: out(c, 0) });
});

chargeLocationsRouter.patch('/:id', requirePerm('settings.manage'), async (req, res) => {
  const id = idParam(req.params.id);
  const data = chargeLocationSchema.partial().parse(req.body);
  const before = await prisma.chargeLocation.findUnique({ where: { id } });
  if (!before) throw notFound('That place was not found.');
  if (data.name && data.name !== before.name && (await prisma.chargeLocation.findUnique({ where: { name: data.name } }))) throw conflict('That name is already in the list.', 'DUPLICATE');
  const c = await prisma.chargeLocation.update({ where: { id }, data });
  await audit(req, { action: 'chargelocation.updated', entityType: 'charge_location', entityId: id, summary: `changed "${before.name}" in where to charge`, before: { name: before.name, isActive: before.isActive }, after: { name: c.name, isActive: c.isActive } });
  res.json({ location: out(c) });
});
