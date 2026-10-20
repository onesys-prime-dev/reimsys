// Gives REIMSYS its own limited database login instead of "root". Run it once, on the computer that holds the database.
//   node scripts/setup-db-users.mjs          shows what it would do and changes nothing
//   node scripts/setup-db-users.mjs --yes    does it
// It creates two MySQL users with new random passwords:
//   reimsys_app      what the running system uses; it can read and append to the history log but never change or delete it (docs/db-grants.sql)
//   reimsys_migrate  full rights on the reimsys database (and on a spare reimsys_restore_test one); for migrations, the seed, data:clear, backups and restores only
// Then it saves the old apps/api/.env next to it as .env.before-app-user, points DATABASE_URL at reimsys_app and adds MIGRATE_DATABASE_URL.
// The passwords are never printed. Restart the API afterwards. To go back, copy .env.before-app-user over .env.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, readEnv, dbConfig, tool, connArgs, withPassword } from './backup-lib.mjs';

const yes = process.argv.includes('--yes');
const envFile = path.join(root, 'apps', 'api', '.env');
const env = readEnv();
const db = dbConfig(env);
if (db.user !== 'root') { console.log(`DATABASE_URL already uses "${db.user}", not root. Nothing to do.`); process.exit(0); }

const grants = fs.readFileSync(path.join(root, 'docs', 'db-grants.sql'), 'utf8');
const pw = () => crypto.randomBytes(24).toString('base64url');
const appPw = pw(), migPw = pw();

console.log(`Database "${db.database}" on ${db.host}:${db.port}, now used as "root".`);
console.log('Would create reimsys_app (limited) and reimsys_migrate (full rights on this database), with new random passwords,');
console.log(`back up ${envFile} as .env.before-app-user, and point the system at reimsys_app.`);
if (!yes) { console.log('\nNothing was changed. Run again with --yes to do it.'); process.exit(0); }

const sql = [
  `CREATE USER IF NOT EXISTS 'reimsys_migrate'@'localhost' IDENTIFIED BY '${migPw}';`,
  `ALTER USER 'reimsys_migrate'@'localhost' IDENTIFIED BY '${migPw}';`,
  `GRANT ALL ON \`${db.database}\`.* TO 'reimsys_migrate'@'localhost';`,
  `GRANT ALL ON \`${db.database}\\_restore\\_test\`.* TO 'reimsys_migrate'@'localhost';`, // lets restore.mjs rehearse a restore into a spare database
  grants.replace('CHANGE_ME_STRONG_PASSWORD', appPw).replaceAll('reimsys.', `\`${db.database}\`.`),
  `ALTER USER 'reimsys_app'@'localhost' IDENTIFIED BY '${appPw}';`,
  'FLUSH PRIVILEGES;',
].join('\n');
const r = spawnSync(tool('mysql', env), [...connArgs(db)], { env: withPassword(env, db), input: sql, encoding: 'utf8' });
if (r.status !== 0) { console.error('Stopped: MySQL refused.\n' + (r.stderr || '').replace(new RegExp(`${appPw}|${migPw}`, 'g'), '***')); process.exit(1); }

fs.copyFileSync(envFile, path.join(path.dirname(envFile), '.env.before-app-user'));
let text = fs.readFileSync(envFile, 'utf8');
const url = (u, p) => `mysql://${u}:${p}@${db.host}:${db.port}/${db.database}`;
text = /^DATABASE_URL=.*$/m.test(text) ? text.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL="${url('reimsys_app', appPw)}"`) : text + `\nDATABASE_URL="${url('reimsys_app', appPw)}"\n`;
text = text.replace(/^MIGRATE_DATABASE_URL=.*\r?\n?/m, '') + (text.endsWith('\n') ? '' : '\n') + `MIGRATE_DATABASE_URL="${url('reimsys_migrate', migPw)}"\n`;
fs.writeFileSync(envFile, text);
console.log('Done. The system now uses reimsys_app. Restart the API (stop `pnpm dev` and start it again).');
console.log('For migrations, the seed and data:clear, run them with the other login, for example (PowerShell):');
console.log('  $env:DATABASE_URL = (Select-String -Path apps/api/.env -Pattern "^MIGRATE_DATABASE_URL=").Line.Split("=",2)[1].Trim(\'"\'); pnpm --filter @reimsys/api data:clear -- --confirm reimsys');
