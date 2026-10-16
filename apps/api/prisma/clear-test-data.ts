/**
 * Clears the receipts and everything attached to them (evidence, documents, payments, comments, notices, email log, reports,
 * history, sessions and the reference-number counters), plus the uploaded files. Users, roles, rights, settings and categories stay.
 * Run it once, just before real use:
 *   pnpm --filter @reimsys/api data:clear -- --confirm <database name>
 * The database name must be typed so this can never be run against the wrong system by accident. Make a backup first (docs/BACKUP.md).
 */
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/db.js';
import { config } from '../src/config.js';

const confirmIdx = process.argv.indexOf('--confirm');
const typed = confirmIdx > 0 ? process.argv[confirmIdx + 1] : undefined;
const dbName = new URL(process.env.DATABASE_URL ?? '').pathname.slice(1);
// Tables holding receipts and what hangs off them. User-facing setup tables are not in this list.
const TABLES = ['comment', 'notification', 'emaillog', 'job', 'importjob', 'liquidationreport', 'payment', 'reimbursementdocument', 'receiptevidence', 'receipt', 'auditlog', 'session', 'passwordtoken', 'sequence'];
const FOLDERS = ['evidence', 'documents', 'proofs', 'reports'];

async function main() {
  if (typed !== dbName) {
    console.error(`Stopped. To clear the test data of database "${dbName}", run again with:  --confirm ${dbName}\nMake a backup first (node scripts/backup.mjs).`);
    process.exitCode = 1;
    return;
  }
  const before = await prisma.receipt.count();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=0');
    for (const t of TABLES) await tx.$executeRawUnsafe(`TRUNCATE TABLE \`${t}\``);
    await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=1');
  });
  const root = config.storageDir;
  let files = 0;
  for (const f of FOLDERS) {
    const dir = path.join(root, f);
    if (!fs.existsSync(dir)) continue;
    for (const e of fs.readdirSync(dir)) { files++; fs.rmSync(path.join(dir, e), { recursive: true, force: true }); }
  }
  await prisma.auditLog.create({ data: { actorName: 'System', action: 'system.data_cleared', entityType: 'system', summary: `cleared ${before} test receipts` } });
  console.log(`Cleared ${before} receipts and everything attached to them, and ${files} stored files/folders. Everyone is signed out.`);
}

main().finally(() => prisma.$disconnect());
