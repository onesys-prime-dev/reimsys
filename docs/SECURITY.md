# REIMSYS security notes

What is protected, how it was checked, and what still needs a decision from whoever hosts it.

## How it is protected

| Area | What is in place |
|---|---|
| Sign-in | Passwords are stored as Argon2 hashes. Five wrong passwords lock the account for 15 minutes. Sign-in attempts from one place are rate limited. A wrong password takes the same time and gives the same message whether or not the account exists. |
| Passwords | At least 10 characters with a letter and a number. The commonest passwords, repeated characters, and the public demo password are refused. |
| Sessions | Random 256-bit token in an HttpOnly, SameSite cookie (Secure in production). Stored hashed. A session ends after **60 minutes without real activity** (clicks and typing, not background refreshes) and never lasts past **12 hours**. Idle people get a two-minute warning. Change with `SESSION_IDLE_MINUTES` and `SESSION_MAX_HOURS`. Changing a password, or an administrator ending a session, signs the account out everywhere. Switching an account off closes its live connection immediately. |
| Access control | Every request is checked on the server against the person's permissions and, for receipts, against whose receipt it is. A Med Ref sees only their own. Approvers see only what has been checked. Drafts are private to their writer. Reviewers cannot act on receipts they encoded. Decisions need a recorded check, and checkers and approvers must open the evidence first. |
| Cross-site requests | Writes need a custom header and an Origin that matches the address the page came from. Other websites cannot act for a signed-in person. No CORS is offered. |
| Uploads | File type is read from the file's own first bytes, never from its name or declared type. Only JPG, PNG, WEBP, HEIC and PDF are accepted, up to 10 MB. Stored under random names, outside the web folder, and only served through the app (which records who looked). Names with `../` or line breaks are harmless. |
| Spreadsheets | Uploaded .xlsx files are checked for zip bombs before they are opened. Exported CSV cells that begin with `=`, `+`, `-` or `@` are stored as plain text so they cannot run as formulas. |
| Injection | Database access is parameterised. Input is validated with strict schemas. Emails and PDFs escape what people type. |
| Browser | A strict content security policy, no framing by other sites, no content sniffing, no referrer leakage, HSTS in production. |
| Secrets | The saved email password is encrypted. It is never shown, logged or returned, not even to administrators. `.env` and the storage folder are not in the repository. |
| Audit | Every sign-in, failed sign-in, action, evidence view, download, print and settings change is recorded with who, what and when. With `docs/db-grants.sql` applied, the app cannot change or delete audit rows. |
| Password links | One-time, hashed, short-lived, only the newest works, and the "forgot password" page answers identically for every address, in the same time. |
| Dependencies | No known vulnerabilities in what ships (`pnpm audit --prod`). A few notices remain in build-only tools that do not run in production. |

## How it was checked

`node e2e/security.mjs` sends hostile requests to a running server and reports anything that gets through. It tries: reaching every endpoint without signing in, every role against administrator functions, reading and changing other people's receipts, files and sessions, extra fields to promote oneself, requests from other websites, SQL-injection and oversized input in every search and filter, dangerous uploads (scripts, programs, fake images, `../` names), spreadsheet formulas, timing and message differences that would reveal who has an account, forged cookies, floods of sign-ins, guessed reset links, and requests for secret files from the web address. At the time of writing: **78 checks, 0 findings**.

Also covered by automated tests: `e2e/session.mjs` (idle and maximum session rules), `e2e/realtime-api.mjs`, and the unit tests.

## Still needs doing by whoever hosts it

1. **Serve it only over HTTPS** and set `NODE_ENV=production` so the session cookie is marked Secure and HSTS is on. Put the real address in `WEB_ORIGIN`.
2. **Apply `docs/db-grants.sql`** with a separate, restricted database user. Until then the "audit entries cannot be changed" promise depends on the application code, not the database.
3. **Switch off the demo accounts** (`pnpm --filter @reimsys/api demo:off`). They share a public password, which is also written in the README and test scripts.
4. **Keep the `storage` folder private and backed up** together with the database. It holds the evidence and the key that unlocks the saved email password. To keep that key elsewhere, set `SETTINGS_KEY`.
5. **Email from your own domain** and publish SPF, DKIM and DMARC records, so approval and reset emails are trusted and cannot be forged easily.
6. **Back up and monitor.** Watch for repeated failed sign-ins in the audit log.

## Known limits

- The live-update hub and rate limits live in one server process. Running several copies behind a load balancer needs a shared store (Redis) for both.
- A signed-in administrator can point the email settings at any server address. That is by design (they are trusted), but it means administrator accounts deserve strong passwords and, ideally, two-factor sign-in, which is not built yet.
- The lock-out message ("account locked") appears only for real accounts, so someone determined could use it to confirm an address exists. Closing that fully would mean never telling a real person why they cannot sign in, which is worse for them.
- There is no two-factor sign-in yet.
