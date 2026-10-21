import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { PRIVACY_VERSION, changePasswordSchema, preferencesSchema, updateProfileSchema } from '@reimsys/shared';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { meResponse } from '../lib/serialize.js';
import { requireAuth } from '../middleware/auth.js';

export const meRouter = Router();
meRouter.use(requireAuth);

const reload = async (id: number) => prisma.user.findUniqueOrThrow({ where: { id }, include: { role: true } });

meRouter.get('/', (req, res) => {
  res.json(meResponse(req.auth!.user, req.auth!.permissions, req.auth!.session));
});

meRouter.patch('/', async (req, res) => {
  const data = updateProfileSchema.parse(req.body);
  const u = req.auth!.user;
  await prisma.user.update({ where: { id: u.id }, data: { name: data.name, phone: data.phone ?? null, branch: data.branch ?? null } });
  await audit(req, {
    action: 'profile.updated', entityType: 'user', entityId: u.id, summary: 'updated own profile',
    before: { name: u.name, phone: u.phone, branch: u.branch }, after: data,
  });
  res.json(meResponse(await reload(u.id), req.auth!.permissions, req.auth!.session));
});

meRouter.patch('/preferences', async (req, res) => {
  const p = preferencesSchema.parse(req.body);
  const u = req.auth!.user;
  await prisma.user.update({
    where: { id: u.id },
    data: { theme: p.theme, dailyDigest: p.dailyDigest, reservationReleased: p.reservationReleased },
  });
  res.json(meResponse(await reload(u.id), req.auth!.permissions, req.auth!.session));
});

meRouter.post('/password', async (req, res) => {
  const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
  const u = req.auth!.user;
  if (!(await verifyPassword(u.passwordHash, currentPassword))) throw badRequest('Current password is incorrect.', 'WRONG_PASSWORD');
  if (currentPassword === newPassword) throw badRequest('Choose a different password.', 'SAME_PASSWORD');
  await prisma.user.update({ where: { id: u.id }, data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false } });
  await prisma.session.updateMany({ where: { userId: u.id, revokedAt: null, NOT: { id: req.auth!.session.id } }, data: { revokedAt: new Date() } });
  await audit(req, { action: 'auth.password_changed', entityType: 'user', entityId: u.id, summary: 'changed own password' });
  res.json(meResponse(await reload(u.id), req.auth!.permissions, req.auth!.session));
});

meRouter.post('/privacy', async (req, res) => {
  const u = req.auth!.user;
  if (u.mustChangePassword) throw forbidden('Change your password first.', 'PASSWORD_CHANGE_REQUIRED');
  await prisma.user.update({ where: { id: u.id }, data: { privacyAcceptedVersion: PRIVACY_VERSION, privacyAcceptedAt: new Date() } });
  await audit(req, { action: 'privacy.accepted', entityType: 'user', entityId: u.id, summary: `accepted the privacy notice (version ${PRIVACY_VERSION})`, before: { version: u.privacyAcceptedVersion ?? null }, after: { version: PRIVACY_VERSION } });
  res.json(meResponse(await reload(u.id), req.auth!.permissions, req.auth!.session));
});

meRouter.get('/sessions', async (req, res) => {
  const rows = await prisma.session.findMany({
    where: { userId: req.auth!.user.id, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: 'desc' },
  });
  res.json({
    sessions: rows.map((s) => ({
      id: s.id, userAgent: s.userAgent, ip: s.ip, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, current: s.id === req.auth!.session.id,
    })),
  });
});

meRouter.delete('/sessions/:id', async (req, res) => {
  const id = String(req.params.id);
  const result = await prisma.session.updateMany({ where: { id, userId: req.auth!.user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (!result.count) throw notFound('Session not found.');
  await audit(req, { action: 'auth.session_revoked', entityType: 'session', entityId: id, summary: 'signed out another device' });
  res.json({ ok: true });
});

meRouter.get('/activity', async (req, res) => {
  const rows = await prisma.auditLog.findMany({ where: { actorId: req.auth!.user.id }, orderBy: { id: 'desc' }, take: 20 });
  res.json({ items: rows.map((r) => ({ id: r.id, action: r.action, summary: r.summary, createdAt: r.createdAt })) });
});

/* ---------- profile photo ---------- */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const avatarDir = () => path.join(config.storageDir, 'avatars');

meRouter.post('/photo', upload.single('photo'), async (req, res) => {
  const file = req.file;
  if (!file || !EXT[file.mimetype]) throw badRequest('Upload a JPG, PNG or WEBP image up to 2 MB.', 'BAD_IMAGE');
  const u = req.auth!.user;
  await fs.mkdir(avatarDir(), { recursive: true });
  const name = `${u.id}-${Date.now()}.${EXT[file.mimetype]}`;
  await fs.writeFile(path.join(avatarDir(), name), file.buffer);
  if (u.photoFile) await fs.rm(path.join(avatarDir(), u.photoFile), { force: true });
  await prisma.user.update({ where: { id: u.id }, data: { photoFile: name } });
  await audit(req, { action: 'profile.photo_changed', entityType: 'user', entityId: u.id, summary: 'changed profile photo' });
  res.json(meResponse(await reload(u.id), req.auth!.permissions, req.auth!.session));
});

/** Takes the photo away: the initials show again. The picture file is deleted, and the change is recorded. */
meRouter.delete('/photo', async (req, res) => {
  const u = req.auth!.user;
  if (!u.photoFile) throw notFound('There is no photo to remove.');
  await prisma.user.update({ where: { id: u.id }, data: { photoFile: null } });
  await fs.rm(path.join(avatarDir(), u.photoFile), { force: true });
  await audit(req, { action: 'profile.photo_removed', entityType: 'user', entityId: u.id, summary: 'removed profile photo' });
  res.json(meResponse(await reload(u.id), req.auth!.permissions, req.auth!.session));
});

export async function sendAvatar(userId: number, res: import('express').Response) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { photoFile: true } });
  if (!u?.photoFile) throw notFound('No photo.');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.sendFile(path.join(avatarDir(), u.photoFile));
}
