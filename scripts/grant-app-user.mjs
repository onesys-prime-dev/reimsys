// Makes sure the system's limited database login (reimsys_app) can use every table, including ones added by later updates.
// A migration adds the table, but MySQL gives the limited login no rights on it until someone grants them, and the system then fails on that screen
// (drafts, email schedules, where to charge...). This finds the tables with no rights and says exactly what to run.
//
//   node scripts/grant-app-user.mjs --check               as the system's own login: lists the tables it cannot reach. Changes nothing. Exit 1 if any.
//   node scripts/grant-app-user.mjs                       shows the GRANT lines that are needed. Changes nothing.
//   node scripts/grant-app-user.mjs --yes --admin root    applies them. Needs a MySQL administrator who may grant rights (not reimsys_migrate).
//                                                         The administrator's password, if it has one, goes in MYSQL_ADMIN_PASSWORD.
//
// The payment and history (audit) tables are append-only for the system, as in docs/db-grants.sql; every other table is read and write.
import { spawnSync } from 'node:child_process';
import { readEnv, adminDbConfig, dbConfig, tool, connArgs } from './backup-lib.mjs';

const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const has = (n) => process.argv.includes(n);
const env = readEnv();
const app = dbConfig(env);
const owner = adminDbConfig(env);
const APPEND_ONLY = new Set(['payment', 'auditlog']);
const SKIP = new Set(['_prisma_migrations']);

const run = (c, sql, password) => spawnSync(tool('mysql', env), [...connArgs(c), '-N', '-B', c.database, '-e', sql], { env: { ...env, ...(password ? { MYSQL_PWD: password } : {}) }, encoding: 'utf8' });

const listed = run(owner, 'SHOW TABLES;', owner.password);
if (listed.status !== 0) { console.error('Could not list the tables.\n' + (listed.stderr || '')); process.exit(2); }
const tables = listed.stdout.split('\n').map((t) => t.trim()).filter((t) => t && !SKIP.has(t));

if (has('--check')) {
  const missing = tables.filter((t) => run(app, `SELECT 1 FROM \`${t}\` LIMIT 1;`, app.password).status !== 0);
  if (!missing.length) { console.log(`Database rights: "${app.user}" can reach all ${tables.length} tables.`); process.exit(0); }
  console.log(`Database rights: "${app.user}" cannot reach ${missing.length} table${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}.`);
  console.log('Those screens will fail until a MySQL administrator runs:  node scripts/grant-app-user.mjs --yes --admin root');
  console.log('or these lines:');
  for (const t of missing) console.log('  ' + grantLine(t));
  process.exit(1);
}

function grantLine(t) { return `GRANT SELECT, INSERT${APPEND_ONLY.has(t) ? '' : ', UPDATE, DELETE'} ON \`${app.database}\`.\`${t}\` TO '${app.user}'@'localhost';`; }

const lines = tables.map(grantLine);
console.log(`Database "${app.database}": ${tables.length} tables. These grants make sure "${app.user}" can use every one (granting again changes nothing):\n`);
console.log(lines.join('\n'));
if (!has('--yes')) { console.log('\nNothing was changed. Run again with --yes --admin <administrator> to apply them.'); process.exit(0); }
const adminUser = arg('--admin');
if (!adminUser) { console.error('\nSay which MySQL administrator to use: --admin root'); process.exit(2); }
const r = run({ ...owner, user: adminUser }, lines.join('\n') + '\nFLUSH PRIVILEGES;', process.env.MYSQL_ADMIN_PASSWORD ?? '');
if (r.status !== 0) { console.error('\nMySQL refused.\n' + (r.stderr || '') + '\nThe administrator needs the right to grant rights (reimsys_migrate does not have it; root does).'); process.exit(1); }
console.log(`\nDone. "${app.user}" now has rights on all ${tables.length} tables. No restart is needed.`);
