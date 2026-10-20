import { useState, type FormEvent } from 'react';
import { changePasswordSchema, type MeResponse } from '@reimsys/shared';
import { api, errMsg } from '../api';
import { useAuth } from '../auth';
import { Field, useToast } from '../ui';
import { PasswordInput } from './PasswordInput';

function strength(p: string) {
  let s = 0;
  if (p.length >= 8) s++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++;
  if (/\d/.test(p)) s++;
  if (/[^A-Za-z0-9]/.test(p)) s++;
  return s;
}
const LABELS = ['Use 8 or more characters with a letter and a number.', 'Weak', 'Fair', 'Good', 'Strong'];

export function PasswordForm({ onDone }: { onDone?: () => void }) {
  const { setMe } = useAuth();
  const toast = useToast();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const s = next ? strength(next) : 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const parsed = changePasswordSchema.safeParse({ currentPassword: cur, newPassword: next });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Check the new password.');
    if (next !== again) return setError('The new passwords do not match.');
    setBusy(true);
    try {
      const me = await api<MeResponse>('/me/password', { method: 'POST', body: parsed.data });
      setMe(me);
      setCur(''); setNext(''); setAgain('');
      toast('Password updated. Other devices were signed out.');
      onDone?.();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="form">
        <Field label="Current password" className="full">
          <PasswordInput value={cur} onChange={setCur} autoComplete="current-password" required />
        </Field>
        <Field label="New password">
          <PasswordInput value={next} onChange={setNext} autoComplete="new-password" required />
          <span className="meter">{[0, 1, 2, 3].map((i) => <i key={i} className={i < s ? (s <= 1 ? 'b' : s === 2 ? 'w' : 'on') : ''} />)}</span>
          <span className="hint">{LABELS[next ? s : 0]}</span>
        </Field>
        <Field label="Confirm new password">
          <PasswordInput value={again} onChange={setAgain} autoComplete="new-password" required />
        </Field>
      </div>
      {error && <div className="callout bad" role="alert" style={{ margin: '16px 0 0' }}><div><span>{error}</span></div></div>}
      <div className="formbar"><button className="btn pri" type="submit" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button></div>
    </form>
  );
}
