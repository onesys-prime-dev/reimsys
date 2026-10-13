import { useState, type FormEvent } from 'react';
import { errMsg } from '../api';
import { useAuth } from '../auth';
import { Field } from '../ui';

export function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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
        <div className="brand"><span className="logo">R</span><b>REIMSIS</b></div>
        <h1>Sign in</h1>
        <p className="muted" style={{ margin: '6px 0 0' }}>Reimbursement management</p>
        <form onSubmit={submit}>
          <Field label="Email">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoFocus required />
          </Field>
          <Field label="Password">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </Field>
          {error && <div className="callout bad" role="alert" style={{ margin: 0 }}><div><span>{error}</span></div></div>}
          <button className="btn pri" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
      </div>
    </div>
  );
}
