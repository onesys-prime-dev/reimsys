// A file that is in the database but no longer on the disk must give a clear "not found", never a server error (500). Needs the API (4000).
// Usage: node e2e/missing-file.mjs
import fs from 'node:fs';
import path from 'node:path';
import { call, loginAll, makeDraft, B, H } from './payment-helpers.mjs';

const U = await loginAll();
let failed = 0;
const ok = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : x); if (!c) failed++; };
const storage = path.resolve('apps/api/storage');

const r = await makeDraft(U, 'ana', 'Missing file ', 120);
const ev = r.evidence[0];
const url = `${B}/receipts/${r.id}/evidence/${ev.id}/file?mode=view`;
const get = (c) => fetch(url, { headers: H(c, false) });
ok('while the file is there it opens', (await get(U.ana)).status === 200);

// find the file on the disk and take it away
const dir = path.join(storage, 'evidence', String(r.id));
const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
const mine = files.find((f) => fs.statSync(path.join(dir, f)).mtimeMs > Date.now() - 120_000);
ok('found the stored file to remove', !!mine, files.join(','));
if (mine) fs.renameSync(path.join(dir, mine), path.join(dir, mine + '.hidden'));
const res = await get(U.ana);
const body = await res.json().catch(() => null);
ok('without the file the answer is "not found", not a server error', res.status === 404 && body?.error?.code === 'NOT_FOUND', `${res.status} ${JSON.stringify(body)}`);
ok('and it says what to do', /upload it again/i.test(body?.error?.message ?? ''), body?.error?.message);
ok('download and print behave the same', (await fetch(url.replace('mode=view', 'mode=download'), { headers: H(U.ana, false) })).status === 404);
ok('other people still get the usual answers (the Checker cannot open a draft)', [403, 404].includes((await get(U.liza)).status));
if (mine) fs.renameSync(path.join(dir, mine + '.hidden'), path.join(dir, mine));
ok('with the file back it opens again', (await get(U.ana)).status === 200);
await call(U.ana, 'DELETE', `/receipts/${r.id}`);

console.log(failed ? `\n${failed} FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
