# Email

REIMSYS sends email when a receipt is returned, approved, disapproved, put on hold, or released, plus an optional morning summary. Mail goes through a queue and is retried for you if the mail server is down.

## Try it without a real mail account

```powershell
node e2e/smtp-catcher.mjs C:\temp\mailbox        # a pretend mail server on port 1025; saves each email as an .html file
# in another window, start the API pointing at it:
$env:SMTP_HOST="localhost"; $env:SMTP_PORT="1025"; pnpm dev:api
```

Open any saved `.html` file to see the email. Nothing leaves your computer.

## Send real email (in the app)

Sign in as the Super Admin and open **Access, Email**:

1. Pick **Gmail**, **Microsoft 365 / Outlook**, or **Other**. The server and port fill in for you.
2. Enter your **username** (usually your email address) and **password**.
   - **Gmail:** use an **App password**, not your normal password. Turn on 2-step verification, then create one at https://myaccount.google.com/apppasswords.
3. Enter the name and address emails should come from.
4. Press **Test connection**. It signs in without sending anything and tells you in plain words if something is wrong (wrong password, wrong address, wrong port).
5. Press **Save**, then use **Send a test email** to send one to yourself.

The password is stored encrypted and is never shown again, not even to administrators. Every change is recorded in the audit log without it. Only people with the "Manage email and system settings" permission (the Super Admin by default) can see this page.

Back up the `storage` folder together with the database: it holds the key that unlocks the saved password. To keep the key somewhere else, set `SETTINGS_KEY` in the server environment.

## Send real email (server settings instead)

Instead of the page above, you can put these in `apps/api/.env` and restart the API. An account saved in the app takes priority over these:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=<app password>
SMTP_SECURE=false
MAIL_FROM="Your Organisation <you@gmail.com>"
ORG_NAME="Your Organisation"
```

**Gmail:** turn on 2-step verification, then create an **App password** at https://myaccount.google.com/apppasswords and use that as `SMTP_PASS` (your normal password will not work). Gmail limits how many messages you can send per day, which is fine for this volume.

**Other providers** (Microsoft 365, SendGrid, Mailgun, your own server) work the same way: use the host, port, user and password they give you. Port 465 needs `SMTP_SECURE=true`; port 587 uses `false`.

Never commit `.env`. It is already ignored by git.

## Check it works

Sign in as the administrator, open **Audit log**, then **Emails**:

- The top banner says **Sending through <host>** when settings are loaded, or warns that emails are only being logged.
- Type an address and press **Send test email**. It should show **sent** within a few seconds.
- A **failed** row shows the reason (wrong password, host unreachable, and so on). It retries by itself, up to 5 times, waiting a little longer each time. **Retry** sends it again straight away.

## Who gets what

| Event | Email goes to |
|---|---|
| Returned for correction | the Med Ref. It lists the problems the Checker ticked (in words), then any note, and its button opens the receipt form on the first problem's step |
| Approved | the Med Ref and the Checker |
| Disapproved | the Med Ref and the Checker, with the reason |
| Put on hold | the Med Ref and the Checker, with the note |
| Hold released | the Med Ref, only if they turned that on in their profile |
| Reimbursement paid | the Med Ref who was paid: one email per payment, listing every receipt and amount, the method, date and payment number |
| Payment reversed | the Med Ref, with the reason, telling them to disregard the earlier payment notice |
| Daily summary (about 8am) | anyone who has it turned on, only if they have something waiting |
| Waiting receipts reminder (about 9am) | Checkers, Approvers, Accounting, or the Med Ref of a returned receipt, once a day each, only when receipts have waited longer than the days set under Settings → Reminders (0 turns one off) |

New receipts waiting to be checked, checked receipts waiting for approval, and approved receipts waiting to be paid (for Accounting) notify people inside the app only (the bell), not by email, so inboxes do not fill up.

The two payment emails can be edited like the others. Extra placeholders: `{{paymentNo}}`, `{{method}}`, `{{paidOn}}` and, in the paid email, `{{receiptList}}` (one line per receipt).

## Changing what the emails say

Sign in as the Super Admin and open **Access, Email templates**.

- **Look and feel** sets the organisation name, a footer line and the brand colour used by every email.
- Pick an email from the list. You can change its **subject**, **heading**, **message** and **button text**, and switch the receipt details table on or off.
- Click a detail such as `{{refNo}}` or `{{payee}}` to drop it into the text where your cursor is. Each email only offers the details that make sense for it. A detail it does not have is flagged and Save is blocked, because it would come out empty.
- In the message, leave a blank line between paragraphs. A line that starts with `>` becomes a highlighted box (used for the reason or note). The box disappears by itself when nothing was written.
- The **Preview** is built by the server from your unsaved text, so it is exactly what would be sent. Switch between Computer and Phone. **Send a sample** emails it to any address with "[Sample]" in the subject.
- **Reset to default wording** brings the original text back. Every edit is recorded in the audit log.

Links in emails: the button only appears when REIMSYS has a normal `https://` address. Until then the email says "Sign in to <name> to open it" instead, because mail with links to a bare IP address or plain http is far more likely to be marked as spam.

## Demo and example addresses

Addresses on `example.com`, `example.org`, `example.net`, `.test`, `.invalid` and `localhost` can never be real mailboxes, so REIMSYS does not try to send to them. They show as **logged** in Audit log, Emails ("Example address, not a real mailbox, so it was not sent"). This stops the seeded demo users from producing bounce messages in your inbox, for example from the morning summary. A local test mailbox (`localhost`) can still receive them, so testing is unaffected. Real users on real addresses are not affected.

## Email works here but not on the live server: what to check
Open **Audit log → Email log** on the live system. Every email has a status, and the text next to it says why.
1. **"Example address, not a real mailbox, so it was not sent"** (status *logged*). Addresses on example.com, .test and similar are never sent to. The demo accounts (admin@example.com and the others) will never get email. Use real addresses on the live system.
2. **"No mail account is set up yet"** (*logged*). The live database has no mail account. The account is saved in the database, so a new server starts without one. Enter it in **Access → Email** (or in `.env`).
3. **"The saved mail password cannot be unlocked on this server"** (*failed*, and a red box above the log). The database was moved to a new server without the key that locks the password (`storage/.settings-key`, or `SETTINGS_KEY` if you set it). Enter the mail password again in Access → Email, then save. To avoid it next time, set `SETTINGS_KEY` in `.env` before saving the password, and keep it with your other secrets.
4. **"The server rejected the username or password"** (*failed*). For Gmail use an App password (see above), not the normal password.
5. **"Could not connect…" or "did not answer in time"** (*failed*). The live server cannot reach the mail server. Many hosting providers block outgoing mail ports (25, and sometimes 465 or 587). Ask the provider, or use a mail service that offers port 2525 or an API relay.
6. **Sent, but nothing arrives.** The log says "Accepted for…" (the mail server took it). Check the spam folder. Mail from a company address needs SPF and DKIM set up for that domain, and a "from" address on a domain you control. Gmail rewrites the From address to the signed-in account.
7. **Nothing is queued at all.** `node scripts/healthcheck.mjs` reports emails stuck for more than 30 minutes, and the API process must be running (the sender is part of it).
`node scripts/preflight.mjs` checks that a mail account exists and warns when `SETTINGS_KEY` is not set.
