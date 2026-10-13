import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { loginSchema } from '@reimsis/shared';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, unauthorized } from '../lib/errors.js';
import { newToken, sha256, verifyPassword } from '../lib/password.js';
import { meResponse } from '../lib/serialize.js';
import { requireAuth } from '../middleware/auth.js';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMIT', message: 'Too many attempts. Wait a minute and try again.' } },
});

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: config.isProd,
  path: '/',
});

authRouter.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const now = new Date();
  const user = await prisma.user.findUnique({ where: { email }, include: { role: { include: { permissions: { include: { permission: true } } } } } });

  const reject = async (summary: string, entityId?: number) => {
    await audit(req, {
      action: 'auth.login_failed', entityType: 'user', entityId, summary,
      actor: { id: user?.id ?? null, name: user?.name ?? email },
    });
    throw unauthorized('Email or password is incorrect.', 'INVALID_CREDENTIALS');
  };

  if (!user || !user.isActive) return reject(`failed to sign in as ${email}`, user?.id);
  if (user.lockedUntil && user.lockedUntil > now) {
    const mins = Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60000);
    throw new HttpError(423, 'LOCKED', `This account is locked. Try again in ${mins} minute${mins === 1 ? '' : 's'} or ask an administrator.`);
  }
  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) {
    const attempts = user.failedAttempts + 1;
    const lock = attempts >= config.maxFailedAttempts;
    await prisma.user.update({
      where: { id: user.id },
      data: { failedAttempts: lock ? 0 : attempts, lockedUntil: lock ? new Date(now.getTime() + config.lockMinutes * 60000) : null },
    });
    if (lock) await audit(req, { action: 'auth.locked', entityType: 'user', entityId: user.id, summary: "account locked after repeated failures", actor: { id: user.id, name: user.name } });
    return reject(`failed to sign in as ${email}`, user.id);
  }

  const token = newToken();
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: now } }),
    prisma.session.create({
      data: {
        tokenHash: sha256(token),
        userId: user.id,
        userAgent: req.get('user-agent')?.slice(0, 255) ?? null,
        ip: req.ip?.slice(0, 64) ?? null,
        expiresAt: new Date(now.getTime() + config.sessionMs),
      },
    }),
  ]);
  res.cookie(config.cookieName, token, { ...cookieOptions(), maxAge: config.sessionMs });
  await audit(req, { action: 'auth.login', entityType: 'user', entityId: user.id, summary: "signed in", actor: { id: user.id, name: user.name } });
  const { permissions, ...role } = user.role;
  res.json(meResponse({ ...user, role }, permissions.map((p) => p.permission.code)));
});

authRouter.post('/logout', requireAuth, async (req, res) => {
  await prisma.session.update({ where: { id: req.auth!.session.id }, data: { revokedAt: new Date() } });
  await audit(req, { action: 'auth.logout', entityType: 'user', entityId: req.auth!.user.id, summary: 'signed out' });
  res.clearCookie(config.cookieName, cookieOptions());
  res.json({ ok: true });
});
