import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDateTime } from '../api';
import { useAuth } from '../auth';

/**
 * The Help page: what each person does in REIMSYS, in plain words. Everyone sees "The basics"; the guides below it are shown by what the person is
 * allowed to do (so a custom role gets the right ones). Change the wording here. Keep it short and about the screens as they are.
 */

/** Which version of the page and of the server is running. A server older than the page (not restarted after an update) is the usual cause of "Not found." on a new button. */
function VersionInfo() {
  const q = useQuery({ queryKey: ['build'], queryFn: () => api<{ commit: string; startedAt: string }>('/build'), retry: false });
  const web = __WEB_BUILD__;
  const server = q.data;
  const old = q.isError; // a server that has no /build at all is older than this page
  const differ = !!server && server.commit !== 'unknown' && web.commit !== 'unknown' && server.commit !== web.commit;
  return (
    <div className="card" id="version" style={{ marginTop: 16 }}>
      <div className="card-h"><h2>About this version</h2></div>
      <div className="card-b help">
        <ul style={{ marginTop: 0 }}>
          <li>Page: <b>{web.commit}</b>, built {fmtDateTime(web.builtAt)}</li>
          <li>Server: {old ? <b>not reported (older than this page)</b> : server ? <><b>{server.commit}</b>, running since {fmtDateTime(server.startedAt)}</> : 'checking…'}</li>
        </ul>
        {(old || differ) && <p className="muted" style={{ marginBottom: 0 }}>The server is not the same version as this page, so some new buttons may say "Not found." Ask your administrator to update and restart the server.</p>}
      </div>
    </div>
  );
}

const STATUSES: [string, string][] = [
  ['Draft', 'Being written by the Med Ref. Nobody else sees it yet.'],
  ['Submitted', 'Sent for checking. Waiting for the Checker.'],
  ['Returned', 'The Checker sent it back with what to fix. The Med Ref fixes it and sends it again.'],
  ['Checked', 'The Checker verified it. Waiting for the Approver.'],
  ['Approved', 'The Approver said yes. A reimbursement document is made. Waiting for Accounting to pay.'],
  ['Reserved', 'The Approver put it on hold (with a note) until something is sorted out.'],
  ['Disapproved', 'The Approver said no, with a reason. This is final.'],
  ['Paid', 'Accounting paid it and kept the proof of payment.'],
];

function Guide({ id, title, intro, children }: { id: string; title: string; intro: string; children: ReactNode }) {
  return (
    <section className="card" id={id} style={{ marginTop: 16 }}>
      <div className="card-h"><h2>{title}</h2></div>
      <div className="card-b help">
        <p className="muted" style={{ marginTop: 0 }}>{intro}</p>
        {children}
      </div>
    </section>
  );
}

const Steps = ({ items }: { items: ReactNode[] }) => <ol className="helpsteps">{items.map((s, i) => <li key={i}>{s}</li>)}</ol>;

