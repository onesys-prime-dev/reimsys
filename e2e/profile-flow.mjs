// Checks every function on the Profile page against a running API (4000): details, photo, password, devices, notification choices, theme, my access, activity.
// It makes its own test user, so no demo account is changed. Usage: node e2e/profile-flow.mjs
const B = process.env.API ?? 'http://localhost:4000/api';
let failed = 0, passed = 0;
const check = (n, c, x = '') => { if (c) { passed++; console.log('  ok  ', n); } else { failed++; console.log('  FAIL', n, x); } };
class C {
  constructor() { this.cookie = ''; }
  async req(m, p, body, raw) {
    const headers = { 'x-requested-with': 'reimsys', cookie: this.cookie };
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const r = await fetch(B + p, { method: m, headers, body: payload });
    const s = r.headers.get('set-cookie');
    if (s) this.cookie = s.split(';')[0];
    if (raw) return r;
    return { s: r.status, d: await r.json().catch(() => null) };
  }
  get(p) { return this.req('GET', p); }
  post(p, b) { return this.req('POST', p, b ?? {}); }
}
const login = async (email, password) => { const c = new C(); const r = await c.post('/auth/login', { email, password }); return { c, s: r.s }; };

const admin = (await login('admin@example.com', 'Reimsys#2026')).c;
const roles = (await admin.get('/roles')).d.roles;
const email = `profile.${Date.now()}@example.com`;
const made = await admin.post('/users', { name: 'Profile Tester', email, roleId: roles.find((r) => r.code === 'medref').id });
const TEMP = made.d.temporaryPassword;
const PW1 = 'Profile-Test-1234', PW2 = 'Profile-Test-5678';
const u = (await login(email, TEMP)).c;
await u.post('/me/password', { currentPassword: TEMP, newPassword: PW1 });
await u.post('/me/privacy');

/* details */
let r = await u.req('PATCH', '/me', { name: 'Profile Tester Two', phone: '0917 000 1111', branch: 'Cebu North' });
check('details save', r.s === 200 && r.d.user.name === 'Profile Tester Two' && r.d.user.phone === '0917 000 1111' && r.d.user.branch === 'Cebu North');
r = await u.req('PATCH', '/me', { name: 'Profile Tester Two', phone: null, branch: null });
check('phone and branch can be cleared', r.s === 200 && r.d.user.phone === null && r.d.user.branch === null);
check('a one-letter name is refused', (await u.req('PATCH', '/me', { name: 'A' })).s === 400);
check('an over-long phone number is refused', (await u.req('PATCH', '/me', { name: 'Profile Tester', phone: '1'.repeat(40) })).s === 400);
check('the email cannot be changed here', (await u.req('PATCH', '/me', { name: 'Profile Tester Two', email: 'hacker@example.com' })).d?.user?.email === email);

/* photo */
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const photo = (type, buf, name) => { const f = new FormData(); f.append('photo', new Blob([buf], { type }), name); return u.req('POST', '/me/photo', f); };
r = await photo('image/png', png, 'p.png');
check('a PNG photo is accepted', r.s === 200 && r.d.user.hasPhoto === true && Number.isInteger(r.d.user.photoV), JSON.stringify(r.d));
const v1 = r.d.user.photoV;
await new Promise((x) => setTimeout(x, 15));
r = await photo('image/png', png, 'p2.png');
check('a second photo gets a new version number', r.s === 200 && r.d.user.photoV > v1);
const img = await u.req('GET', `/users/${r.d.user.id}/photo`, undefined, true);
check('the photo can be fetched', img.status === 200 && (img.headers.get('content-type') ?? '').startsWith('image/'));
check('the photo can be removed', await (async () => { const rm = await u.req('DELETE', '/me/photo'); return rm.s === 200 && rm.d.user.hasPhoto === false && rm.d.user.photoV === null; })());
check('after removing it there is no photo to fetch', (await u.req('GET', `/users/${r.d.user.id}/photo`, undefined, true)).status === 404);
check('removing a photo that is not there is refused politely', (await u.req('DELETE', '/me/photo')).s === 404);
r = await photo('image/png', png, 'p3.png');
check('a new photo can be added again after removing', r.s === 200 && r.d.user.hasPhoto === true);
check('a text file is refused as a photo', (await photo('text/plain', Buffer.from('hello'), 'x.txt')).s === 400);
const big = await photo('image/png', Buffer.alloc(Math.round(2.5 * 1024 * 1024), 1), 'big.png');
check(`a photo over 2 MB is refused with a clear message (status ${big.s}: ${(big.d?.error?.message ?? '').slice(0, 70)})`, big.s >= 400 && big.s < 500 && !!big.d?.error?.message, JSON.stringify(big.d));

