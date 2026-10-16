// Shared by backup.mjs and restore.mjs: reads apps/api/.env and finds the MySQL tools.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = path.join(root, 'apps', 'api');

export function readEnv() {
  const env = { ...process.env };
  try {
    for (const line of fs.readFileSync(path.join(apiDir, '.env'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?(.*?)"?\s*$/);
      if (m && env[m[1]] === undefined) env[m[1]] = m[2];
    }
  } catch { /* no .env: rely on the real environment */ }
  return env;
}

export function dbConfig(env, dbOverride) {
  const u = new URL(env.DATABASE_URL ?? 'mysql://root:@localhost:3306/reimsys');
  return { host: u.hostname, port: u.port || '3306', user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: dbOverride ?? u.pathname.slice(1) };
}

export function storageDir(env) {
  return path.resolve(apiDir, env.STORAGE_DIR ?? './storage');
}

/** Finds mysqldump / mysql: MYSQL_BIN folder, then the XAMPP folder, then the PATH. */
export function tool(name, env) {
  const exe = process.platform === 'win32' ? name + '.exe' : name;
  for (const dir of [env.MYSQL_BIN, 'C:/xampp/mysql/bin', '/opt/lampp/bin', '/usr/bin']) {
    if (dir && fs.existsSync(path.join(dir, exe))) return path.join(dir, exe);
  }
  return name;
}

export const connArgs = (c) => [`--host=${c.host}`, `--port=${c.port}`, `--user=${c.user}`];
export const withPassword = (env, c) => ({ ...env, ...(c.password ? { MYSQL_PWD: c.password } : {}) });
