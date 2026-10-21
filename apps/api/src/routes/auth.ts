import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { forgotSchema, loginSchema, resetSchema } from '@reimsys/shared';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, unauthorized } from '../lib/errors.js';
import { hashPassword, newToken, sha256, verifyPassword } from '../lib/password.js';
import { checkToken, sendPasswordLink } from '../lib/passwordLinks.js';
import { meResponse, sessionInfo } from '../lib/serialize.js';
import { requireAuth } from '../middleware/auth.js';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  skip: () => config.rateLimitOff,
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

const forgotLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 6,
  skip: () => config.rateLimitOff,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMIT', message: 'Too many requests. Please wait a few minutes and try again.' } },
});

/** Opening and using a link: looser, since a real person may mistype a new password a few times. */
const linkLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 40,
  skip: () => config.rateLimitOff,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMIT', message: 'Too many attempts. Please wait a few minutes and try again.' } },
});

/** Always answers the same way, so nobody can use this page to find out who has an account. */
authRouter.post('/forgot', forgotLimiter, async (req, res) => {
  const { email } = forgotSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email } });
  if (user?.isActive) {
    await sendPasswordLink(user, 'reset');
    await audit(req, { action: 'auth.reset_requested', entityType: 'user', entityId: user.id, summary: 'asked for a password reset link', actor: { id: user.id, name: user.name } });
  } else {
    await audit(req, { action: 'auth.reset_requested', entityType: 'user', summary: `asked for a reset link for an unknown or inactive address`, actor: { id: null, name: email } });
  }
  res.json({ ok: true });
});

authRouter.get('/reset/check', linkLimiter, async (req, res) => {
  const row = await checkToken(String(req.query.token ?? ''));
  res.json(row ? { valid: true, name: row.user.name, invite: row.purpose === 'invite' } : { valid: false });
});

authRouter.post('/reset', linkLimiter, async (req, res) => {
  const { token, password } = resetSchema.parse(req.body);
  const row = await checkToken(token);
  if (!row) throw new HttpError(400, 'LINK_INVALID', 'This link has expired or was already used. Ask for a new one.');
  await prisma.$transaction([
    prisma.user.update({ where: { id: row.userId }, data: { passwordHash: await hashPassword(password), mustChangePassword: false, failedAttempts: 0, lockedUntil: null } }),
    prisma.passwordToken.updateMany({ where: { userId: row.userId, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.session.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  await audit(req, { action: 'auth.password_reset', entityType: 'user', entityId: row.userId, summary: row.purpose === 'invite' ? 'chose a password from the invitation link' : 'reset their password from an emailed link', actor: { id: row.userId, name: row.user.name } });
  res.json({ ok: true });
});

/** A real password hash nobody knows, checked when the account does not exist so a wrong guess takes the same time either way. */
const DUMMY_HASH = hashPassword('not-a-real-password-' + Math.random());

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

  if (!user || !user.isActive) {
    await verifyPassword(await DUMMY_HASH, password);
    return reject(`failed to sign in as ${email}`, user?.id);
  }
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
  const created: { expiresAt: Date; createdAt: Date } = { createdAt: now, expiresAt: new Date(now.getTime() + Math.min(config.sessionIdleMs, config.sessionMaxMs)) };
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: now } }),
    prisma.session.create({
      data: {
        tokenHash: sha256(token),
        userId: user.id,
        userAgent: req.get('user-agent')?.slice(0, 255) ?? null,
        ip: req.ip?.slice(0, 64) ?? null,
        createdAt: created.createdAt,
        expiresAt: created.expiresAt,
      },
    }),
  ]);
  res.cookie(config.cookieName, token, { ...cookieOptions(), maxAge: config.sessionMaxMs });
  await audit(req, { action: 'auth.login', entityType: 'user', entityId: user.id, summary: "signed in", actor: { id: user.id, name: user.name } });
  const { permissions, ...role } = user.role;
  res.json(meResponse({ ...user, role }, permissions.map((p) => p.permission.code), created));
});

/** "Stay signed in": a write, so it counts as activity and pushes the end of the session forward. */
authRouter.post('/keepalive', requireAuth, (req, res) => {
  res.json({ session: sessionInfo(req.auth!.session) });
});

authRouter.post('/logout', requireAuth, async (req, res) => {
  await prisma.session.update({ where: { id: req.auth!.session.id }, data: { revokedAt: new Date() } });
  await audit(req, { action: 'auth.logout', entityType: 'user', entityId: req.auth!.user.id, summary: 'signed out' });
  res.clearCookie(config.cookieName, cookieOptions());
  res.json({ ok: true });
});
