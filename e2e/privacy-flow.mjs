// Checks the privacy notice step against a running API (http://localhost:4000).
// A new person must change the temporary password, then accept the notice, before anything else works. It is audited.
// Usage: node e2e/privacy-flow.mjs
const BASE = process.env.API ?? 'http://localhost:4000/api';
let failed = 0;
const check = (name, cond, extra = '') => { if (cond) console.log('  ok  ', name); else { failed++; console.log('  FAIL', name, extra); } };

class Client {
  constructor() { this.cookie = ''; }
  async req(method, path, body) {
    const headers = { 'x-requested-with': 'reimsys', cookie: this.cookie };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  }
  get(p) { return this.req('GET', p); }
  post(p, b) { return this.req('POST', p, b ?? {}); }
}

const admin = new Client();
const login = await admin.post('/auth/login', { email: 'admin@example.com', password: 'Reimsys#2026' });
check('administrator signs in without the notice (demo accounts start accepted)', login.status === 200 && login.data.user.privacyRequired === false);

const roles = (await admin.get('/roles')).data.roles;
const email = `privacy.${Date.now()}@example.com`;
const made = await admin.post('/users', { name: 'Privacy Tester', email, roleId: roles.find((r) => r.code === 'medref').id });
check('administrator creates a new person', made.status === 201, JSON.stringify(made.data));

const p = new Client();
const first = await p.post('/auth/login', { email, password: made.data.temporaryPassword });
check('new person signs in with the temporary password', first.status === 200 && first.data.user.mustChangePassword === true && first.data.user.privacyRequired === true);
check('the password comes first: accepting is refused until it is changed', (await p.post('/me/privacy')).data?.error?.code === 'PASSWORD_CHANGE_REQUIRED');

const NEW_PW = 'PrivacyTest-12345';
const changed = await p.post('/me/password', { currentPassword: made.data.temporaryPassword, newPassword: NEW_PW });
check('password changed', changed.status === 200 && changed.data.user.mustChangePassword === false && changed.data.user.privacyRequired === true, JSON.stringify(changed.data));

for (const path of ['/receipts', '/dashboard', '/notifications', '/categories', '/events']) {
  const r = await p.get(path);
  check(`${path} is blocked until the notice is accepted`, r.status === 403 && r.data?.error?.code === 'PRIVACY_REQUIRED', r.status);
}
check('/me still works, so the app can show the notice', (await p.get('/me')).status === 200);

const accepted = await p.post('/me/privacy');
check('accepting works', accepted.status === 200 && accepted.data.user.privacyRequired === false, JSON.stringify(accepted.data));
check('receipts open after accepting', (await p.get('/receipts')).status === 200);
check('accepting twice is harmless', (await p.post('/me/privacy')).status === 200);

const audit = await admin.get('/audit?q=privacy.accepted');
const rows = audit.data?.items ?? audit.data?.rows ?? [];
check('acceptance is in the history log', rows.some((r) => r.action === 'privacy.accepted' && r.actorName === 'Privacy Tester'), JSON.stringify(audit.data).slice(0, 200));

const again = new Client();
const relogin = await again.post('/auth/login', { email, password: NEW_PW });
check('signing in again does not ask again', relogin.status === 200 && relogin.data.user.privacyRequired === false);

check('the sign-in page never needs the notice (not signed in = 401, not 403)', (await new Client().get('/receipts')).status === 401);

await admin.post('/auth/logout');
console.log(failed ? `\n${failed} FAILED` : '\nAll privacy checks passed.');
process.exit(failed ? 1 : 0);
