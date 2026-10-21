import type { Role, Session, User } from '@prisma/client';
import { getSettings } from './appSettings.js';
import { needsPrivacy, type MeResponse, type RoleSummary } from '@reimsys/shared';
import { config } from '../config.js';

export const roleSummary = (r: Role, userCount?: number): RoleSummary => ({
  id: r.id,
  code: r.code,
  name: r.name,
  rank: r.rank,
  isSystem: r.isSystem,
  ...(userCount === undefined ? {} : { userCount }),
});

export function sessionInfo(s: Pick<Session, 'expiresAt' | 'createdAt'>) {
  return {
    expiresAt: s.expiresAt.toISOString(),
    maxAt: new Date(s.createdAt.getTime() + config.sessionMaxMs).toISOString(),
    idleMinutes: Math.round(config.sessionIdleMs / 60_000),
    serverNow: new Date().toISOString(),
  };
}

/** Changes whenever the photo changes, so every avatar on screen can load the new picture instead of a cached one. */
export const photoVersion = (file: string | null) => { const m = file ? /-(\d+)\./.exec(file) : null; return m ? Number(m[1]) : null; };

export function meResponse(user: User & { role: Role }, permissions: Iterable<string>, session?: Pick<Session, 'expiresAt' | 'createdAt'>): MeResponse {
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      branch: user.branch,
      hasPhoto: !!user.photoFile,
      photoV: photoVersion(user.photoFile),
      theme: (user.theme as 'light' | 'dark' | 'system') ?? 'light',
      mustChangePassword: user.mustChangePassword,
      privacyRequired: needsPrivacy(user.privacyAcceptedVersion, getSettings().privacyVersion),
      prefs: { dailyDigest: user.dailyDigest, reservationReleased: user.reservationReleased },
      role: roleSummary(user.role),
    },
    permissions: [...permissions].sort(),
    ...(session ? { session: sessionInfo(session) } : {}),
  };
}

export const userRow = (u: User & { role: Role }) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  isActive: u.isActive,
  mustChangePassword: u.mustChangePassword,
  lockedUntil: u.lockedUntil,
  lastLoginAt: u.lastLoginAt,
  privacyAcceptedVersion: u.privacyAcceptedVersion,
  privacyAcceptedAt: u.privacyAcceptedAt,
  phone: u.phone,
  branch: u.branch,
  hasPhoto: !!u.photoFile,
  photoV: photoVersion(u.photoFile),
  createdAt: u.createdAt,
  role: roleSummary(u.role),
});
