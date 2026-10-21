import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PRIVACY_VERSION, type MeResponse } from '@reimsys/shared';
import { api, errMsg } from '../api';
import { useAuth } from '../auth';
import { Logo } from '../components/Logo';

/**
 * The privacy notice and acceptable-use lines. Change the wording here; raise PRIVACY_VERSION (packages/shared/src/privacy.ts)
 * when people should read it again. The two "To be confirmed" lines are filled in once the client decides.
 */
export function PrivacyNotice() {
  return (
    <div className="notice">
      <h2>What we collect</h2>
      <ul>
        <li>Your name, work email, role, branch and phone number, and your profile photo if you add one.</li>
        <li>The receipts you enter, the photos and files you attach to them, and the details on them (amounts, dates, vendor names, addresses and tax numbers).</li>
        <li>A record of what happens in the system: who signed in, who opened, checked, approved, paid or returned a receipt, and who viewed, downloaded or printed an attachment, with the time.</li>
        <li>Technical details of your sign-ins, such as the device type and network address, so a stolen session can be spotted and ended.</li>
      </ul>

      <h2>Why we collect it</h2>
      <p>To process reimbursements: to check and approve what you spent, to pay you, to produce reimbursement documents and liquidation reports, and to keep an honest record for audit.</p>

      <h2>Who can see it</h2>
      <ul>
        <li><b>Med Refs</b> see only their own receipts.</li>
        <li><b>Checkers and Approvers</b> see the receipts they review, with the attachments.</li>
        <li><b>Accounting</b> sees approved receipts and the payments made.</li>
        <li><b>Administrators</b> manage accounts and can read the history log.</li>
      </ul>
      <p>Your data is not sold or shared with advertisers. Emails about your receipts are sent through the company's mail service.</p>

      <h2>Cookies</h2>
      <p>REIMSYS uses one cookie, only to keep you signed in. It is removed when you sign out. There is no tracking or analytics, and no scripts from other companies.</p>

      <h2>How long we keep it</h2>
      <p><b>To be confirmed by your administrator.</b> The retention period is set by the company.</p>

      <h2>Your rights</h2>
      <p>You can ask to see the data held about you and to have mistakes corrected. Contact the person below. Records that the company must keep for audit or tax cannot be erased on request.</p>

      <h2>Who to contact</h2>
      <p><b>To be confirmed by your administrator.</b> This will be the company's data protection contact.</p>

      <h2>Using REIMSYS</h2>
      <ul>
        <li>Enter only genuine receipts for money you actually spent for the company.</li>
        <li>Do not share your sign-in. Everything done under it is recorded as you.</li>
        <li>Every action in the system is recorded and can be reviewed.</li>
      </ul>
      <p className="muted" style={{ fontSize: '.82rem' }}>Version {PRIVACY_VERSION}</p>
    </div>
  );
}

/** Readable before signing in (linked from the sign-in page). */
export function PrivacyPublicPage() {
  const { me } = useAuth();
  return (
    <div className="login" style={{ alignItems: 'flex-start' }}>
      <div className="card lcard" style={{ width: 'min(680px,100%)' }}>
        <div className="brand" style={{ paddingBottom: 18 }}><Logo size={44} /></div>
        <h1>Privacy notice</h1>
        <PrivacyNotice />
        <Link to="/" className="btn" style={{ marginTop: 12 }}>{me ? 'Back to REIMSYS' : 'Back to sign in'}</Link>
      </div>
    </div>
  );
}

/** Shown once after sign-in (after the password step) until the current version is accepted. */
export function PrivacyAcceptPage() {
  const { me, setMe, signOut } = useAuth();
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function accept() {
    setBusy(true);
    setError('');
    try {
      setMe(await api<MeResponse>('/me/privacy', { method: 'POST' }));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login" style={{ alignItems: 'flex-start' }}>
      <div className="card lcard" style={{ width: 'min(680px,100%)' }}>
        <div className="brand" style={{ paddingBottom: 18 }}><Logo size={44} /></div>
        <h1>Privacy notice</h1>
        <p className="muted" style={{ margin: '6px 0 14px' }}>Welcome, {me?.name}. Please read this once before you continue.</p>
        <PrivacyNotice />
        <label className="check" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', margin: '16px 0 10px' }}>
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ marginTop: 3 }} />
          <span>I have read this notice and I understand how my data is used and how I should use REIMSYS.</span>
        </label>
        {error && <div className="callout bad" role="alert"><div><span>{error}</span></div></div>}
        <button className="btn pri" disabled={!agree || busy} onClick={accept}>{busy ? 'Saving…' : 'I understand, continue'}</button>
        <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => signOut()}>Sign out</button>
      </div>
    </div>
  );
}

/** The same notice inside the app, for people who want to read it again. */
export function PrivacyInAppPage() {
  return (
    <div className="card" style={{ padding: 22, maxWidth: 760 }}>
      <h1 style={{ marginTop: 0 }}>Privacy notice</h1>
      <PrivacyNotice />
    </div>
  );
}
