import { DEFAULT_GRANTS, DEFAULT_ROLES, PERMISSIONS } from '@reimsis/shared';
import { prisma } from '../src/db.js';
import { hashPassword } from '../src/lib/password.js';

/** Development password for the seeded accounts. Change or remove before any real deployment. */
const DEV_PASSWORD = 'Reimsis#2026';
const CATEGORIES = ['Medicine', 'Transport', 'Meals', 'Supplies', 'Lodging'];

async function main() {
  const roleRows = [];
  for (const r of DEFAULT_ROLES) {
    roleRows.push(await prisma.role.upsert({ where: { code: r.code }, update: { name: r.name }, create: { code: r.code, name: r.name, rank: r.rank, isSystem: true } }));
  }
  const roleId = new Map(roleRows.map((r) => [r.code, r.id]));

  // Permissions added in a later release get their default grants once. Edits made on the access control page survive re-seeding.
  for (const p of PERMISSIONS) {
    const existing = await prisma.permission.findUnique({ where: { code: p.code } });
    const row = await prisma.permission.upsert({ where: { code: p.code }, update: { label: p.label, groupName: p.group }, create: { code: p.code, label: p.label, groupName: p.group } });
    if (!existing) {
      const roles = DEFAULT_GRANTS[p.code] ?? [];
      if (roles.length) await prisma.rolePermission.createMany({ data: roles.map((r) => ({ roleId: roleId.get(r)!, permissionId: row.id })), skipDuplicates: true });
    }
  }

  for (const [i, name] of CATEGORIES.entries()) {
    await prisma.category.upsert({ where: { name }, update: {}, create: { name, sortOrder: i } });
  }

  const demo = [
    { email: 'ana.reyes@example.com', name: 'Ana Reyes', role: 'medref', branch: 'Cebu North' },
    { email: 'mark.dc@example.com', name: 'Mark Dela Cruz', role: 'medref', branch: 'Cebu South' },
    { email: 'liza.santos@example.com', name: 'Liza Santos', role: 'checker', branch: 'Head Office' },
    { email: 'paolo.v@example.com', name: 'Paolo Villanueva', role: 'approver', branch: 'Head Office' },
    { email: 'admin@example.com', name: 'Admin User', role: 'admin', branch: 'Head Office' },
  ];
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
