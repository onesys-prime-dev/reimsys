# Email

REIMSIS sends email when a receipt is returned, approved, disapproved, put on hold, or released, plus an optional morning summary. Mail goes through a queue and is retried for you if the mail server is down.

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
| Returned for correction | the Med Ref |
| Approved | the Med Ref and the Checker |
| Disapproved | the Med Ref and the Checker, with the reason |
| Put on hold | the Med Ref and the Checker, with the note |
| Hold released | the Med Ref, only if they turned that on in their profile |
| Daily summary (about 8am) | anyone who has it turned on, only if they have something waiting |

New receipts waiting to be checked and checked receipts waiting for approval notify people inside the app only (the bell), not by email, so inboxes do not fill up.
