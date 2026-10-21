import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, errMsg } from '../api';
import { Field, Icon, Switch, useToast } from '../ui';

interface MailView {
  source: 'database' | 'environment' | 'none';
  host: string; port: number; secure: boolean; user: string; hasPassword: boolean; fromName: string; fromAddress: string; testRedirect: string;
  passwordUnreadable?: boolean;
}
interface Step { id: string; label: string; state: 'ok' | 'fail' | 'skipped'; detail: string; fix?: string }

const PRESETS: Record<string, { label: string; host: string; port: number; secure: boolean; hint: string }> = {
  gmail: { label: 'Gmail', host: 'smtp.gmail.com', port: 587, secure: false, hint: 'Use an App password, not your normal Gmail password. Turn on 2-step verification, then create one at myaccount.google.com/apppasswords.' },
  microsoft: { label: 'Microsoft 365 / Outlook', host: 'smtp.office365.com', port: 587, secure: false, hint: 'Use the full email address as the username. If sign-in fails, ask your Microsoft 365 admin to allow SMTP sign-in for this mailbox.' },
  other: { label: 'Other', host: '', port: 587, secure: false, hint: 'Use the server, port, username and password your email provider gave you. Port 465 needs "Secure connection" on; port 587 needs it off.' },
};

export function EmailSettingsTab() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['mail-settings'], queryFn: () => api<{ mail: MailView }>('/settings/mail') });
  const [f, setF] = useState({ host: '', port: '587', secure: false, user: '', pass: '', fromName: '', fromAddress: '', testRedirect: '' });
  const [preset, setPreset] = useState('other');
  const [loaded, setLoaded] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testTo, setTestTo] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const fill = (m: MailView) => {
    setF({ host: m.host, port: String(m.port), secure: m.secure, user: m.user, pass: '', fromName: m.fromName, fromAddress: m.fromAddress, testRedirect: m.testRedirect });
    setPreset(m.host === PRESETS.gmail!.host ? 'gmail' : m.host === PRESETS.microsoft!.host ? 'microsoft' : 'other');
  };
  // Fill the form once, the first time the saved settings arrive. After that the form belongs to the person typing.
  useEffect(() => {
    const m = q.data?.mail;
    if (!m || loaded) return;
    fill(m);
    setLoaded(true);
  }, [q.data, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const m = q.data?.mail;
  const body = () => ({ host: f.host.trim(), port: Number(f.port), secure: f.secure, user: f.user.trim(), pass: f.pass || undefined, fromName: f.fromName.trim(), fromAddress: f.fromAddress.trim(), testRedirect: f.testRedirect.trim() });
  const set = (k: keyof typeof f, v: string | boolean) => { setF((x) => ({ ...x, [k]: v })); setErrors((e) => ({ ...e, [k]: '' })); setResult(null); };
  const pick = (k: string) => {
    const p = PRESETS[k]!;
    setPreset(k); setResult(null);
    if (k !== 'other') setF((x) => ({ ...x, host: p.host, port: String(p.port), secure: p.secure }));
  };
  const refresh = () => { qc.invalidateQueries({ queryKey: ['mail-settings'] }); qc.invalidateQueries({ queryKey: ['email-status'] }); };

  const verify = useMutation({
    mutationFn: () => api<{ ok: boolean; message: string }>('/settings/mail/verify', { method: 'POST', body: body() }),
    onSuccess: setResult,
    onError: (e) => setResult({ ok: false, message: errMsg(e) }),
  });
  const save = useMutation({
    mutationFn: () => api<{ mail: MailView }>('/settings/mail', { method: 'PUT', body: body() }),
    onSuccess: (d) => { toast('Email account saved.'); qc.setQueryData(['mail-settings'], d); setF((x) => ({ ...x, pass: '' })); setResult(null); refresh(); },
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  const clear = useMutation({
    mutationFn: () => api<{ mail: MailView }>('/settings/mail', { method: 'DELETE' }),
    onSuccess: (d) => { toast('Saved account removed.'); qc.setQueryData(['mail-settings'], d); fill(d.mail); setResult(null); refresh(); },
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  const [steps, setSteps] = useState<Step[] | null>(null);
  const diagnose = useMutation({
    mutationFn: () => api<{ ok: boolean; steps: Step[] }>('/settings/mail/diagnose', { method: 'POST' }),
    onSuccess: (d) => setSteps(d.steps),
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  const sendTest = useMutation({
    mutationFn: () => api('/email-log/test', { method: 'POST', body: { to: testTo } }),
    onSuccess: () => { toast('Test email queued. Check Audit log, Emails to see whether it was sent.'); qc.invalidateQueries({ queryKey: ['email-log'] }); },
    onError: (e) => toast(errMsg(e), 'bad'),
  });

  function validate() {
    const e: Record<string, string> = {};
    if (!f.host.trim()) e.host = 'Enter the mail server address.';
    if (!(Number(f.port) >= 1 && Number(f.port) <= 65535)) e.port = 'Enter a port between 1 and 65535.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.fromAddress.trim())) e.fromAddress = 'Enter the address emails are sent from.';
    if (f.testRedirect.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.testRedirect.trim())) e.testRedirect = 'Enter a valid email address, or leave this empty.';
    if (f.user.trim() && !f.pass && !m?.hasPassword) e.pass = 'Enter the password for this account.';
    setErrors(e);
    return !Object.keys(e).length;
  }

  if (!m) return <div className="empty">Loading…</div>;
  return (
    <>
      {m.passwordUnreadable && (
        <div className="callout bad" role="alert" style={{ marginTop: 0, marginBottom: 12 }}>
          <Icon name="info" />
          <div><b>Emails cannot be sent: the saved mail password cannot be unlocked</b><span>This server does not have the key the password was saved with (for example after moving the database to a new server). Type the mail password again in the form below and press Save.</span></div>
        </div>
      )}
      <div className={`callout ${m.source === 'none' || m.testRedirect ? 'warn' : 'ok'}`} style={{ marginTop: 0 }}>
        <Icon name={m.source === 'none' ? 'info' : 'check'} />
        <div>
          <b>{m.testRedirect ? `TEST MODE: all email goes to ${m.testRedirect}` : m.source === 'database' ? `Sending through ${m.host}` : m.source === 'environment' ? `Using the server's own settings (${m.host})` : 'No email account is set up yet'}</b>
          <span>
            {m.source === 'none' ? 'Emails are recorded but not sent until you save an account below.'
              : m.source === 'environment' ? 'Saving an account here replaces them.'
              : `Emails go out as ${m.fromName ? `${m.fromName} ` : ''}<${m.fromAddress}>.`}
          </span>
        </div>
      </div>

      <section className="card">
        <div className="card-h">
          <h2>Email account</h2>
          {m.source === 'database' && <button className="btn sm ghost" type="button" onClick={() => clear.mutate()}>Remove saved account</button>}
        </div>
        <form className="card-b" noValidate onSubmit={(e) => { e.preventDefault(); if (validate()) save.mutate(); }}>
          <div className="f" style={{ marginBottom: 16 }}>
            <span>Provider</span>
            <div className="seg" style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}>
              {Object.entries(PRESETS).map(([k, p]) => <button type="button" key={k} className={preset === k ? 'on' : ''} onClick={() => pick(k)}>{p.label}</button>)}
            </div>
            <span className="hint" style={{ fontWeight: 400 }}>{PRESETS[preset]!.hint}</span>
          </div>

          <div className="form">
            <Field label="Mail server" error={errors.host}><input type="text" value={f.host} onChange={(e) => set('host', e.target.value)} placeholder="smtp.gmail.com" autoComplete="off" /></Field>
            <Field label="Port" error={errors.port}><input type="number" value={f.port} onChange={(e) => set('port', e.target.value)} /></Field>
            <Field label="Username" hint="usually your email address"><input type="text" value={f.user} onChange={(e) => set('user', e.target.value)} autoComplete="off" placeholder="you@gmail.com" /></Field>
            <Field label="Password" hint={m.hasPassword ? 'Saved. Leave blank to keep it' : undefined} error={errors.pass}>
              <input type="password" value={f.pass} onChange={(e) => set('pass', e.target.value)} autoComplete="new-password" placeholder={m.hasPassword ? '••••••••••••' : 'App password'} />
            </Field>
            <Field label="Send emails as (name)"><input type="text" value={f.fromName} onChange={(e) => set('fromName', e.target.value)} placeholder="Your Organisation" /></Field>
            <Field label="Send emails from (address)" error={errors.fromAddress}><input type="email" value={f.fromAddress} onChange={(e) => set('fromAddress', e.target.value)} placeholder="you@gmail.com" /></Field>
            <div className="f full" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Switch checked={f.secure} onChange={(v) => set('secure', v)} label="Secure connection" />
              <span>Secure connection from the start <span className="hint" style={{ fontWeight: 400 }}>(on for port 465, off for port 587)</span></span>
            </div>
          </div>

          <div className="form" style={{ marginTop: 16 }}>
            <Field label="Test mode" hint="optional" error={errors.testRedirect} className="full">
              <input type="email" value={f.testRedirect} onChange={(e) => set('testRedirect', e.target.value)} placeholder="Send every email to this address instead" />
              <span className="hint" style={{ fontWeight: 400 }}>While this is filled in, nobody else receives email. Each message goes here with "[TEST for name@…]" in the subject. Empty it to send to real recipients.</span>
            </Field>
          </div>

          {(preset === 'gmail' || preset === 'microsoft') && f.user.trim() && f.fromAddress.trim() && f.user.trim().toLowerCase() !== f.fromAddress.trim().toLowerCase() && (
            <div className="callout warn" style={{ margin: '16px 0 0' }}>
              <Icon name="info" />
              <div><b>The "from" address is different from your username</b><span>{PRESETS[preset]!.label} replaces it with your own address, and mail that looks mismatched is more likely to land in spam. Use the same address as the username.</span></div>
            </div>
          )}

          {result && (
            <div className={`callout ${result.ok ? 'ok' : 'bad'}`} role="status" style={{ margin: '16px 0 0' }}>
              <Icon name={result.ok ? 'check' : 'x'} />
              <div><b>{result.ok ? 'Connection works' : 'Could not connect'}</b><span>{result.message}</span></div>
            </div>
          )}

          <div className="formbar">
            <button type="button" className="btn" disabled={verify.isPending} onClick={() => { if (validate()) verify.mutate(); }}>{verify.isPending ? 'Testing…' : 'Test connection'}</button>
            <button type="submit" className="btn pri" disabled={save.isPending}>Save</button>
          </div>
          <p className="muted" style={{ fontSize: '.84rem', margin: '4px 0 0' }}>The password is stored encrypted and is never shown again, not even to administrators. Every change is recorded in the audit log without it.</p>
        </form>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="card-h"><h2>Check why email might not be sending</h2><button className="btn sm" type="button" disabled={diagnose.isPending} onClick={() => diagnose.mutate()}>{diagnose.isPending ? 'Checking…' : 'Run full check'}</button></div>
        <div className="card-b">
          {!steps && <p className="muted" style={{ margin: 0 }}>Looks at the saved account, whether its password can be unlocked here, whether the server is found, whether this server can reach the mail ports (hosting providers often block them) and whether the login is accepted. Nothing is sent.</p>}
          {steps && (
            <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 10 }} aria-label="Mail check results">
              {steps.map((st) => (
                <li key={st.id} style={{ display: 'grid', gridTemplateColumns: '24px 1fr', gap: 10, alignItems: 'start' }}>
                  <span style={{ display: 'grid', placeItems: 'center', width: 22, height: 22, borderRadius: '50%', fontSize: '.8rem', fontWeight: 700, background: st.state === 'ok' ? 'var(--ok-soft)' : st.state === 'fail' ? 'var(--bad-soft)' : 'var(--soft)', color: st.state === 'ok' ? 'var(--ok)' : st.state === 'fail' ? 'var(--bad)' : 'var(--muted)' }} aria-label={st.state === 'ok' ? 'Passed' : st.state === 'fail' ? 'Failed' : 'Skipped'}>{st.state === 'ok' ? '✓' : st.state === 'fail' ? '✕' : '–'}</span>
                  <div><b>{st.label}</b><br /><small className="muted">{st.detail}</small>{st.fix && <div className="callout warn" style={{ margin: '6px 0 0' }}><div><span>{st.fix}</span></div></div>}</div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="card-h"><h2>Send a test email</h2></div>
        <form className="card-b" onSubmit={(e) => { e.preventDefault(); if (testTo) sendTest.mutate(); }} style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 260px', maxWidth: 380 }}><input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="Send to…" aria-label="Test email address" /></div>
          <button className="btn pri" type="submit" disabled={!testTo || sendTest.isPending || m.source === 'none'}>Send test email</button>
          {m.source === 'none' && <span className="muted" style={{ alignSelf: 'center' }}>Save an account first.</span>}
        </form>
      </section>
    </>
  );
}
