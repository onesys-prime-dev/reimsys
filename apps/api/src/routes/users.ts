import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { createUserSchema, updateUserSchema } from '@reimsys/shared';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { hashPassword, temporaryPassword } from '../lib/password.js';
import { sendPasswordLink } from '../lib/passwordLinks.js';
import { userRow } from '../lib/serialize.js';
import { requireAuth, requirePerm } from '../middleware/auth.js';
import { sendAvatar } from './me.js';

export const usersRouter = Router();
usersRouter.use(requireAuth);

usersRouter.get('/:id/photo', async (req, res) => {
  await sendAvatar(Number(req.params.id), res);
});

usersRouter.use(requirePerm('user.manage'));

const include = { role: true } satisfies Prisma.UserInclude;
const idParam = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0 || n > 2_147_483_647) throw notFound('User not found.');
  return n;
};

/** Number of other active users who could still manage users if this user were removed from that group. */
async function otherManagers(excludeUserId: number) {
  return prisma.user.count({
    where: {
      isActive: true,
      id: { not: excludeUserId },
      role: { permissions: { some: { permission: { code: 'user.manage' } } } },
    },
  });
}
async function isManager(userId: number) {
  return (
    (await prisma.user.count({
      where: { id: userId, role: { permissions: { some: { permission: { code: 'user.manage' } } } } },
    })) > 0
  );
}

usersRouter.get('/', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const where: Prisma.UserWhereInput = {};
  if (q) where.OR = [{ name: { contains: q } }, { email: { contains: q } }];
  if (req.query.roleId) where.roleId = Number(req.query.roleId);
  if (req.query.active === 'true') where.isActive = true;
  if (req.query.active === 'false') where.isActive = false;
  const users = await prisma.user.findMany({ where, include, orderBy: [{ isActive: 'desc' }, { name: 'asc' }] });
  res.json({ users: users.map(userRow) });
});

usersRouter.post('/', async (req, res) => {
  const data = createUserSchema.parse(req.body);
  const actor = req.auth!.user;
  const role = await prisma.role.findUnique({ where: { id: data.roleId } });
  if (!role) throw notFound('Role not found.');
  if (role.rank > actor.role.rank) throw forbidden('You can only assign roles at or below your own rank.');
  const temp = temporaryPassword();
  const user = await prisma.user.create({
    data: { name: data.name, email: data.email, roleId: role.id, passwordHash: await hashPassword(temp), mustChangePassword: true },
    include,
  });
  await audit(req, {
    action: 'user.created', entityType: 'user', entityId: user.id,
    summary: `Created user ${user.name} as ${role.name}`, after: { name: user.name, email: user.email, role: role.code },
  });
  // The invitation is a courtesy. If email is not set up or fails, the temporary password above still works.
  await sendPasswordLink(user, 'invite', actor.name).catch((e) => console.error('invite email', e));
  res.status(201).json({ user: userRow(user), temporaryPassword: temp });
});

usersRouter.patch('/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const data = updateUserSchema.parse(req.body);
  const actor = req.auth!.user;
  const target = await prisma.user.findUnique({ where: { id }, include });
  if (!target) throw notFound('User not found.');
  if (target.role.rank > actor.role.rank) throw forbidden('You can only manage users at or below your own rank.');

  let newRole = target.role;
  if (data.roleId !== undefined && data.roleId !== target.roleId) {
    if (id === actor.id) throw conflict('You cannot change your own role.', 'SELF_CHANGE');
    const r = await prisma.role.findUnique({ where: { id: data.roleId } });
    if (!r) throw notFound('Role not found.');
    if (r.rank > actor.role.rank) throw forbidden('You can only assign roles at or below your own rank.');
    newRole = r;
  }
  const deactivating = data.isActive === false && target.isActive;
  if (deactivating && id === actor.id) throw conflict('You cannot deactivate your own account.', 'SELF_CHANGE');

  if ((deactivating || newRole.id !== target.roleId) && (await isManager(id))) {
    const stillManager =
      newRole.id === target.roleId ||
      (await prisma.rolePermission.count({ where: { roleId: newRole.id, permission: { code: 'user.manage' } } })) > 0;
    if ((deactivating || !stillManager) && (await otherManagers(id)) === 0) {
      throw conflict('At least one active administrator must remain.', 'LAST_ADMIN');
    }
  }

  const updated = await prisma.user.update({
    where: { id },
    data: {
      name: data.name, roleId: newRole.id, isActive: data.isActive,
      phone: data.phone === undefined ? undefined : data.phone, branch: data.branch === undefined ? undefined : data.branch,
    },
    include,
  });
  if (deactivating) await prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });

  const changes: string[] = [];
  if (data.name && data.name !== target.name) changes.push('name');
  if (newRole.id !== target.roleId) changes.push(`role ${target.role.name} to ${newRole.name}`);
  if (data.isActive !== undefined && data.isActive !== target.isActive) changes.push(data.isActive ? 'activated' : 'deactivated');
  await audit(req, {
    action: newRole.id !== target.roleId ? 'user.role_changed' : data.isActive !== undefined && data.isActive !== target.isActive ? (data.isActive ? 'user.activated' : 'user.deactivated') : 'user.updated',
    entityType: 'user', entityId: id, summary: `${updated.name}: ${changes.join(', ') || 'details updated'}`,
    before: { name: target.name, role: target.role.code, isActive: target.isActive },
    after: { name: updated.name, role: updated.role.code, isActive: updated.isActive },
  });
  res.json({ user: userRow(updated) });
});

usersRouter.post('/:id/reset-password', async (req, res) => {
  const id = idParam(req.params.id);
  const actor = req.auth!.user;
  const target = await prisma.user.findUnique({ where: { id }, include });
  if (!target) throw notFound('User not found.');
  if (target.role.rank > actor.role.rank) throw forbidden('You can only manage users at or below your own rank.');
  const temp = temporaryPassword();
  await prisma.user.update({ where: { id }, data: { passwordHash: await hashPassword(temp), mustChangePassword: true, failedAttempts: 0, lockedUntil: null } });
  await prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit(req, { action: 'user.password_reset', entityType: 'user', entityId: id, summary: `Reset password for ${target.name}` });
  res.json({ temporaryPassword: temp });
});

usersRouter.post('/:id/unlock', async (req, res) => {
  const id = idParam(req.params.id);
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) throw notFound('User not found.');
  await prisma.user.update({ where: { id }, data: { failedAttempts: 0, lockedUntil: null } });
  await audit(req, { action: 'user.unlocked', entityType: 'user', entityId: id, summary: `Unlocked ${target.name}` });
  res.json({ ok: true });
});

usersRouter.get('/:id/sessions', async (req, res) => {
  const id = idParam(req.params.id);
  const rows = await prisma.session.findMany({
    where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: 'desc' },
  });
  res.json({ sessions: rows.map((s) => ({ id: s.id, userAgent: s.userAgent, ip: s.ip, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt })) });
});

usersRouter.delete('/:id/sessions', async (req, res) => {
  const id = idParam(req.params.id);
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) throw notFound('User not found.');
  const r = await prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit(req, { action: 'user.sessions_revoked', entityType: 'user', entityId: id, summary: `Signed ${target.name} out of ${r.count} device${r.count === 1 ? '' : 's'}` });
  res.json({ revoked: r.count });
});
