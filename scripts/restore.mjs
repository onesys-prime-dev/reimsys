// Restores a backup made by backup.mjs.
// Usage: node scripts/restore.mjs <backup folder> --yes [--db <database name>] [--files <folder>]
// Without --db it REPLACES the live database, and without --files it replaces the live uploaded files. Stop the API first.
// To rehearse a restore, use a spare database and folder:  --db reimsys_restore_test --files C:\temp\restored-files
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readEnv, dbConfig, storageDir, tool, connArgs, withPassword } from './backup-lib.mjs';

const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const folder = process.argv[2] && !process.argv[2].startsWith('--') ? path.resolve(process.argv[2]) : null;
if (!folder || !fs.existsSync(path.join(folder, 'database.sql'))) { console.error('Give the backup folder, e.g.  node scripts/restore.mjs backups/20261016-020000 --yes'); process.exit(1); }
const env = readEnv();
const db = dbConfig(env, arg('--db'));
const files = arg('--files') ? path.resolve(arg('--files')) : storageDir(env);
const live = !arg('--db');
if (!process.argv.includes('--yes')) {
  console.error(`This would ${live ? 'REPLACE THE LIVE DATABASE' : 'overwrite database ' + db.database} and the files in ${files}.\nRun again with --yes to go ahead (stop the API first if this is the live system).`);
  process.exit(1);
}
const e = withPassword(env, db);
const mysql = tool('mysql', env);
const run = (args, input) => spawnSync(mysql, [...connArgs(db), '--default-character-set=utf8mb4', ...args], { env: e, input, encoding: 'utf8', maxBuffer: 1 << 28 });
let r = run(['-e', `DROP DATABASE IF EXISTS \`${db.database}\`; CREATE DATABASE \`${db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`]);
if (r.status !== 0) { console.error('Restore FAILED creating the database.\n' + r.stderr); process.exit(1); }
r = run([db.database], fs.readFileSync(path.join(folder, 'database.sql')));
if (r.status !== 0) { console.error('Restore FAILED loading the database.\n' + r.stderr); process.exit(1); }
const tgz = path.join(folder, 'files.tar.gz');
if (fs.existsSync(tgz)) {
  fs.rmSync(files, { recursive: true, force: true });
  fs.mkdirSync(files, { recursive: true });
  const t = spawnSync('tar', ['-xzf', 'files.tar.gz', '-C', files.split(path.sep).join('/')], { cwd: folder, encoding: 'utf8' });
  if (t.status !== 0) { console.error('Restore FAILED unpacking the files.\n' + t.stderr); process.exit(1); }
}
const count = run(['-N', '-B', '-e', `SELECT COUNT(*) FROM receipt`, db.database]).stdout.trim();
console.log(`Restored into database ${db.database} (${count} receipts) and ${files}.`);
