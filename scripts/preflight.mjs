// Go-live check. Run it on the server, in the folder of the app:  node scripts/preflight.mjs
// It reads apps/api/.env and the database and lists what is still not ready for real use. It changes nothing.
// Exit code 0 = nothing blocking, 1 = at least one blocker.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, readEnv, dbConfig, tool, connArgs, withPassword } from './backup-lib.mjs';

const env = readEnv();
const results = [];
const add = (level, name, detail = '') => results.push({ level, name, detail });
const blocker = (c, name, detail) => add(c ? 'ok' : 'BLOCKER', name, c ? '' : detail);
const advice = (c, name, detail) => add(c ? 'ok' : 'advice', name, c ? '' : detail);

// --- settings
blocker(env.NODE_ENV === 'production', 'NODE_ENV is production', 'Set NODE_ENV=production so the cookie is marked Secure and HSTS is on.');
const origin = (env.WEB_ORIGIN ?? '').split(',')[0].trim();
let host = '';
try { host = new URL(origin).hostname; } catch { /* checked below */ }
blocker(origin.startsWith('https://') && !/^(localhost|127\.|.*\.local$)/.test(host), 'WEB_ORIGIN is a real https address', `It is "${origin || 'empty'}". Use the public https address; emails and password links use it.`);
blocker(!!env.SMTP_HOST, 'SMTP is configured in .env (or saved in Settings → Email)', 'SMTP_HOST is empty. If the mail account is saved in the app, check Settings → Email instead; otherwise emails are only logged.');
blocker(!/@example\.com/.test(env.MAIL_FROM ?? 'x@example.com'), 'MAIL_FROM is a real address', `It is ${env.MAIL_FROM ?? 'the example default'}.`);
const tls = !!(env.TLS_CERT && env.TLS_KEY);
advice(tls || origin.startsWith('https://'), 'https is served by the app or by Nginx', 'Set TLS_CERT and TLS_KEY, or put Nginx with a certificate in front.');

// --- database
const db = dbConfig(env);
blocker(db.user !== 'root', 'The app does not use the database "root" login', 'Run node scripts/setup-db-users.mjs --yes (or follow docs/DEPLOY.md section 2).');
blocker(!!env.MIGRATE_DATABASE_URL || db.user !== 'root', 'A separate full-rights login exists for migrations and backups', 'MIGRATE_DATABASE_URL is missing.');
const q = (sql) => {
  const r = spawnSync(tool('mysql', env), [...connArgs(db), '-N', '-B', db.database, '-e', sql], { env: withPassword(env, db), encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
};
const rootOpen = spawnSync(tool('mysql', env), ['-uroot', '-N', '-e', 'select 1'], { encoding: 'utf8', timeout: 8000 });
advice(rootOpen.status !== 0, 'Database "root" cannot be used without a password', 'Give MySQL root a password (or remove remote/passwordless root).');
const demo = q("select count(*) from user where isActive=1 and email like '%@example.com'");
if (demo === null) add('BLOCKER', 'Database is reachable', 'Could not read the database with the app login.');
else {
  blocker(Number(demo) === 0, 'No demo accounts (@example.com) are active', `${demo} active account(s) use the public password. Create the real Super Admin, then run pnpm --filter @reimsys/api demo:off.`);
  const admins = q("select count(*) from user u join role r on r.id=u.roleId where u.isActive=1 and r.code='admin' and u.email not like '%@example.com'");
  blocker(Number(admins) >= 1, 'A real Super Admin exists', 'No active Super Admin with a real email.');
  const test = q('select count(*) from receipt');
  advice(Number(test) === 0, 'No receipts yet (test data cleared) or this is live', `${test} receipt(s) in the database. If these are test records, run data:clear before launch.`);
  const nopriv = q("select count(*) from user where isActive=1 and (privacyAcceptedVersion is null)");
  advice(true, `Users who have not accepted the privacy notice yet: ${nopriv}`, '');
}

// --- backups
const bdir = path.join(root, 'backups');
const folders = fs.existsSync(bdir) ? fs.readdirSync(bdir).filter((f) => fs.existsSync(path.join(bdir, f, 'database.sql'))).sort() : [];
const newest = folders.at(-1);
const ageH = newest ? (Date.now() - fs.statSync(path.join(bdir, newest)).mtimeMs) / 3_600_000 : Infinity;
blocker(ageH < 30, 'A backup from the last 30 hours exists', newest ? `The newest is ${Math.round(ageH)} hours old.` : 'No backup in backups/. Schedule scripts/backup.mjs nightly (docs/BACKUP.md).');
advice(!!env.BACKUP_COPY_TO, 'Backups are copied off the machine (BACKUP_COPY_TO is set)', 'Set BACKUP_COPY_TO in .env to another disk or synced folder, or copy backups elsewhere yourself.');

// --- the running app
try {
  const api = env.API_URL ?? `http://localhost:${env.PORT ?? 4000}`;
  const r = await fetch(api + '/api/health', { signal: AbortSignal.timeout(5000) });
  blocker(r.ok, 'The API answers /api/health', `HTTP ${r.status}`);
  const hsts = r.headers.get('strict-transport-security');
  advice(!!hsts, 'HSTS header is sent', 'Only sent in production mode.');
} catch (e) { add('BLOCKER', 'The API answers /api/health', 'Not reachable: ' + e.message); }

// --- report
const mark = { ok: 'ok     ', BLOCKER: 'BLOCKER', advice: 'advice ' };
for (const r of results) console.log(`${mark[r.level]}  ${r.name}${r.detail ? '\n         → ' + r.detail : ''}`);
const blockers = results.filter((r) => r.level === 'BLOCKER').length;
console.log(blockers ? `\n${blockers} blocker(s): not ready for production.` : '\nNo blockers. Review any advice above.');
process.exit(blockers ? 1 : 0);
