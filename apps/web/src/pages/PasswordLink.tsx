import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { passwordSchema } from '@reimsis/shared';
import { api, errMsg } from '../api';
import { Logo } from '../components/Logo';
import { Field } from '../ui';

const Shell = ({ children }: { children: React.ReactNode }) => (
  <div className="login">
    <div className="card lcard">
      <div className="brand" style={{ paddingBottom: 22 }}><Logo size={44} /></div>
      {children}
    </div>
  </div>
);

/** Step 1: type your email. The answer is always the same, so this page cannot be used to find out who has an account. */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const ask = useMutation({
    mutationFn: () => api('/auth/forgot', { method: 'POST', body: { email } }),
    onSuccess: () => setSent(true),
    onError: (e) => setError(errMsg(e)),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); setError(''); ask.mutate(); };

  if (sent) {
    return (
      <Shell>
        <h1>Check your email</h1>
        <p className="muted" style={{ margin: '8px 0 18px' }}>If <b>{email}</b> has an account, we have sent a link to choose a new password. It works for one hour. Look in your spam folder if it does not arrive.</p>
        <Link className="btn" to="/" style={{ width: '100%' }}>Back to sign in</Link>
      </Shell>
    );
  }
  return (
    <Shell>
      <h1>Forgot your password?</h1>
      <p className="muted" style={{ margin: '6px 0 0' }}>Enter your email and we will send you a link to choose a new one.</p>
      <form onSubmit={submit}>
        <Field label="Email" error={error}><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoFocus required /></Field>
        <button className="btn pri" type="submit" disabled={ask.isPending || !email}>{ask.isPending ? 'Sending…' : 'Send me a link'}</button>
        <Link className="btn ghost" to="/">Back to sign in</Link>
      </form>
    </Shell>
  );
}

/** Step 2: the page the emailed link opens. */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const nav = useNavigate();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const check = useQuery({ queryKey: ['reset-check', token], queryFn: () => api<{ valid: boolean; name?: string; invite?: boolean }>(`/auth/reset/check?token=${encodeURIComponent(token)}`), enabled: token.length > 0, retry: false });
  const save = useMutation({
    mutationFn: () => api('/auth/reset', { method: 'POST', body: { token, password: pw } }),
    onSuccess: () => setDone(true),
    onError: (e) => setError(errMsg(e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault(); setError('');
    const ok = passwordSchema.safeParse(pw);
    if (!ok.success) return setError(ok.error.issues[0]?.message ?? 'Choose a stronger password.');
    if (pw !== pw2) return setError('The two passwords do not match.');
    save.mutate();
  };

  if (done) {
    return (
      <Shell>
        <h1>Password saved</h1>
        <p className="muted" style={{ margin: '8px 0 18px' }}>You can sign in with your new password now. Anywhere you were signed in before has been signed out.</p>
        <button className="btn pri" style={{ width: '100%' }} onClick={() => nav('/', { replace: true })}>Go to sign in</button>
      </Shell>
    );
  }
  if (!token || (check.isSuccess && !check.data.valid) || check.isError) {
    return (
      <Shell>
        <h1>This link no longer works</h1>
        <p className="muted" style={{ margin: '8px 0 18px' }}>It may have expired or already been used. Ask for a new one and try again.</p>
        <Link className="btn pri" to="/forgot" style={{ width: '100%' }}>Send me a new link</Link>
      </Shell>
    );
  }
  if (!check.isSuccess) return <Shell><span className="muted">Checking your link…</span></Shell>;
  return (
    <Shell>
      <h1>{check.data.invite ? `Welcome, ${check.data.name?.split(' ')[0]}` : 'Choose a new password'}</h1>
      <p className="muted" style={{ margin: '6px 0 0' }}>{check.data.invite ? 'Choose a password to finish setting up your account.' : `For ${check.data.name}.`} Use at least 8 characters with a letter and a number.</p>
      <form onSubmit={submit}>
        <Field label="New password"><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" autoFocus required /></Field>
        <Field label="Type it again" error={error}><input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" required /></Field>
        <button className="btn pri" type="submit" disabled={save.isPending || !pw}>{save.isPending ? 'Saving…' : 'Save password'}</button>
      </form>
    </Shell>
  );
}
