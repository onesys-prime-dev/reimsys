// Puts saved settings back exactly as backed up. Uses hex so no character can be mangled on the way.
// Usage: node e2e/restore-settings.mjs <mail-backup.json> [templates-backup.txt]
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const sql = (q) => execFileSync('C:/xampp/mysql/bin/mysql.exe', ['-u', 'root', 'reimsys', '-N', '-B', '-e', q], { encoding: 'utf8' });
const hex = (s) => Buffer.from(s, 'utf8').toString('hex');
const put = (key, value) => sql(`INSERT INTO Setting (\`key\`, value, updatedAt) VALUES ('${key}', CONVERT(UNHEX('${hex(value)}') USING utf8mb4), NOW()) ON DUPLICATE KEY UPDATE value=VALUES(value)`);

const [mailFile, tplFile] = process.argv.slice(2);
const mail = fs.readFileSync(mailFile, 'utf8').trim();
put('mail', mail);
const got = sql("SELECT value FROM Setting WHERE `key`='mail'").trim();
console.log(got === mail ? 'RESTORED: the saved mail account is identical to the backup' : 'MISMATCH: restore failed');

const tpl = tplFile && fs.existsSync(tplFile) ? fs.readFileSync(tplFile, 'utf8').trim() : '';
console.log('custom email templates or branding before the tests:', tpl ? 'yes, restoring' : 'none');
for (const line of tpl ? tpl.split('\n') : []) {
  const [k, ...v] = line.split('\t');
  put(k, v.join('\t'));
}
process.exit(got === mail ? 0 : 1);
