/**
 * Creates the standard reminder schedules (Access -> Email schedules) if they are not there yet. Safe to run again: a schedule that already exists
 * by name is left exactly as it is, so changes made on the screen are never overwritten.
 *   pnpm --filter @reimsys/api emails:setup -- --boss boss@company.com
 * --boss is the person who gets the hourly reminder of everything that is stuck. Without it that one schedule is skipped.
 */
import './migrateLogin.js';
import { prisma } from '../src/db.js';

const arg = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const ALL_DAYS = '1,2,3,4,5,6';

async function main() {
  const bossEmail = arg('--boss')?.trim().toLowerCase();
  const boss = bossEmail ? await prisma.user.findUnique({ where: { email: bossEmail } }) : null;
  if (bossEmail && !boss) console.error(`No user ${bossEmail}. Create the account first (pnpm admin:create -- --role manager ...). The boss schedule is skipped.`);
  const role = async (code: string) => (await prisma.role.findUnique({ where: { code } }))?.id;
  const [medref, checker, approver, accounting] = await Promise.all(['medref', 'checker', 'approver', 'accounting'].map(role));
  const base = { isOn: true, days: ALL_DAYS, timeZone: 'Asia/Manila', minDays: 0 };
  const wanted = [
    ...(boss ? [{ name: 'Boss: everything that is stuck', steps: 'check,decide,pay,fix', minDays: 1, roleIds: '', userIds: String(boss.id), intervalMinutes: 60, startTime: '08:00', endTime: '18:00' }] : []),
    { name: 'Checkers: receipts waiting to be checked', steps: 'check', roleIds: String(checker ?? ''), userIds: '', intervalMinutes: 120, startTime: '08:00', endTime: '18:00' },
    { name: 'Approvers: receipts waiting for a decision', steps: 'decide', roleIds: String(approver ?? ''), userIds: '', intervalMinutes: 120, startTime: '08:00', endTime: '18:00' },
    { name: 'Accounting: receipts waiting to be paid', steps: 'pay', roleIds: String(accounting ?? ''), userIds: '', intervalMinutes: 180, startTime: '09:00', endTime: '17:00' },
    { name: 'Med Refs: returned receipts not yet corrected', steps: 'fix', minDays: 1, roleIds: String(medref ?? ''), userIds: '', intervalMinutes: 1440, startTime: '09:00', endTime: '18:00' },
  ];
  let made = 0;
  for (const w of wanted) {
    if (await prisma.emailSchedule.findFirst({ where: { name: w.name } })) { console.log(`Already there: ${w.name}`); continue; }
    const s = await prisma.emailSchedule.create({ data: { ...base, ...w } });
    await prisma.auditLog.create({ data: { actorName: 'System', action: 'emailschedule.created', entityType: 'email_schedule', entityId: String(s.id), summary: `created the email schedule "${s.name}"` } });
    console.log(`Created: ${w.name}`);
    made++;
  }
  console.log(`${made} schedule${made === 1 ? '' : 's'} created.`);
}

main().finally(() => prisma.$disconnect());
