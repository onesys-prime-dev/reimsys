/**
 * Switches off the demo accounts that share the public development password.
 * Run it once real users exist:  pnpm --filter @reimsys/api demo:off
 *
 * It refuses to run unless at least one OTHER active Super Admin exists, so it can never lock everyone out.
 * Nothing is deleted: the accounts are deactivated and signed out, so the audit trail keeps their names.
 */
import { prisma } from '../src/db.js';
import { DEMO_EMAILS } from './demoUsers.js';

const DEMO = DEMO_EMAILS;

async function main() {
  const realAdmins = await prisma.user.count({ where: { isActive: true, role: { code: 'admin' }, email: { notIn: DEMO } } });
  if (!realAdmins) {
    console.error('Stopped: there is no real Super Admin yet.\nSign in as admin@example.com, open Access, add yourself as a Super Admin, sign in as yourself, then run this again.');
    process.exitCode = 1;
    return;
  }
  const users = await prisma.user.findMany({ where: { email: { in: DEMO }, isActive: true }, select: { id: true, email: true } });
  if (!users.length) { console.log('The demo accounts are already off.'); return; }
  await prisma.user.updateMany({ where: { id: { in: users.map((u) => u.id) } }, data: { isActive: false } });
  await prisma.session.updateMany({ where: { userId: { in: users.map((u) => u.id) }, revokedAt: null }, data: { revokedAt: new Date() } });
  await prisma.auditLog.create({ data: { actorName: 'System', action: 'user.demo_retired', entityType: 'user', summary: `switched off ${users.length} demo accounts`, after: JSON.stringify({ emails: users.map((u) => u.email) }) } });
  console.log(`Switched off ${users.length} demo accounts: ${users.map((u) => u.email).join(', ')}`);
}

main().finally(() => prisma.$disconnect());
