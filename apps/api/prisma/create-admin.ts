/**
 * Creates the first real Super Admin on a new system (one that was seeded with SEED_DEMO=false, or any time you need another).
 *   pnpm --filter @reimsys/api admin:create -- --email juan@company.com --name "Juan Dela Cruz"
 * It prints a temporary password once. The person must change it at first sign-in, and then accepts the privacy notice.
 * Uses the full-rights database login (MIGRATE_DATABASE_URL) when there is one.
 */
import './migrateLogin.js';
import { prisma } from '../src/db.js';
import { hashPassword, temporaryPassword } from '../src/lib/password.js';

const arg = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };

async function main() {
  const email = arg('--email')?.trim().toLowerCase();
  const name = arg('--name')?.trim();
  if (!email || !/^\S+@\S+\.\S+$/.test(email) || !name) {
    console.error('Usage: pnpm --filter @reimsys/api admin:create -- --email someone@company.com --name "Full Name"');
    process.exitCode = 1;
    return;
  }
  const role = await prisma.role.findUnique({ where: { code: 'admin' } });
  if (!role) { console.error('The Super Admin role does not exist. Run the seed first (pnpm db:seed).'); process.exitCode = 1; return; }
  if (await prisma.user.findUnique({ where: { email } })) { console.error(`${email} already exists. Nothing changed.`); process.exitCode = 1; return; }
  const temp = temporaryPassword();
  const user = await prisma.user.create({ data: { email, name, roleId: role.id, passwordHash: await hashPassword(temp), mustChangePassword: true } });
  await prisma.auditLog.create({ data: { actorName: 'System', action: 'user.created', entityType: 'user', entityId: String(user.id), summary: `Created user ${name} as Super Admin (admin:create)`, after: JSON.stringify({ name, email, role: 'admin' }) } });
  console.log(`Created ${name} <${email}> as Super Admin.\nTemporary password (shown once): ${temp}\nThey must choose their own password at first sign-in.`);
}

main().finally(() => prisma.$disconnect());
