const B = 'http://localhost:4000/api';
const H = (c) => ({ cookie: c, 'x-requested-with': 'reimsis', 'content-type': 'application/json', origin: 'http://localhost:4000' });
const login = async (e) => (await fetch(B + '/auth/login', { method: 'POST', headers: H(''), body: JSON.stringify({ email: e, password: 'Reimsis#2026' }) })).headers.get('set-cookie').split(';')[0];
const get = async (c, p) => (await fetch(B + p, { headers: H(c) })).json();
const post = async (c, p, b) => (await fetch(B + p, { method: 'POST', headers: H(c), body: JSON.stringify(b) })).json();
let bad = 0; const ok = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, x); if (!c) bad++; };
const paolo = await login('paolo.v@example.com'), ana = await login('ana.reyes@example.com'), mark = await login('mark.dc@example.com');
const q = 'from=2026-10-01&to=2026-10-31';
const people = (await get(paolo, '/receipts/encoders')).people;
ok('approver can pick from the people who have receipts', people.length >= 1, JSON.stringify(people.map((p) => p.name)));
const all = await get(paolo, `/reports/preview?${q}`);
let sum = 0, cnt = 0;
for (const p of people) { const r = await get(paolo, `/reports/preview?${q}&encoderId=${p.id}`); sum += r.total; cnt += r.count; console.log('   ', p.name, r.count, r.total); }
ok('per-person counts add up to the everyone total', cnt === all.count && Math.abs(sum - all.total) < 0.01, `${cnt}/${all.count} ${sum.toFixed(2)}/${all.total}`);
const anaId = people.find((p) => p.name === 'Ana Reyes').id;
const rep = (await post(paolo, '/reports', { from: '2026-10-01', to: '2026-10-31', format: 'xlsx', encoderId: anaId })).report;
let list; for (let i = 0; i < 20; i++) { list = (await get(paolo, '/reports')).reports.find((r) => r.id === rep.id); if (list.status !== 'pending') break; await new Promise((r) => setTimeout(r, 500)); }
ok('report remembers the person', list.person === 'Ana Reyes' && list.status === 'ready', JSON.stringify({ person: list.person, status: list.status }));
const data = await get(paolo, `/reports/${rep.id}/data`);
ok('report rows are only that person', data.rows.length > 0 && data.rows.every((r) => r.encoder === 'Ana Reyes'));
ok('view includes the person name', data.report.person === 'Ana Reyes');
const f = await fetch(`${B}/reports/${rep.id}/file`, { headers: H(paolo) });
ok('download file name carries the person', /ana-reyes/.test(f.headers.get('content-disposition') ?? ''), f.headers.get('content-disposition'));
// a Med Ref can never see anyone else's records by asking for them
const sneaky = await get(ana, `/reports/preview?${q}&encoderId=${people.find((p) => p.name !== 'Ana Reyes')?.id ?? 2}`);
ok('a Med Ref asking for someone else gets nothing', sneaky.count === 0, JSON.stringify(sneaky));
const myPeople = (await get(mark, '/receipts/encoders')).people;
ok('a Med Ref only ever sees themselves in the list', myPeople.length <= 1 && myPeople.every((p) => p.name === 'Mark Dela Cruz'), JSON.stringify(myPeople));
process.exit(bad ? 1 : 0);