export function HelpPage() {
  const { me, can } = useAuth();
  const guides: ReactNode[] = [];

  if (can('receipt.create')) guides.push(
    <Guide key="medref" id="medref" title="Med Ref: sending in a receipt" intro="You enter the receipt and attach a clear photo or PDF of it. A Checker and an Approver look at it before you are paid.">
      <h3>Make a receipt</h3>
      <Steps items={[
        <>Press <b>New receipt</b>. Answer the questions one step at a time. The steps follow the reimbursement form, and skip what the answers make unnecessary.</>,
        <><b>Reimbursement details:</b> say whether the invoice is BIR-registered. If it is not, only the date, vendor, address and amount are needed.</>,
        <><b>Invoice details:</b> copy what is on the invoice. Beside the questions that have one, press the small <b>i</b> button to see a sample invoice with the place to look marked. Press outside the picture or <b>Close</b> to go back. The vendor TIN takes numbers only; the dashes are put in for you.</>,
        <><b>VAT details:</b> say whether the invoice is vatable, then the vatable amount, VAT, VAT-exempt amount and discount (write 0 when there is none). Then answer <b>Tax withheld?</b>. With <b>Yes</b> the amounts must add up and you add the withholding rate and amount on the next step. With <b>No</b> the form shows a potential loss in yellow: it is an estimate, not a verified figure.</>,
        <><b>Reason for spending:</b> say why the money was spent, pick what it was for, and choose where to charge it.</>,
        <><b>Proof and review:</b> add the photo or PDF. Press <b>Scan receipt</b> to take the picture with the camera: lay the receipt flat in good light, keep all four corners in view, and wait for the green outline. You can drag the four dots in the editor if the outline is off. Check the summary, then <b>Submit</b>.</>,
      ]} />
      <p>You do not have to finish in one go. What you type is saved as you go, even half filled, so a wrong click or a closed page loses nothing. Come back from <b>New receipt</b> or from the note on <b>Receipts</b> and press <b>Continue</b>; it works from another device too. Photos and PDFs are not part of that and are added again. <b>Start over</b> throws the unfinished form away. You can also press <b>Save draft</b> on the last step. Changed your mind after sending it? Press <b>Withdraw</b> while it is still waiting; it goes back to Draft.</p>
      <h3>If it comes back</h3>
      <p>A <b>Returned</b> receipt shows what to fix. Each problem has a <b>Fix</b> button that opens the form on the right step. Fix it and send it again. You get a notice and an email whenever something happens to your receipt.</p>
      <h3>Good photos</h3>
      <ul>
        <li>One receipt per photo, flat, in good light, with no finger over the print.</li>
        <li>A white receipt on a white desk is hard to see: put something darker under it.</li>
        <li>Long tickets: take the whole ticket. You can add more pages to the same receipt.</li>
      </ul>
      {can('receipt.import') && <p>Many receipts at once? <Link to="/receipts/import">Import</Link> a CSV or Excel file. You see a preview and any errors before anything is saved.</p>}
    </Guide>,
  );

  if (can('review.check')) guides.push(
    <Guide key="checker" id="checker" title="Checker: verifying receipts" intro="You make sure each receipt is real and complete before it goes to the Approver.">
      <Steps items={[
        <>Open the <b>Receipts</b> list. The oldest waiting receipts are first. A waiting time in orange means it has waited longer than it should.</>,
        <>Open a receipt and press <b>Open evidence</b>. Opening it is recorded with your name. <b>You must open the evidence before you can check it.</b></>,
        <>Compare the photo with the details: vendor, date, amount, invoice number. Zoom in on the photo with the wheel or the + button, and drag it to move around.</>,
        <>All good? <b>Mark checked</b> (remarks are optional). Something wrong? <b>Return</b> it and tick what is wrong. The Med Ref gets a Fix button for each.</>,
        <>Need a quick answer instead? Use the <b>Comments</b> box on the receipt to ask a question without sending it back.</>,
      ]} />
      <p>Many clean receipts? Tick them in the list and use the bar at the bottom to mark them all checked. Each one still follows the same rules, and any you have not opened yet are skipped and listed.</p>
      <p>You cannot check your own receipts.</p>
    </Guide>,
  );

  if (can('review.decide')) guides.push(
    <Guide key="approver" id="approver" title="Approver: deciding" intro="Only receipts the Checker has verified reach you.">
      <Steps items={[
        <>Open your queue on the <b>Dashboard</b> or the <b>Receipts</b> list.</>,
        <>Open the evidence, read the Checker&apos;s remarks, then choose one:</>,
      ]} />
      <ul>
        <li><b>Approve:</b> a reimbursement document is made and Accounting is told to pay.</li>
        <li><b>Disapprove:</b> a reason is required, and the Med Ref sees it. This is final.</li>
        <li><b>Reserve:</b> put it on hold with a note. Press <b>Release to queue</b> when it is sorted out.</li>
        <li><b>Ask for more proof:</b> sends it back to the Med Ref and it is checked again from the start.</li>
      </ul>
      <p>Changed your mind? <b>Take back decision</b> is available for a short time (the time is set by your administrator) if it has not been paid.</p>
    </Guide>,
  );

  if (can('payment.mark')) guides.push(
    <Guide key="accounting" id="accounting" title="Accounting: paying" intro="You record each payment, with proof, so the books and the receipts agree.">
      <Steps items={[
        <>Open <Link to="/pay">Ready to pay</Link>. Approved receipts are grouped by person. One payment covers one person&apos;s receipts.</>,
        <>Tick the receipts you are paying (or <b>Select all</b> for that person), then press <b>Mark as paid</b>.</>,
        <>Choose the payment method and date, and attach the <b>proof of payment</b> (a photo or PDF). A shortfall on a receipt needs a reason.</>,
        <>The Med Ref gets an email. The receipts become <b>Paid</b> and cannot be edited.</>,
      ]} />
      <p>Paid by mistake? <b>Reverse payment</b> (a reason is required) puts the receipt back to Approved, and the original payment stays on record.</p>
      <p>For your books, open <b>Ready to pay</b> and use <b>Export payments</b> to download what was paid in a period.</p>
    </Guide>,
  );

  if (can('user.manage') || can('role.manage') || can('settings.manage') || can('audit.view')) guides.push(
    <Guide key="admin" id="admin" title={can('role.manage') ? 'Super Admin: running the system' : 'Admin: running the system'} intro={can('role.manage') ? 'You look after people, rules and settings. By default the Super Admin cannot check, approve or pay, so no one person can do the whole chain.' : 'You look after people and settings and can see every receipt and report. You cannot change roles, and you cannot check, approve or pay.'}>
      <ul>
        {can('user.manage') && <li><b>Access → Users:</b> add people (they get a temporary password and an email invitation), change a role, switch someone off, reset a password, unlock an account. Switching off keeps their history. Each person&apos;s row shows whether they accepted the privacy notice.</li>}
        {can('role.manage') && <li><b>Access → Roles and permissions:</b> choose what each role can do. Locked boxes protect the review path so there is always someone who can check, approve and pay.</li>}
        {can('settings.manage') && <li><b>Access → Settings:</b> the rules of the form, file limits, reminders, when the daily emails go out (time, days and time zone; if the server was down it still sends within a few hours, then skips the day), session times, and the privacy notice (retention period, data protection contact, and the version; raising the version makes everyone accept again).</li>}
        {can('settings.manage') && <li><b>Access → Company and Email templates:</b> your name and logo on documents and emails, and the wording of each email.</li>}
        {can('settings.manage') && <li><b>Access → Email schedules:</b> your own reminder emails. Pick the roles and people, which waiting receipts to list (to check, to decide, to pay, to fix), how often (every 30 minutes up to once a day) and the hours and days it may be sent. <b>Preview</b> shows who would get one now, and <b>Send now</b> sends it at once.</li>}
        {can('settings.manage') && <li><b>Access → Email:</b> the mail account. <b>Send a test email</b> checks delivery. If email does not arrive, press <b>Run full check</b>: it tests each step and says what to fix.</li>}
        {can('audit.view') && <li><b>Audit log:</b> everything that happened, with who and when. Entries cannot be edited or deleted. The <b>Emails</b> tab shows every email and whether it was sent.</li>}
      </ul>
      {can('reminder.overview') && <p>Once a day you get one email listing every receipt that has waited too long at any step (checking, deciding, payment or a correction), so you can nudge the right person. The waiting times are set under Access → Settings.</p>}
      <p>Before real use: back up, clear the test data, create real users, then switch off the demo accounts (see the deployment notes).</p>
    </Guide>,
  );

  return (
    <>
      <div className="ph"><div><h1>Help</h1><p>How REIMSYS works{me ? `, and what ${me.role.name} can do` : ''}.</p></div></div>

      <nav className="helpnav" aria-label="On this page">
        <a href="#basics">The basics</a>
        {can('receipt.create') && <a href="#medref">Med Ref</a>}
        {can('review.check') && <a href="#checker">Checker</a>}
        {can('review.decide') && <a href="#approver">Approver</a>}
        {can('payment.mark') && <a href="#accounting">Accounting</a>}
        {(can('user.manage') || can('role.manage') || can('settings.manage') || can('audit.view')) && <a href="#admin">Super Admin</a>}
        <a href="#you">Your account</a>
      </nav>

      <section className="card" id="basics" style={{ marginTop: 16 }}>
        <div className="card-h"><h2>The basics</h2></div>
        <div className="card-b help">
          <p style={{ marginTop: 0 }}>A <b>Med Ref</b> enters a receipt with proof. A <b>Checker</b> verifies it. An <b>Approver</b> decides. <b>Accounting</b> pays it. Each step is recorded, and the people involved are told by the bell and by email.</p>
          <h3>What the labels mean</h3>
          <dl className="helpdl">{STATUSES.map(([s, d]) => <div key={s}><dt>{s}</dt><dd>{d}</dd></div>)}</dl>
          <h3>Finding your way</h3>
          <ul>
            <li>The <b>Dashboard</b> shows what needs you first. The highlighted box is your queue.</li>
            <li><b>Receipts</b> lists receipts. Use the search, the status buttons and the filters. The footer shows how many there are and their total.</li>
            <li>The <b>bell</b> shows what happened. Tap one to open that receipt.</li>
            <li>Photos open in a viewer: scroll or pinch to zoom, drag to move, double-tap to jump in and out.</li>
          </ul>
        </div>
      </section>

      {guides}

      <section className="card" id="you" style={{ marginTop: 16 }}>
        <div className="card-h"><h2>Your account</h2></div>
        <div className="card-b help">
          <ul style={{ marginTop: 0 }}>
            <li>The first time you sign in you choose your own password (the eye button shows what you typed) and read the <Link to="/privacy">privacy notice</Link>.</li>
            <li><Link to="/profile">Profile</Link> is where you change your photo, name, phone and branch, your password, which emails you get, and light or dark appearance. It also lists the devices you are signed in on, and you can sign any of them out.</li>
            <li>For safety you are signed out after a while of no activity.</li>
            <li>Forgot your password? Use <b>Forgot your password?</b> on the sign-in page. A link is emailed to you.</li>
            <li>Something looks wrong? Tell your administrator what you were doing and what you saw.</li>
          </ul>
        </div>
      </section>
      <VersionInfo />
    </>
  );
}