/* notification choices */
r = await u.req('PATCH', '/me/preferences', { dailyDigest: false, reservationReleased: true });
check('notification choices save', r.s === 200 && r.d.user.prefs.dailyDigest === false && r.d.user.prefs.reservationReleased === true);
r = await u.req('PATCH', '/me/preferences', { dailyDigest: true });
check('a single choice can change on its own', r.d.user.prefs.dailyDigest === true && r.d.user.prefs.reservationReleased === true);

/* theme */
for (const t of ['dark', 'system', 'light']) { r = await u.req('PATCH', '/me/preferences', { theme: t }); check(`theme ${t} saves`, r.s === 200 && r.d.user.theme === t); }
check('an unknown theme is refused', (await u.req('PATCH', '/me/preferences', { theme: 'neon' })).s === 400);
await u.req('PATCH', '/me/preferences', { theme: 'dark' });
const again = (await login(email, PW1)).c;
check('the theme survives signing in again', (await again.get('/me')).d.user.theme === 'dark');

/* devices */
const second = (await login(email, PW1)).c;
const list = (await u.get('/me/sessions')).d.sessions;
check('devices list shows this device and the other ones', list.length >= 2 && list.filter((s) => s.current).length === 1);
const other = list.find((s) => !s.current);
check('another device can be signed out', (await u.req('DELETE', `/me/sessions/${other.id}`)).s === 200);
check('this device is still signed in', (await u.get('/me')).s === 200);
check('an unknown device id gives not found', (await u.req('DELETE', '/me/sessions/nope')).s === 404);
const adm = await login('admin@example.com', 'Reimsys#2026');
const adminSession = (await adm.c.get('/me/sessions')).d.sessions[0].id;
check("someone else's device cannot be signed out", (await u.req('DELETE', `/me/sessions/${adminSession}`)).s === 404);
void second;

/* password */
check('wrong current password is refused', (await u.post('/me/password', { currentPassword: 'wrong-wrong-1', newPassword: PW2 })).d?.error?.code === 'WRONG_PASSWORD');
check('the same password again is refused', (await u.post('/me/password', { currentPassword: PW1, newPassword: PW1 })).d?.error?.code === 'SAME_PASSWORD');
check('a weak password is refused', (await u.post('/me/password', { currentPassword: PW1, newPassword: 'short1' })).s === 400);
const third = (await login(email, PW1)).c;
r = await u.post('/me/password', { currentPassword: PW1, newPassword: PW2 });
check('the password changes', r.s === 200);
check('this device stays signed in', (await u.get('/me')).s === 200);
check('other devices are signed out by a password change', (await third.get('/me')).s === 401);
check('the new password works and the old one does not', (await login(email, PW2)).s === 200 && (await login(email, PW1)).s === 401);

/* my access */
const me = (await u.get('/me')).d;
check('My access lists the Med Ref rights and not the admin ones', me.permissions.includes('receipt.create') && !me.permissions.includes('user.manage'));

/* activity */
const act = (await u.get('/me/activity')).d.items;
check('Activity shows my own recent actions', act.length > 0 && act.some((a) => a.action === 'profile.updated') && act.some((a) => a.action === 'profile.photo_changed') && act.some((a) => a.action === 'profile.photo_removed') && act.some((a) => a.action === 'auth.password_changed'));

// tidy up: switch the test user off
const id = (await admin.get('/users?active=true')).d.users.find((x) => x.email === email)?.id;
if (id) await admin.req('PATCH', `/users/${id}`, { isActive: false });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
