import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { sha256 } from '../lib/password.js';

const TOUCH_MS = 60_000;

/** Loads the session, user, role and permissions on every request so changes apply immediately. */
export async function loadAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[config.cookieName];
  if (!token) return next();
  const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token) } });
  const now = new Date();
  if (!session || session.revokedAt || session.expiresAt < now) return next();
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  });
  if (!user || !user.isActive) return next();
  if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_MS) {
    await prisma.session.update({
      where: { id: session.id },
      data: { lastSeenAt: now, expiresAt: new Date(now.getTime() + config.sessionMs) },
    });
  }
  const { permissions, ...role } = user.role;
  req.auth = {
    user: { ...user, role } as never,
    session,
    permissions: new Set(permissions.map((p) => p.permission.code)),
  };
  next();
}

const ALLOWED_WHILE_LOCKED = ['/api/me', '/api/me/password', '/api/auth/logout'];

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(unauthorized());
  const path = (req.baseUrl + req.path).replace(/\/$/, '');
  if (req.auth.user.mustChangePassword && !ALLOWED_WHILE_LOCKED.includes(path)) {
    return next(forbidden('Change your password to continue.', 'PASSWORD_CHANGE_REQUIRED'));
  }
  next();
}

export const requirePerm = (...codes: string[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.auth) return next(unauthorized());
  if (!codes.every((c) => req.auth!.permissions.has(c))) return next(forbidden());
  next();
};
