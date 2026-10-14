import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { PERMISSIONS, type MeResponse } from '@reimsys/shared';
import { api, deviceName, errMsg, fmtDateTime } from '../api';
import { useAuth } from '../auth';
import { PasswordForm } from '../components/PasswordForm';
import { Avatar, Empty, Field, Icon, Switch, useToast } from '../ui';

const TABS = [['details', 'Details'], ['security', 'Security'], ['notify', 'Notifications'], ['access', 'My access'], ['look', 'Appearance'], ['activity', 'Activity']] as const;
type Tab = (typeof TABS)[number][0];

export function ProfilePage() {
  const { me } = useAuth();
  const [tab, setTab] = useState<Tab>('details');
  if (!me) return null;
  return (
    <>
      <div className="ph"><div><h1>Profile</h1><p>Your details, security and preferences.</p></div></div>
      <div className="tabs" role="tablist">
        {TABS.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>)}
      </div>
      {tab === 'details' && <Details />}
      {tab === 'security' && <Security />}
      {tab === 'notify' && <Notify />}
      {tab === 'access' && <MyAccess />}
      {tab === 'look' && <Look />}
      {tab === 'activity' && <Activity />}
    </>
  );
}

function Details() {
  const { me, setMe } = useAuth();
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(me!.name);
  const [phone, setPhone] = useState(me!.phone ?? '');
  const [branch, setBranch] = useState(me!.branch ?? '');
  const [ver, setVer] = useState(0);
  const save = useMutation({
    mutationFn: () => api<MeResponse>('/me', { method: 'PATCH', body: { name, phone: phone || null, branch: branch || null } }),
    onSuccess: (d) => { setMe(d); toast('Profile saved.'); },
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  const photo = useMutation({
    mutationFn: (f: File) => { const form = new FormData(); form.append('photo', f); return api<MeResponse>('/me/photo', { method: 'POST', form }); },
    onSuccess: (d) => { setMe(d); setVer((v) => v + 1); toast('Photo updated.'); },
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate(); };

  return (
    <section className="card">
      <form className="card-b" onSubmit={submit}>
        <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', marginBottom: 20 }}>
          <Avatar name={me!.name} userId={me!.id} hasPhoto={me!.hasPhoto} size={72} version={ver} />
          <div>
            <b style={{ fontSize: '1.1rem' }}>{me!.name}</b><br />
            <span className="muted">{me!.role.name}</span><br />
            <button type="button" className="btn sm" style={{ marginTop: 8 }} onClick={() => file.current?.click()}><Icon name="upload" size={16} />Change photo</button>
            <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" className="sr" onChange={(e) => { const f = e.target.files?.[0]; if (f) photo.mutate(f); e.target.value = ''; }} />
          </div>
        </div>
        <div className="form">
          <Field label="Full name"><input type="text" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} /></Field>
          <Field label="Email" hint="Set by the administrator"><input type="email" value={me!.email} disabled /></Field>
          <Field label="Phone"><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          <Field label="Branch"><input type="text" value={branch} onChange={(e) => setBranch(e.target.value)} /></Field>
        </div>
        <div className="formbar"><button className="btn pri" type="submit" disabled={save.isPending}>Save changes</button></div>
      </form>
    </section>
  );
}

function Security() {
  const toast = useToast();
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: ['my-sessions'], queryFn: () => api<{ sessions: { id: string; userAgent: string | null; ip: string | null; lastSeenAt: string; current: boolean }[] }>('/me/sessions') });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/me/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => { toast('Device signed out.'); qc.invalidateQueries({ queryKey: ['my-sessions'] }); },
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  return (
    <>
      <section className="card">
        <div className="card-h"><h2>Change password</h2></div>
        <div className="card-b"><PasswordForm onDone={() => qc.invalidateQueries({ queryKey: ['my-sessions'] })} /></div>
      </section>
      <section className="card" style={{ marginTop: 16 }}>
        <div className="card-h"><h2>Where you are signed in</h2></div>
        <div className="card-b">
          {sessions.data?.sessions.map((s, i) => (
            <div key={s.id} className="pref" style={i === 0 ? { paddingTop: 0 } : undefined}>
              <div><b>{deviceName(s.userAgent)}</b><br /><small>{s.ip ?? 'Unknown location'} · last active {fmtDateTime(s.lastSeenAt)}</small></div>
              {s.current ? <span className="pill s-app">This device</span> : <button className="btn sm" onClick={() => revoke.mutate(s.id)}>Sign out</button>}
            </div>
          )) ?? <span className="muted">Loading…</span>}
        </div>
      </section>
    </>
  );
}

