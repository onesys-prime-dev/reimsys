// Tests that change saved settings (mail account, email wording, branding) must put them back exactly as they were,
// even if the test crashes. Call protectSettings() first thing; it restores on exit, and keeps a backup file too.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const KEYS = ['mail', 'email.templates', 'email.branding'];
const sql = (q) => execFileSync('C:/xampp/mysql/bin/mysql.exe', ['-u', 'root', 'reimsys', '-N', '-B', '-e', q], { encoding: 'utf8' }).trim();

export function protectSettings() {
  const list = KEYS.map((k) => `'${k}'`).join(',');
  const rows = sql(`SELECT \`key\`, HEX(value) FROM Setting WHERE \`key\` IN (${list})`).split('\n').filter(Boolean).map((l) => l.split('\t'));
  const file = path.join(os.tmpdir(), `reimsys-settings-backup-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(rows));
  const restore = () => {
    sql(`DELETE FROM Setting WHERE \`key\` IN (${list})`);
    for (const [key, hex] of rows) sql(`INSERT INTO Setting (\`key\`, value, updatedAt) VALUES ('${key}', CONVERT(UNHEX('${hex}') USING utf8mb4), UTC_TIMESTAMP())`);
    const now = sql(`SELECT \`key\`, HEX(value) FROM Setting WHERE \`key\` IN (${list})`).split('\n').filter(Boolean).map((l) => l.split('\t'));
    const same = JSON.stringify([...now].sort()) === JSON.stringify([...rows].sort());
    console.log(same ? `\nSaved settings (${rows.length}) restored exactly.` : `\nWARNING: saved settings differ from the backup. Backup file: ${file}`);
  };
  process.on('exit', restore);
  return { file, rows };
}
