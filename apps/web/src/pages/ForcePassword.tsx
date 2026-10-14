import { useAuth } from '../auth';
import { Logo } from '../components/Logo';
import { PasswordForm } from '../components/PasswordForm';

export function ForcePasswordPage() {
  const { me, signOut } = useAuth();
  return (
    <div className="login">
      <div className="card lcard" style={{ width: 'min(520px,100%)' }}>
        <div className="brand" style={{ paddingBottom: 22 }}><Logo size={44} /></div>
        <h1>Choose a new password</h1>
        <p className="muted" style={{ margin: '6px 0 18px' }}>
          Welcome, {me?.name}. Your administrator gave you a temporary password. Set your own to continue.
        </p>
        <PasswordForm />
        <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => signOut()}>Sign out</button>
      </div>
    </div>
  );
}
