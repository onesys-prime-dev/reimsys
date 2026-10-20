// Monitoring: run it every few minutes from cron / Task Scheduler. Prints nothing when all is well, exits 1 and prints the problem otherwise.
//   node scripts/healthcheck.mjs [--url https://reimsys.example.com] [--webhook https://hooks.example/...]
// Checks: /api/health answers, free disk space (HEALTH_MIN_FREE_GB, default 2), the newest backup is under 30 hours old, and email jobs are not piling up.
// With --webhook (or HEALTH_WEBHOOK) a failure is also POSTed as {"text": "..."} (works with Slack, Teams, Discord-compatible hooks, ntfy.sh).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, readEnv, dbConfig, tool, connArgs, withPassword } from './backup-lib.mjs';

const env = readEnv();
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const url = (arg('--url', env.HEALTH_URL) ?? `http://localhost:${env.PORT ?? 4000}`).replace(/\/$/, '');
const hook = arg('--webhook', env.HEALTH_WEBHOOK);
const minFreeGb = Number(env.HEALTH_MIN_FREE_GB ?? 2);
const problems = [];

try {
  const r = await fetch(url + '/api/health', { signal: AbortSignal.timeout(8000) });
  if (!r.ok) problems.push(`The API answered HTTP ${r.status}.`);
} catch (e) { problems.push('The API did not answer: ' + e.message); }

try {
  const s = fs.statfsSync(root);
  const freeGb = (s.bavail * s.bsize) / 2 ** 30;
  if (freeGb < minFreeGb) problems.push(`Only ${freeGb.toFixed(1)} GB of disk space is free.`);
} catch { /* statfs not available */ }

const bdir = path.join(root, 'backups');
const newest = fs.existsSync(bdir) ? fs.readdirSync(bdir).filter((f) => fs.existsSync(path.join(bdir, f, 'database.sql'))).sort().at(-1) : null;
if (!newest) problems.push('There is no backup yet.');
else if ((Date.now() - fs.statSync(path.join(bdir, newest)).mtimeMs) / 3_600_000 > 30) problems.push(`The newest backup (${newest}) is more than 30 hours old.`);

const db = dbConfig(env);
const r = spawnSync(tool('mysql', env), [...connArgs(db), '-N', '-B', db.database, '-e', "select count(*) from emaillog where status = 'queued' and createdAt < now() - interval 30 minute"], { env: withPassword(env, db), encoding: 'utf8', timeout: 15000 });
if (r.status === 0 && Number(r.stdout.trim()) > 0) problems.push(`${r.stdout.trim()} email(s) have been waiting more than 30 minutes.`);

if (problems.length) {
  const text = `REIMSYS needs attention (${new Date().toISOString()}):\n- ` + problems.join('\n- ');
  console.error(text);
  if (hook) await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) }).catch(() => {});
  process.exit(1);
}
