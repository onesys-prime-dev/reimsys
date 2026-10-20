import type { NextFunction, Request, Response } from 'express';
import { needsPrivacy } from '@reimsys/shared';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { sha256 } from '../lib/password.js';

const TOUCH_MS = 30_000;

/** Only things a person does extend a session. Background refreshes (the page quietly asking for news) must not, or an abandoned tab would stay signed in forever. */
const isRealActivity = (req: Request) => !['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.get('x-user-activity') === '1';

/** A session is valid until it has been idle too long or has lived too long. */
export const sessionAlive = (s: { revokedAt: Date | null; expiresAt: Date; createdAt: Date }, now = new Date()) =>
  !s.revokedAt && s.expiresAt > now && now.getTime() < s.createdAt.getTime() + config.sessionMaxMs;

/** Loads the session, user, role and permissions on every request so changes apply immediately. */
export async function loadAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[config.cookieName];
  if (!token) return next();
  const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token) } });
  const now = new Date();
  if (!session || !sessionAlive(session, now)) return next();
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  });
  if (!user || !user.isActive) return next();
  let current = session;
  if (isRealActivity(req) && now.getTime() - session.lastSeenAt.getTime() > TOUCH_MS) {
    // Pushed forward by the idle allowance, but never past the overall limit.
    const ends = Math.min(now.getTime() + config.sessionIdleMs, session.createdAt.getTime() + config.sessionMaxMs);
    current = await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: now, expiresAt: new Date(ends) } });
  }
  const { permissions, ...role } = user.role;
  req.auth = {
    user: { ...user, role } as never,
    session: current,
    permissions: new Set(permissions.map((p) => p.permission.code)),
  };
  next();
}

const ALLOWED_WHILE_LOCKED = ['/api/me', '/api/me/password', '/api/auth/logout'];
const ALLOWED_BEFORE_PRIVACY = ['/api/me', '/api/me/password', '/api/me/privacy', '/api/auth/logout'];

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(unauthorized());
  const path = (req.baseUrl + req.path).replace(/\/$/, '');
  if (req.auth.user.mustChangePassword && !ALLOWED_WHILE_LOCKED.includes(path)) {
    return next(forbidden('Change your password to continue.', 'PASSWORD_CHANGE_REQUIRED'));
  }
  if (needsPrivacy(req.auth.user.privacyAcceptedVersion) && !ALLOWED_BEFORE_PRIVACY.includes(path)) {
    return next(forbidden('Read and accept the privacy notice to continue.', 'PRIVACY_REQUIRED'));
  }
  next();
}

export const requirePerm = (...codes: string[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.auth) return next(unauthorized());
  if (!codes.every((c) => req.auth!.permissions.has(c))) return next(forbidden());
  next();
};