function Notify() {
  const { me, setMe } = useAuth();
  const toast = useToast();
  const save = useMutation({
    mutationFn: (body: object) => api<MeResponse>('/me/preferences', { method: 'PATCH', body }),
    onSuccess: (d) => { setMe(d); toast('Preference saved.'); },
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  return (
    <section className="card"><div className="card-b">
      <div className="pref" style={{ paddingTop: 0 }}>
        <div><b>Returned, approved, disapproved or reserved</b><br /><small>Email and in-app. Always on so you never miss a decision.</small></div>
        <Switch checked disabled label="Required emails" onChange={() => undefined} />
      </div>
      <div className="pref">
        <div><b>Daily digest of pending items</b><br /><small>One email each morning.</small></div>
        <Switch checked={me!.prefs.dailyDigest} label="Daily digest" onChange={(v) => save.mutate({ dailyDigest: v })} />
      </div>
      <div className="pref">
        <div><b>Reservation released</b><br /><small>Email when a hold is lifted.</small></div>
        <Switch checked={me!.prefs.reservationReleased} label="Reservation released" onChange={(v) => save.mutate({ reservationReleased: v })} />
      </div>
    </div></section>
  );
}

function MyAccess() {
  const { me, permissions } = useAuth();
  const groups = [...new Set(PERMISSIONS.map((p) => p.group))];
  return (
    <section className="card">
      <div className="card-h"><h2>What {me!.role.name} can do</h2></div>
      <div className="card-b">
        {groups.map((g) => {
          const mine = PERMISSIONS.filter((p) => p.group === g && permissions.has(p.code));
          if (!mine.length) return null;
          return (
            <div key={g} style={{ marginBottom: 14 }}>
              <div className="muted" style={{ fontSize: '.78rem', fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: 4 }}>{g}</div>
              <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>{mine.map((p) => <li key={p.code} style={{ margin: '4px 0' }}>{p.label}</li>)}</ul>
            </div>
          );
        })}
        <p className="muted" style={{ margin: '4px 0 0', fontSize: '.86rem' }}>Something missing? Ask your administrator to change your role.</p>
      </div>
    </section>
  );
}

function Look() {
  const { me, setMe } = useAuth();
  const toast = useToast();
  const save = useMutation({
    mutationFn: (theme: string) => api<MeResponse>('/me/preferences', { method: 'PATCH', body: { theme } }),
    onSuccess: (d) => setMe(d),
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  return (
    <section className="card"><div className="card-b">
      <div className="pref" style={{ padding: 0, border: 0 }}>
        <div><b>Theme</b><br /><small>Light, dark, or match your device.</small></div>
        <div className="seg">
          {(['light', 'dark', 'system'] as const).map((k) => <button key={k} className={me!.theme === k ? 'on' : ''} onClick={() => save.mutate(k)}>{k[0]!.toUpperCase() + k.slice(1)}</button>)}
        </div>
      </div>
    </div></section>
  );
}

function Activity() {
  const q = useQuery({ queryKey: ['my-activity'], queryFn: () => api<{ items: { id: number; summary: string | null; action: string; createdAt: string }[] }>('/me/activity') });
  return (
    <section className="card">
      <div className="card-h"><h2>Your recent actions</h2></div>
      {q.data && !q.data.items.length && <Empty title="Nothing yet" />}
      {q.data?.items.map((a) => (
        <div key={a.id} className="pref" style={{ padding: '12px 18px' }}>
          <div>{a.summary ?? a.action}</div>
          <small style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(a.createdAt)}</small>
        </div>
      ))}
    </section>
  );
}
