// Backs up the database and the uploaded files into backups/<date-time>/. Run it every night (see docs/BACKUP.md).
// Usage: node scripts/backup.mjs [--keep 14] [--to D:\backups]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, readEnv, dbConfig, storageDir, tool, connArgs, withPassword } from './backup-lib.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const keep = Number(arg('--keep', 14));
const target = path.resolve(arg('--to', path.join(root, 'backups')));
const env = readEnv();
const db = dbConfig(env);
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const dir = path.join(target, stamp);
fs.mkdirSync(dir, { recursive: true });

const sqlFile = path.join(dir, 'database.sql');
const dump = spawnSync(tool('mysqldump', env), [...connArgs(db), '--single-transaction', '--routines', '--default-character-set=utf8mb4', '--result-file=' + sqlFile, db.database], { env: withPassword(env, db), encoding: 'utf8' });
if (dump.status !== 0 || !fs.existsSync(sqlFile) || fs.statSync(sqlFile).size < 1000) {
  console.error('Backup FAILED: the database could not be dumped.\n' + (dump.stderr || dump.error || ''));
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(1);
}

const files = storageDir(env);
let fileCount = 0;
if (fs.existsSync(files)) {
  const tar = spawnSync('tar', ['-czf', 'files.tar.gz', '-C', files.split(path.sep).join('/'), '.'], { cwd: dir, encoding: 'utf8' });
  if (tar.status !== 0) { console.error('Backup FAILED: the uploaded files could not be packed.\n' + (tar.stderr || tar.error || '')); fs.rmSync(dir, { recursive: true, force: true }); process.exit(1); }
  fileCount = Number(spawnSync('tar', ['-tzf', 'files.tar.gz'], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 28 }).stdout.split('\n').filter((l) => l && !l.endsWith('/')).length);
}
fs.writeFileSync(path.join(dir, 'about.json'), JSON.stringify({ made: new Date().toISOString(), database: db.database, sqlBytes: fs.statSync(sqlFile).size, files: fileCount }, null, 2));

// Keep the newest `keep` backups, delete older ones.
const all = fs.readdirSync(target).filter((n) => /^\d{8}-\d{6}$/.test(n)).sort();
for (const old of all.slice(0, Math.max(0, all.length - keep))) fs.rmSync(path.join(target, old), { recursive: true, force: true });
console.log(`Backup done: ${dir}\n  database ${(fs.statSync(sqlFile).size / 1024).toFixed(0)} KB, ${fileCount} uploaded files. Keeping the newest ${keep}.`);
