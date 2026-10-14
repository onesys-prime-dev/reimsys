import { useState, type FormEvent } from 'react';
import { errMsg } from '../api';
import { useAuth } from '../auth';
import { Link } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { takeEndReason, type EndReason } from '../activity';
import { Field } from '../ui';

export function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [why] = useState<EndReason | null>(() => takeEndReason());

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await signIn(email, password);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="card lcard">
        <div className="brand" style={{ paddingBottom: 22 }}><Logo size={44} /></div>
        <h1>Sign in</h1>
        <p className="muted" style={{ margin: '6px 0 0' }}>Reimbursement management</p>
        {why && (
          <div className="callout warn" role="status" style={{ margin: '14px 0 0' }}>
            <div><b>{why === 'idle' ? 'You were signed out' : why === 'max' ? 'Your session ended' : 'You were signed out'}</b><span>{why === 'idle' ? 'You were away for a while, and for security the app signs you out. Please sign in again.' : why === 'max' ? 'For security, a sign-in cannot last longer than its limit. Please sign in again.' : 'Your session has ended. This can happen when you sign in on another device, change your password, or an administrator ends it. Please sign in again.'}</span></div>
          </div>
        )}
        <form onSubmit={submit}>
          <Field label="Email">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoFocus required />
          </Field>
          <Field label="Password">
            <div className="pw">
              <input type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
              <button type="button" className="eye" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                  <circle cx="12" cy="12" r="3" />
                  {show && <path d="M3 3l18 18" />}
                </svg>
              </button>
            </div>
          </Field>
          {error && <div className="callout bad" role="alert" style={{ margin: 0 }}><div><span>{error}</span></div></div>}
          <button className="btn pri" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <Link to="/forgot" className="forgot">Forgot your password?</Link>
        </form>
      </div>
    </div>
  );
}
