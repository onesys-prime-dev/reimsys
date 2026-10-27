// The reimbursement form's answers for a receipt with no BIR invoice: the shortest valid receipt.
const F = { birInvoice: false, vendorAddress: 'Test Street, Test City', reasonForSpending: 'Test receipt', classification: 'fuel', chargeLocationId: 1 };
// The live stream itself, without a browser. Usage: node e2e/realtime-api.mjs
const BASE = process.env.API ?? 'http://localhost:4000/api';
const ORIGIN = new URL(BASE).origin;
let bad = 0;
const ok = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : x); if (!c) bad++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const H = (c) => ({ cookie: c, 'x-requested-with': 'reimsys', origin: ORIGIN, 'content-type': 'application/json' });
const api = async (c, m, p, b) => { const r = await fetch(BASE + p, { method: m, headers: H(c), body: b ? JSON.stringify(b) : undefined }); return { status: r.status, data: await r.json().catch(() => null), cookie: r.headers.get('set-cookie')?.split(';')[0] }; };
const login = async (e, pw = 'Reimsys#2026') => (await api('', 'POST', '/auth/login', { email: e, password: pw })).cookie;

/** Opens the stream and collects what arrives. */
async function listen(cookie) {
  const ctrl = new AbortController();
  const res = await fetch(BASE + '/events', { headers: { cookie, accept: 'text/event-stream' }, signal: ctrl.signal });
  const got = { status: res.status, type: res.headers.get('content-type'), events: [], ended: false, raw: '' };
  if (res.status !== 200) return { ...got, live: got, close() {} };
  (async () => {
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true }); got.raw += dec.decode(value);
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(block)?.[1]; const data = /^data: (.+)$/m.exec(block)?.[1];
          if (ev) got.events.push({ ev, data: data ? JSON.parse(data) : null });
        }
      }
    } catch { /* aborted */ }
    got.ended = true;
  })();
  return { ...got, get live() { return got; }, close: () => ctrl.abort() };
}
const scopesOf = (l) => l.live.events.filter((e) => e.ev === 'change').flatMap((e) => e.data.scopes);
const waitFor = async (fn, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await sleep(100); } return false; };

console.log('Live stream');
const anon = await fetch(BASE + '/events');
ok('someone who is not signed in cannot listen', anon.status === 401);

const [ana, liza, paolo, admin] = await Promise.all(['ana.reyes@example.com', 'liza.santos@example.com', 'paolo.v@example.com', 'admin@example.com'].map((e) => login(e)));
const sAna = await listen(ana), sLiza = await listen(liza), sAdmin = await listen(admin);
ok('a signed-in person gets an event stream', sAna.status === 200 && /text\/event-stream/.test(sAna.type), `${sAna.status} ${sAna.type}`);
ok('it greets them so the browser knows it is live', await waitFor(() => sAna.live.events.some((e) => e.ev === 'hello')));

/* ---- a receipt change reaches the other people ---- */
const cat = (await api(ana, 'GET', '/categories')).data.categories[0].id;
const stamp = Date.now();
const made = (await api(ana, 'POST', '/receipts', { payee: 'Live Test ' + stamp, receiptDate: '2026-10-11', amount: 12, ...F })).data.receipt;
ok('creating a receipt announces a receipts change to others', await waitFor(() => scopesOf(sLiza).includes('receipts')), JSON.stringify(sLiza.live.events));
ok('and to the person who did it', scopesOf(sAna).includes('receipts'));
const first = sLiza.live.events.filter((e) => e.ev === 'change')[0];
ok('the signal names an area and carries no receipt details', !!first && Object.keys(first.data).join() === 'scopes' && !/Live Test|payee|12/.test(JSON.stringify(first)), JSON.stringify(first));

