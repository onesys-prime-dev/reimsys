// Opening an address straight in the browser while not allowed shows a plain page, not raw JSON; the app and tools still get JSON.
// Needs the API (4000) and the seed applied.
import { B, H, call, checker, loginAll, makeDraft } from './payment-helpers.mjs';
const { ok, done } = checker();
const U = await loginAll();
const r = await makeDraft(U, 'ana', 'Friendly error', 99);
const url = `${B}/receipts/${r.id}/evidence/${r.evidence[0].id}/file?mode=download`;
const browser = { accept: 'text/html,application/xhtml+xml,*/*;q=0.8' };

const out = await fetch(url, { headers: browser });
const html = await out.text();
ok('signed out in a browser: 401 with a readable page', out.status === 401 && (out.headers.get('content-type') ?? '').includes('text/html') && html.includes('Please sign in') && !html.includes('"error"'), `${out.status}`);
ok('the page has a way back to sign in', html.includes('href="/"'));
ok('and it is not cached', out.headers.get('cache-control') === 'no-store');

const other = await fetch(url, { headers: { cookie: U.mark, ...browser } });
const otherHtml = await other.text();
ok('another Med Ref in a browser: 404 with a readable page', other.status === 404 && otherHtml.includes('not available') && !otherHtml.includes('"error"'), `${other.status}`);

const api = await fetch(url, { headers: { 'x-requested-with': 'reimsys', ...browser } });
ok('the app itself (x-requested-with) still gets JSON', api.status === 401 && (await api.json()).error?.code === 'UNAUTHORIZED');
const tool = await fetch(url);
ok('a tool with no browser headers still gets JSON', tool.status === 401 && (tool.headers.get('content-type') ?? '').includes('json'));
ok('the owner still gets the file', (await fetch(url, { headers: H(U.ana, false) })).status === 200);
done();
