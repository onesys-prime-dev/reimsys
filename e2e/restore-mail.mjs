// Puts a saved mail account back exactly as it was from a backup file. Usage: node e2e/restore-mail.mjs <backup.json>
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const file = process.argv[2];
const value = fs.readFileSync(file, 'utf8').trim();
const j = JSON.parse(value); // refuse anything that is not valid JSON
console.log('backup holds:', j.host, '| user:', j.user, '| from:', j.fromAddress, '| encrypted password present:', !!j.passEnc, '| test mode:', JSON.stringify(j.testRedirect));
const esc = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const sql = (q) => execFileSync('C:/xampp/mysql/bin/mysql.exe', ['-u', 'root', 'reimsys', '-N', '-B', '-e', q], { encoding: 'utf8' }).trim();
sql(`REPLACE INTO Setting (\`key\`, value, updatedAt) VALUES ('mail', '${esc}', UTC_TIMESTAMP())`);
const after = sql("SELECT value FROM Setting WHERE `key`='mail'");
console.log(after === value ? 'RESTORED: the stored account is identical to the backup.' : 'MISMATCH: the stored value differs from the backup!');
process.exit(after === value ? 0 : 1);