/* ---- many writes at once are sent as one tidy signal ---- */
const before = sLiza.live.events.filter((e) => e.ev === 'change').length;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const f = new FormData(); f.append('files', new Blob([Buffer.concat([PNG, Buffer.from('l' + stamp)])], { type: 'image/png' }), 'a.png');
await fetch(`${BASE}/receipts/${made.id}/evidence`, { method: 'POST', headers: { cookie: ana, 'x-requested-with': 'reimsys', origin: ORIGIN }, body: f });
await api(ana, 'POST', `/receipts/${made.id}/submit`, { version: (await api(ana, 'GET', `/receipts/${made.id}`)).data.receipt.version });
await sleep(1200);
const after = sLiza.live.events.filter((e) => e.ev === 'change').length;
ok('an action that touches several tables is announced in a handful of signals, not dozens', after - before >= 1 && after - before <= 4, `${after - before} signals`);

/* ---- notifications go only to the person they are for ---- */
const lizaNotes = scopesOf(sLiza).filter((s) => s === 'notifications').length;
ok('the checker is told, live, that a receipt is waiting', lizaNotes >= 1);
const anaNotesBefore = scopesOf(sAna).filter((s) => s === 'notifications').length;
await api(liza, 'POST', '/notifications/read', {});
await sleep(900);
ok('someone marking their own bell as read does not make other people refresh theirs', scopesOf(sAna).filter((s) => s === 'notifications').length === anaNotesBefore);

/* ---- signing in is not news ---- */
const accessBefore = scopesOf(sAdmin).filter((s) => s === 'access').length;
await login('mark.dc@example.com');
await sleep(900);
ok('an ordinary sign-in does not make everyone reload the user list', scopesOf(sAdmin).filter((s) => s === 'access').length === accessBefore);

/* ---- admin changes are announced ---- */
const roles = (await api(admin, 'GET', '/roles')).data.roles;
const created = await api(admin, 'POST', '/users', { name: 'Live Tester', email: `live.${stamp}@example.com`, roleId: roles.find((r) => r.code === 'medref').id });
ok('creating a user is announced to the administrator', await waitFor(() => scopesOf(sAdmin).filter((s) => s === 'access').length > accessBefore));
const ptemp = created.data.temporaryPassword;
const blocked = await listen(await login(`live.${stamp}@example.com`, ptemp));
ok('a new person must choose their own password before anything live starts', blocked.status === 403);
const newCookie = await login(`live.${stamp}@example.com`, ptemp);
await api(newCookie, 'POST', '/me/password', { currentPassword: ptemp, newPassword: 'LiveTest12345' });
await api(newCookie, 'POST', '/me/privacy', {});
const sNew = await listen(await login(`live.${stamp}@example.com`, 'LiveTest12345'));
ok('after that the new person can listen too', sNew.status === 200);
await sleep(300);
await api(admin, 'PATCH', `/users/${created.data.user.id}`, { isActive: false });
ok('switching someone off closes their live connection straight away', await waitFor(() => sNew.live.ended, 4000));
ok('and they cannot open a new one', (await listen(newCookie)).status === 401);

/* ---- the connection stays alive while quiet ---- */
console.log('  (waiting 22 seconds for a keep-alive beat…)');
await sleep(22000);
ok('a quiet connection is kept alive with a heartbeat', /: ping/.test(sAna.live.raw));

/* ---- someone with too many tabs cannot flood the server ---- */
const extra = []; for (let i = 0; i < 13; i++) extra.push(await listen(paolo));
await sleep(600);
const alive = extra.filter((s) => !s.live.ended).length;
ok('a person can keep at most 10 live connections open', alive <= 10, `${alive} open`);
extra.forEach((s) => s.close());

[sAna, sLiza, sAdmin, sNew].forEach((s) => s.close());
await api(admin, 'PATCH', `/users/${created.data.user.id}`, { isActive: false });
await api(ana, 'DELETE', `/receipts/${made.id}`).catch(() => null);
console.log(bad ? `\n${bad} FAILED` : '\nAll live-stream checks passed');
process.exit(bad ? 1 : 0);
