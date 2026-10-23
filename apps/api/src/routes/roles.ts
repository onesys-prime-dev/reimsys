import { Router } from 'express';
import { LOCKED_GRANTS, createRoleSchema, rolePermissionsSchema, updateRoleSchema } from '@reimsys/shared';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { roleSummary } from '../lib/serialize.js';
import { requireAuth, requirePerm } from '../middleware/auth.js';

export const rolesRouter = Router();
rolesRouter.use(requireAuth);

const idParam = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0 || n > 2_147_483_647) throw notFound('Role not found.');
  return n;
};

/** Role list is needed by user dropdowns and the matrix, so either admin permission may read it. */
const canRead = (req: Express.Request) => req.auth!.permissions.has('user.manage') || req.auth!.permissions.has('role.manage');

rolesRouter.get('/roles', async (req, res) => {
  if (!canRead(req)) throw forbidden();
  const roles = await prisma.role.findMany({ orderBy: { rank: 'asc' }, include: { _count: { select: { users: true } } } });
  res.json({ roles: roles.map((r) => roleSummary(r, r._count.users)) });
});

rolesRouter.get('/permissions', async (req, res) => {
  if (!canRead(req)) throw forbidden();
  const [perms, roles] = await Promise.all([
    prisma.permission.findMany({ orderBy: { id: 'asc' } }),
    prisma.role.findMany({ include: { permissions: { include: { permission: true } } } }),
  ]);
  const grants: Record<number, string[]> = {};
  for (const r of roles) grants[r.id] = r.permissions.map((p) => p.permission.code);
  res.json({
    permissions: perms.map((p) => ({ id: p.id, code: p.code, label: p.label, group: p.groupName })),
    grants,
    locked: LOCKED_GRANTS,
  });
});

rolesRouter.post('/roles', requirePerm('role.manage'), async (req, res) => {
  const data = createRoleSchema.parse(req.body);
  const actor = req.auth!.user;
  if (data.rank > actor.role.rank) throw forbidden('You can only create roles at or below your own rank.');
  const role = await prisma.role.create({ data: { code: data.code, name: data.name, rank: data.rank, isSystem: false } });
  await audit(req, { action: 'role.created', entityType: 'role', entityId: role.id, summary: `Created role ${role.name}`, after: data });
  res.status(201).json({ role: roleSummary(role, 0) });
});

rolesRouter.patch('/roles/:id', requirePerm('role.manage'), async (req, res) => {
  const id = idParam(req.params.id);
  const data = updateRoleSchema.parse(req.body);
  const actor = req.auth!.user;
  const role = await prisma.role.findUnique({ where: { id } });
  if (!role) throw notFound('Role not found.');
  if (role.rank > actor.role.rank) throw forbidden('You can only edit roles at or below your own rank.');
  if (role.isSystem && data.rank !== undefined && data.rank !== role.rank) throw conflict('Built-in roles keep their rank.', 'SYSTEM_ROLE');
  if (data.rank !== undefined && data.rank > actor.role.rank) throw forbidden('Rank cannot exceed your own.');
  const updated = await prisma.role.update({ where: { id }, data });
  await audit(req, {
    action: 'role.updated', entityType: 'role', entityId: id, summary: `Updated role ${updated.name}`,
    before: { name: role.name, rank: role.rank }, after: { name: updated.name, rank: updated.rank },
  });
  res.json({ role: roleSummary(updated) });
});

rolesRouter.delete('/roles/:id', requirePerm('role.manage'), async (req, res) => {
  const id = idParam(req.params.id);
  const role = await prisma.role.findUnique({ where: { id }, include: { _count: { select: { users: true } } } });
  if (!role) throw notFound('Role not found.');
  if (role.isSystem) throw conflict('Built-in roles cannot be deleted.', 'SYSTEM_ROLE');
  if (role._count.users) throw conflict('Move this role\'s users to another role first.', 'ROLE_IN_USE');
  await prisma.role.delete({ where: { id } });
  await audit(req, { action: 'role.deleted', entityType: 'role', entityId: id, summary: `Deleted role ${role.name}` });
  res.json({ ok: true });
});

rolesRouter.put('/roles/:id/permissions', requirePerm('role.manage'), async (req, res) => {
  const id = idParam(req.params.id);
  const { codes } = rolePermissionsSchema.parse(req.body);
  const actor = req.auth!.user;
  const role = await prisma.role.findUnique({ where: { id }, include: { permissions: { include: { permission: true } } } });
  if (!role) throw notFound('Role not found.');
  if (role.rank > actor.role.rank) throw forbidden('You can only edit roles at or below your own rank.');

  const wanted = new Set(codes);
  const missingLocked = LOCKED_GRANTS.filter((g) => g.role === role.code && !wanted.has(g.permission)).map((g) => g.permission);
  if (missingLocked.length) throw badRequest(`These permissions are locked for ${role.name}: ${missingLocked.join(', ')}.`, 'LOCKED_PERMISSION');

  const all = await prisma.permission.findMany();
  const byCode = new Map(all.map((p) => [p.code, p.id]));
  const unknown = codes.filter((c) => !byCode.has(c));
  if (unknown.length) throw badRequest(`Unknown permission: ${unknown.join(', ')}.`, 'UNKNOWN_PERMISSION');

  const before = role.permissions.map((p) => p.permission.code).sort();
  const after = [...wanted].sort();
  await prisma.$transaction([
    prisma.rolePermission.deleteMany({ where: { roleId: id } }),
    prisma.rolePermission.createMany({ data: after.map((c) => ({ roleId: id, permissionId: byCode.get(c)! })) }),
  ]);
  const added = after.filter((c) => !before.includes(c));
  const removed = before.filter((c) => !after.includes(c));
  await audit(req, {
    action: 'role.permissions_changed', entityType: 'role', entityId: id,
    summary: `${role.name}: +${added.length} -${removed.length} permissions`, before: { permissions: before }, after: { permissions: after, added, removed },
  });
  res.json({ roleId: id, codes: after });
});
