# Deploying REIMSYS

One Linux server runs everything: Node (API + built web app), MySQL, Nginx for HTTPS. Redis is not needed; the job queue lives in MySQL.

## 1. Server prerequisites

- Node.js 20 or newer, pnpm (`npm i -g pnpm`)
- MySQL 8 or MariaDB 10.4+
- Nginx with a TLS certificate (Let's Encrypt is fine)
- An SMTP account for outgoing mail

## 2. Database

Create the database and two users: one for migrations (full rights on the schema), one for the running app.

```sql
CREATE DATABASE reimsys CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'reimsys_migrate'@'localhost' IDENTIFIED BY '<strong password>';
GRANT ALL ON reimsys.* TO 'reimsys_migrate'@'localhost';
FLUSH PRIVILEGES;
```

Run migrations and seed with the migrate user, then create the app user with `docs/db-grants.sql`. That script removes UPDATE and DELETE on the audit log, so even a bug in the app cannot rewrite history.

## 3. Build and configure

```bash
git clone <repo> /srv/reimsys && cd /srv/reimsys
pnpm install --frozen-lockfile
cp apps/api/.env.example apps/api/.env      # edit it, see below
pnpm --filter @reimsys/api exec prisma migrate deploy
SEED_DEMO=false pnpm --filter @reimsys/api db:seed   # roles, permissions, categories; SEED_DEMO=false = no demo accounts
pnpm --filter @reimsys/api admin:create -- --email you@company.com --name "Your Name"   # the first real Super Admin (temporary password shown once)
pnpm build
```

On a real server seed with `SEED_DEMO=false` and create the first Super Admin with `admin:create`, so no account with the public demo password ever exists. (If you seeded without it, create the real admin, sign in as them, and run `demo:off` as described under Going live.) Sign in, choose a password, accept the privacy notice, then create the other users on the Access page.

`apps/api/.env` for production:

```
NODE_ENV=production
PORT=4000
DATABASE_URL="mysql://reimsys_app:<password>@localhost:3306/reimsys"
WEB_ORIGIN=https://reimsys.example.com
SESSION_DAYS=7
STORAGE_DIR=/var/lib/reimsys/storage
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SMTP_SECURE=false
MAIL_FROM="Your Organisation <no-reply@example.com>"
ORG_NAME="Your Organisation"
```

`WEB_ORIGIN` must be the exact public address, because writes are rejected when the browser's Origin does not match it.

Use `DATABASE_URL` with the migrate user only when running migrations; the running app uses `reimsys_app`.

## 4. Run with PM2

```bash
npm i -g pm2
cd /srv/reimsys/apps/api
pm2 start dist/server.js --name reimsys
pm2 save && pm2 startup
```

The API process also serves the built web app and runs the background worker (emails, PDFs, reports). Run exactly one instance.

## 5. Nginx

```nginx
server {
  server_name reimsys.example.com;
  client_max_body_size 12m;            # evidence files are up to 10 MB
  # Live updates: a long-lived stream that must not be buffered or cut off.
  location /api/events {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_set_header Host $host;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
  }

  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
  listen 443 ssl;   # certbot adds the certificate lines
}
```

## 6. Backups

Two things must be backed up together: the database and the storage folder (evidence, documents, reports, avatars).

```bash
# nightly, e.g. from cron at 02:00
mysqldump --single-transaction -u reimsys_migrate -p reimsys | gzip > /backups/reimsys-$(date +%F).sql.gz
tar -czf /backups/reimsys-files-$(date +%F).tgz -C /var/lib/reimsys storage
find /backups -mtime +30 -delete
```

Copy the backups off the server. Test a restore at least once before going live.

## 7. Updating

```bash
cd /srv/reimsys && git pull
pnpm install --frozen-lockfile
pnpm --filter @reimsys/api exec prisma migrate deploy
pnpm build
pm2 restart reimsys
```

## Upgrading to return reasons

Back up the database first and tag the version you are leaving (`before-return-issues`). Then run `pnpm --filter @reimsys/api exec prisma migrate deploy` (adds one nullable column, `receipt.returnIssues`). Nothing to seed. Receipts that were already returned keep their note and simply have no Fix buttons. To go back: `docs/rollback-return-issues.sql`, or restore the backup.

## Upgrading to the payment step

1. Back up the database and the storage folder, and tag the version you are leaving (`before-payment-step`).
2. `pnpm --filter @reimsys/api exec prisma migrate deploy` (applies `20261015030000_payment_step`: a new `payment` table and four new columns on `receipt`, nothing removed), then `pnpm db:seed` (adds the Accounting role, its permissions and `payment.mark`; edits made on the Access page are kept).
   The seed does not create demo accounts on a system where `pnpm --filter @reimsys/api demo:off` has been run. On a system that still has them, run `demo:off` again after the seed: it now also switches off `accounting@example.com`.
3. As a MySQL administrator, run the new line of `docs/db-grants.sql` for the `payment` table (`SELECT, INSERT` only).
4. Create the real Accounting user on the Access page, and check the payment methods under Access → Settings.
5. To go back: `docs/rollback-payment-step.sql`, or restore the backup.

## 8. Checks after deploying

- `https://<host>/api/health` returns `{"ok":true}`
- Sign in, then Access > Users: add a test user and confirm the audit log records it
- Admin > Audit log > Emails: send a test by returning a receipt, and confirm the status is `sent`, not `logged`
- Run `node e2e/api-flow.mjs` with `API=https://<host>/api` against a staging copy, never against live data (it creates records)

## Notes

- Report and document layouts are placeholders until the organisation's own forms are supplied. They live in `apps/api/src/lib/documents.ts` and `reports.ts`.
- Evidence files are served only through the API and every view, download and print is audited. Do not expose the storage folder through Nginx.
- Passwords are argon2 hashed. Accounts lock for 15 minutes after 5 wrong attempts; an administrator can unlock sooner.

## Before real people use it

1. Sign in as `admin@example.com` and add yourself under Access as a Super Admin (use your real email).
2. Sign in as yourself and change your password.
3. Switch off the demo accounts, which share a public password:
   ```
   pnpm --filter @reimsys/api demo:off
   ```
   It stops with an explanation if no real Super Admin exists yet, so it cannot lock everyone out.
4. Set `WEB_ORIGIN` to the real `https://` address. Emails then include the "Open the receipt" button, and forgot-password and invitation links point at it.
5. Apply `docs/db-grants.sql` so the app cannot change or delete audit entries.

## The live scanner needs https

"Scan receipt" opens the phone's live camera, and browsers only allow that on a secure page (https), or on the same computer (localhost). On a plain `http` address the button quietly uses the phone's own camera app instead, and the receipt can still be scanned (find the edges, straighten, clean up) afterwards.

- **Live server:** serve REIMSYS over https as usual (the Nginx section above, with a real certificate). Nothing else to set.
- **Testing on a phone over Wi-Fi:** `start-lan.ps1` makes a self-signed certificate for this PC's address (needs OpenSSL, which comes with Git for Windows), keeps it in `.lan-cert` (never committed) and starts the server on https. The phone warns once that the certificate is not from a known company: choose Advanced, then Continue.
- The server reads `TLS_CERT` and `TLS_KEY` (paths to the certificate and its key). Both or neither: setting only one stops it from starting, so nobody believes they are on https when they are not.

## Live updates

Screens update by themselves: when someone approves a receipt, the person watching it sees it change, the checker's queue fills in, and the bell lights up, with no refresh.

- It uses one small open connection per browser tab (Server-Sent Events, `/api/events`). Nothing private travels on it. It only says which area changed, and the screen then asks for the new data in the normal way with its own permissions.
- If the connection drops (Wi-Fi blip, sleeping phone), the screen shows **Offline**, reconnects on its own, and refreshes everything once.
- Behind nginx, keep the `/api/events` block above (`proxy_buffering off`), or updates arrive late in lumps.
- The signals are kept in the API process. That is right for one API process. If you ever run several API processes behind a load balancer, add Redis publish/subscribe so a change made on one reaches people connected to another (the hub in `apps/api/src/lib/realtime.ts` is the only place to change).

## Database table names

Every table has a lower-case name (`user`, `receipt`, `comment` ...). The indexes and foreign keys are lower-case too; the migrations create them that way. This matters on **Linux**, where MySQL treats `User` and `user` as different tables. On Windows it changes nothing.

A new database is built with `pnpm db:migrate` and ends up identical to the schema. This was checked on a fresh database (migrations and database both match the schema exactly).

## Speed
- The server compresses text (pages, scripts, data) and keeps the fingerprinted files in `/assets` in the browser for a year, so repeat visits download almost nothing. The live-update stream (`/api/events`) is never compressed.
- Screens people open rarely (Access, Audit, Import, Reports, Profile, the receipt form) load only when opened, so the first page is much smaller.
- If nginx or Caddy sits in front, it can compress instead; just keep `/api/events` unbuffered and uncompressed (see "Live updates").
- A small VPS should have at least 1 GB of memory for the database, and sign-in is the heaviest action (the password check is deliberately slow).
6. Back up (`node scripts/backup.mjs`), then clear the test receipts and files that built up while testing:
   ```
   pnpm --filter @reimsys/api data:clear -- --confirm <database name>
   ```
   It keeps users, roles, rights, settings and categories, restarts the reference numbers, and refuses to run unless you type the database name. Set up the nightly backup from `docs/BACKUP.md` before the first real receipt.
7. Check who holds which rights on the Access page. One person must never be able to check, approve and pay the same receipt: the system now refuses it (a checker cannot decide on a receipt they checked, and nobody can pay a receipt they encoded, checked or approved), but the Super Admin should not be handed all three roles anyway.

## Limited database login on one computer (XAMPP or a single server)
Instead of typing the SQL by hand, run `node scripts/setup-db-users.mjs` (it only shows what it would do) and then `node scripts/setup-db-users.mjs --yes`. It creates `reimsys_app` (what the running system uses; it can read and append to the history log but never change or delete it, see `docs/db-grants.sql`) and `reimsys_migrate` (full rights on the database), saves the old `.env` as `.env.before-app-user`, points `DATABASE_URL` at `reimsys_app` and adds `MIGRATE_DATABASE_URL`. Restart the API afterwards. To go back, copy `.env.before-app-user` over `.env`.

After that, anything that changes the structure or clears data uses the full-rights login automatically when `MIGRATE_DATABASE_URL` is in `.env`: `pnpm db:migrate`, `pnpm db:seed`, `pnpm --filter @reimsys/api data:clear`, `node scripts/backup.mjs` and `node scripts/restore.mjs`. The running API and `demo:off` use `reimsys_app`. `prisma migrate deploy` run by hand reads the same file, so it also uses the full-rights login.

## Privacy notice (added 2026-10-20)
Everyone sees the privacy notice once after signing in (after choosing a password) and must tick "I understand" before the app opens. It is also readable before signing in (link on the sign-in page) and from the sidebar.
1. Back up. Run `pnpm --filter @reimsys/api db:deploy` (adds two nullable columns to `user`, migration `20261020010000_privacy_notice`). `docs/db-grants.sql` needs no change.
2. The wording is in `apps/web/src/pages/Privacy.tsx`. Replace the two "To be confirmed by your administrator" lines (retention period, data protection contact) when the client decides, then raise `PRIVACY_VERSION` in `packages/shared/src/privacy.ts` so everyone reads it again.
3. The demo accounts from the seed start with the notice accepted, so the test scripts can sign in. Real users always see it. Each acceptance is in the history log (`privacy.accepted`).
4. To go back: `docs/rollback-privacy-notice.sql`, or restore the backup.
5. Checks: `node e2e/privacy-flow.mjs` (API) and `node e2e/privacy-ui.mjs` (browser, computer and phone).

## Go-live runbook (Linux server)
Do these in order. Step 9 is the gate: it must report no blockers.

1. Server: Node 20+, pnpm, MariaDB/MySQL, Nginx, a DNS name and a certificate (`certbot --nginx`).
2. Database and users: section 2, then `docs/db-grants.sql`, or on one machine `node scripts/setup-db-users.mjs --yes`. Give the MySQL `root` account a password (`mysql_secure_installation`).
3. Build and configure: section 3. Set `NODE_ENV=production`, the real `WEB_ORIGIN`, `STORAGE_DIR` outside the code folder, SMTP and `MAIL_FROM`. Add `BACKUP_COPY_TO=/mnt/offsite` (another disk, a mounted network or cloud-synced folder).
4. Migrate with the full-rights login, seed with `SEED_DEMO=false`, create the first admin with `admin:create`.
5. Run it (section 4 PM2) behind Nginx (section 5). Open `https://<host>/api/health`.
6. Email: sign in, Access → Email, send a test; then check forgot-password and an invitation end to end.
7. Backups: add to cron `0 2 * * * cd /srv/reimsys && node scripts/backup.mjs >> /var/log/reimsys-backup.log 2>&1`, run it once by hand, and rehearse a restore into a spare database (`docs/BACKUP.md`).
8. Monitoring: add `*/5 * * * * cd /srv/reimsys && node scripts/healthcheck.mjs --webhook <your chat or ntfy.sh URL>`. It checks the API, free disk space, backup age and stuck emails, and posts only when something is wrong.
9. Gate: `node scripts/preflight.mjs`. Fix every BLOCKER (production mode, https address, SMTP, real From address, no demo accounts, a real Super Admin, a recent backup). Read the advice lines.
10. Phone check: open the https address on a phone, sign in, and use "Scan receipt" (the live camera only works on https).
11. Fill in the retention period and data protection contact in `apps/web/src/pages/Privacy.tsx`, raise `PRIVACY_VERSION`, rebuild, and have the client's lawyer or data protection officer approve the wording.
12. Before the first real receipt: if any test receipts exist, back up, then `data:clear`.

Fonts are bundled with the app, so no visitor's address is sent to Google. Everything the page loads comes from your own server.
