import { DEFAULT_GRANTS, DEFAULT_ROLES, PERMISSIONS } from '@reimsys/shared';
import { prisma } from '../src/db.js';
import { hashPassword } from '../src/lib/password.js';
import { demoUsersToCreate } from './demoUsers.js';

/** Development password for the seeded accounts. Change or remove before any real deployment. */
const DEV_PASSWORD = 'Reimsys#2026';
const CATEGORIES = ['Medicine', 'Transport', 'Meals', 'Supplies', 'Lodging'];

async function main() {
  const roleRows = [];
  const newRoles = new Set<string>();
  for (const r of DEFAULT_ROLES) {
    const had = await prisma.role.findUnique({ where: { code: r.code } });
    if (!had) newRoles.add(r.code);
    roleRows.push(await prisma.role.upsert({ where: { code: r.code }, update: { name: r.name }, create: { code: r.code, name: r.name, rank: r.rank, isSystem: true } }));
  }
  const roleId = new Map(roleRows.map((r) => [r.code, r.id]));

  // Permissions added in a later release get their default grants once. Edits made on the access control page survive re-seeding.
  for (const p of PERMISSIONS) {
    const existing = await prisma.permission.findUnique({ where: { code: p.code } });
    const row = await prisma.permission.upsert({ where: { code: p.code }, update: { label: p.label, groupName: p.group }, create: { code: p.code, label: p.label, groupName: p.group } });
    const roles = DEFAULT_GRANTS[p.code] ?? [];
    // A brand-new permission goes to every role that should have it; a brand-new role gets the defaults of the permissions that already existed.
    const targets = existing ? roles.filter((r) => newRoles.has(r)) : roles;
    if (targets.length) await prisma.rolePermission.createMany({ data: targets.map((r) => ({ roleId: roleId.get(r)!, permissionId: row.id })), skipDuplicates: true });
  }

  for (const [i, name] of CATEGORIES.entries()) {
    await prisma.category.upsert({ where: { name }, update: {}, create: { name, sortOrder: i } });
  }

  // A live system that has switched the demo accounts off (pnpm demo:off) gets none back when it is re-seeded during an upgrade.
  const retired = (await prisma.auditLog.count({ where: { action: 'user.demo_retired' } })) > 0;
  const demo = demoUsersToCreate(retired);
  const passwordHash = await hashPassword(DEV_PASSWORD);
  for (const u of demo) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { email: u.email, name: u.name, branch: u.branch, roleId: roleId.get(u.role)!, passwordHash, mustChangePassword: false },
    });
  }
  console.log(`Seeded ${PERMISSIONS.length} permissions, ${DEFAULT_ROLES.length} roles, ${CATEGORIES.length} categories, ${demo.length} users.`);
  console.log(`Dev password for every seeded user: ${DEV_PASSWORD}`);
}

main().finally(() => prisma.$disconnect());
