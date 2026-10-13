import type { Role, User } from '@prisma/client';
import type { MeResponse, RoleSummary } from '@reimsis/shared';

export const roleSummary = (r: Role, userCount?: number): RoleSummary => ({
  id: r.id,
  code: r.code,
  name: r.name,
  rank: r.rank,
  isSystem: r.isSystem,
  ...(userCount === undefined ? {} : { userCount }),
});

export function meResponse(user: User & { role: Role }, permissions: Iterable<string>): MeResponse {
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      branch: user.branch,
      hasPhoto: !!user.photoFile,
      theme: (user.theme as 'light' | 'dark' | 'system') ?? 'light',
      mustChangePassword: user.mustChangePassword,
      prefs: { dailyDigest: user.dailyDigest, reservationReleased: user.reservationReleased },
      role: roleSummary(user.role),
    },
    permissions: [...permissions].sort(),
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
  phone: u.phone,
  branch: u.branch,
  hasPhoto: !!u.photoFile,
  createdAt: u.createdAt,
  role: roleSummary(u.role),
});
