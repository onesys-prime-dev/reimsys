import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { ACCENTS, DEFAULT_APPEARANCE, PERMISSIONS, resolveAccent, type AccentKey, type Appearance, type MeResponse } from '@reimsys/shared';
import { api, deviceName, errMsg, fmtDateTime } from '../api';
import { useAuth } from '../auth';
import { PasswordForm } from '../components/PasswordForm';
import { Avatar, Empty, Field, Icon, Switch, useToast } from '../ui';

const TABS = [['details', 'Details'], ['security', 'Security'], ['notify', 'Notifications'], ['access', 'My access'], ['look', 'Appearance'], ['activity', 'Activity']] as const;
type Tab = (typeof TABS)[number][0];

/**
 * Phone photos are often 4 to 10 MB, more than the 2 MB the server accepts. This crops the picture to a square, scales it to 512 px and saves it as a
 * JPEG (about 100 KB) before it is sent. If the browser cannot read the file, the original is sent and the server says what is wrong.
 */
async function shrinkPhoto(f: File): Promise<File> {
  try {
    const bmp = await createImageBitmap(f);
    const side = Math.min(bmp.width, bmp.height);
    const out = Math.min(512, side);
    const canvas = document.createElement('canvas');
    canvas.width = out; canvas.height = out;
    const ctx = canvas.getContext('2d');
    if (!ctx) return f;
    ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, out, out);
    bmp.close();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.88));
    return blob ? new File([blob], 'photo.jpg', { type: 'image/jpeg' }) : f;
  } catch { return f; }
}

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
    mutationFn: async (f: File) => { const form = new FormData(); const small = await shrinkPhoto(f); form.append('photo', small, small.name); return api<MeResponse>('/me/photo', { method: 'POST', form }); },
    onSuccess: (d) => { setMe(d); setVer((v) => v + 1); toast('Photo updated.'); },
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  const removePhoto = useMutation({
    mutationFn: () => api<MeResponse>('/me/photo', { method: 'DELETE' }),
    onSuccess: (d) => { setMe(d); setVer((v) => v + 1); toast('Photo removed.'); },
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate(); };

  return (
    <section className="card">
      <form className="card-b" onSubmit={submit}>
        <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', marginBottom: 20 }}>
          <Avatar name={me!.name} userId={me!.id} hasPhoto={me!.hasPhoto} photoV={me!.photoV} size={72} version={ver} />
          <div>
            <b style={{ fontSize: '1.1rem' }}>{me!.name}</b><br />
            <span className="muted">{me!.role.name}</span><br />
            <button type="button" className="btn sm" style={{ marginTop: 8 }} onClick={() => file.current?.click()}><Icon name="upload" size={16} />{me!.hasPhoto ? 'Change photo' : 'Add photo'}</button>
            {me!.hasPhoto && <button type="button" className="btn sm ghost" style={{ marginTop: 8, marginLeft: 6 }} disabled={removePhoto.isPending} onClick={() => removePhoto.mutate()}>Remove photo</button>}
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
  const company = useQuery({ queryKey: ['app-settings'], queryFn: () => api<{ settings: { brandAccent?: string } }>('/app-settings') });
  const brand = (company.data?.settings.brandAccent ?? 'teal') as AccentKey;
  const save = useMutation({
    mutationFn: (body: { theme?: string; appearance?: Appearance }) => api<MeResponse>('/me/preferences', { method: 'PATCH', body }),
    onSuccess: (d) => setMe(d),
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  const look = me!.appearance ?? DEFAULT_APPEARANCE;
  const setLook = (patch: Partial<Appearance>) => save.mutate({ appearance: { ...look, ...patch } });
  const isDefault = me!.theme === 'light' && look.textSize === 'medium' && look.density === 'comfortable' && look.accent === 'default';
  const SEG = <T extends string>(name: string, value: T, options: { v: T; label: string }[], onPick: (v: T) => void) => (
    <div className="seg" role="radiogroup" aria-label={name}>
      {options.map((o) => <button key={o.v} type="button" role="radio" aria-checked={value === o.v} className={value === o.v ? 'on' : ''} onClick={() => onPick(o.v)}>{o.label}</button>)}
    </div>
  );
  return (
    <section className="card" aria-labelledby="ap-h">
      <div className="card-h"><h2 id="ap-h">Appearance</h2><button className="btn sm" type="button" disabled={isDefault || save.isPending} onClick={() => save.mutate({ theme: 'light', appearance: DEFAULT_APPEARANCE })}>Reset</button></div>
      <div className="card-b ap-grid">
        <div className="ap-row">
          <b>Theme</b><small>Light, dark, or match your device.</small>
          <div className="ap-themes" role="radiogroup" aria-label="Theme">
            {([['light', 'Light'], ['dark', 'Dark'], ['system', 'Match my device']] as const).map(([k, label]) => (
              <button key={k} type="button" role="radio" aria-checked={me!.theme === k} className={`ap-theme ${me!.theme === k ? 'on' : ''}`} onClick={() => save.mutate({ theme: k })}>
                <span className={`ap-mini ${k}`} aria-hidden="true"><i className="sb" /><i className="mn"><u className="a" /><u /><u /></i></span>
                <b>{label}{me!.theme === k && <span className="ap-ck" aria-hidden="true">✓</span>}</b>
              </button>
            ))}
          </div>
        </div>
        <div className="ap-row">
          <b>Colour</b><small>The colour of buttons, links and highlights.</small>
          <div className="ap-swatches" role="radiogroup" aria-label="Colour">
            <button type="button" role="radio" aria-checked={look.accent === 'default'} className={`ap-sw ${look.accent === 'default' ? 'on' : ''}`} onClick={() => setLook({ accent: 'default' })}><span className="co" style={{ ['--c' as string]: ACCENTS[resolveAccent('default', brand)].light.accent }} />Company</button>
            {(Object.keys(ACCENTS) as (keyof typeof ACCENTS)[]).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={look.accent === k} aria-label={ACCENTS[k].label} className={`ap-sw ${look.accent === k ? 'on' : ''}`} onClick={() => setLook({ accent: k })}><span style={{ ['--c' as string]: ACCENTS[k].light.accent }} />{ACCENTS[k].label}</button>
            ))}
          </div>
        </div>
        <div className="ap-row">
          <b>Text size</b><small>Makes everything a little smaller or larger.</small>
          {SEG('Text size', look.textSize, [{ v: 'small', label: 'Small' }, { v: 'medium', label: 'Medium' }, { v: 'large', label: 'Large' }], (v) => setLook({ textSize: v }))}
        </div>
        <div className="ap-row">
          <b>Spacing</b><small>Compact fits more on the screen, for example more receipts in a list.</small>
          {SEG('Spacing', look.density, [{ v: 'comfortable', label: 'Comfortable' }, { v: 'compact', label: 'Compact' }], (v) => setLook({ density: v }))}
        </div>
        <div className="ap-preview" aria-hidden="true">
          <button type="button" className="btn pri" tabIndex={-1}>A button</button>
          <span style={{ color: 'var(--accent)', fontWeight: 600 }}>A link</span>
          <span className="badge">3</span>
          <span className="muted">This is how it looks now. Your choice applies on every device you sign in on.</span>
        </div>
      </div>
    </section>
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
