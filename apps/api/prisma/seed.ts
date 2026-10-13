import { DEFAULT_GRANTS, DEFAULT_ROLES, PERMISSIONS } from '@reimsis/shared';
import { prisma } from '../src/db.js';
import { hashPassword } from '../src/lib/password.js';

/** Development password for the seeded accounts. Change or remove before any real deployment. */
const DEV_PASSWORD = 'Reimsis#2026';

async function main() {
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: p.code },
      update: { label: p.label, groupName: p.group },
      create: { code: p.code, label: p.label, groupName: p.group },
    });
  }
  for (const r of DEFAULT_ROLES) {
    await prisma.role.upsert({
      where: { code: r.code },
      update: { name: r.name },
      create: { code: r.code, name: r.name, rank: r.rank, isSystem: true },
    });
  }
  const roles = await prisma.role.findMany();
  const perms = await prisma.permission.findMany();
  const roleId = new Map(roles.map((r) => [r.code, r.id]));
  const permId = new Map(perms.map((p) => [p.code, p.id]));

  // Only set default grants on a fresh database, so edits made on the access control page survive re-seeding.
  if ((await prisma.rolePermission.count()) === 0) {
    const rows: { roleId: number; permissionId: number }[] = [];
    for (const [code, rs] of Object.entries(DEFAULT_GRANTS)) {
      for (const r of rs) rows.push({ roleId: roleId.get(r)!, permissionId: permId.get(code)! });
    }
    await prisma.rolePermission.createMany({ data: rows });
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
  console.log(`Seeded ${PERMISSIONS.length} permissions, ${DEFAULT_ROLES.length} roles, ${demo.length} users.`);
  console.log(`Dev password for every seeded user: ${DEV_PASSWORD}`);
}

main().finally(() => prisma.$disconnect());
