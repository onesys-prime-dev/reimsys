# DevOps hand-off: update staging, then promote to production

The staging server already exists. This page says what to update on it, what to check, and what must be different on production. Details live in `docs/DEPLOY.md` (general), `docs/BACKUP.md`, `docs/EMAIL.md` and `docs/SECURITY.md`.

## What it is
One Node process (the API) that also serves the built web app and runs the background worker (emails, PDFs, reports). MariaDB/MySQL for data. A storage folder for uploaded receipts, documents and reports. Nginx in front for HTTPS. **Run exactly one API instance.**

## 1. Update staging (do this first)
```bash
cd /srv/reimsys            # or wherever it is deployed
# 1. back up first: node scripts/backup.mjs     (database + storage folder)
git pull
pnpm install --frozen-lockfile
pnpm --filter @reimsys/api exec prisma migrate deploy     # uses the full-rights database login
pnpm build
pm2 restart reimsys
```
- **One new migration** since the last release: `20261020010000_privacy_notice` (adds two empty columns to `user`). Nothing is lost. To undo: `docs/rollback-privacy-notice.sql`, or restore the backup.
- `docs/db-grants.sql` needs **no change** (the new columns are on an existing table).
- Everyone is asked to accept the privacy notice at their next action. That is expected.

## 2. Settings for the environment (`apps/api/.env`)
| Setting | Staging | Production |
|---|---|---|
| `NODE_ENV` | `production` (so it behaves like live) | `production` |
| `WEB_ORIGIN` | the staging https address | the real https address, exactly as users type it |
| `DATABASE_URL` | the **limited** login `reimsys_app` | the same |
| `MIGRATE_DATABASE_URL` | full-rights login, used by migrations, seed, backup and restore | the same |
| `STORAGE_DIR` | a folder outside the code folder | the same; back it up with the database |
| `SETTINGS_KEY` | a long random text, set **before** the mail password is saved | a different long random text, kept with the other secrets |
| `SMTP_*`, `MAIL_FROM` | optional (the mail account can be saved in the app: Access → Email) | a real sender address on a domain the company controls (SPF and DKIM set) |
| `BACKUP_COPY_TO` | optional | a folder on another disk or a synced/mounted share |
| `RATE_LIMIT_OFF` | **leave unset** | **leave unset** (a test-only switch; it is ignored in production anyway) |

Staging currently shows "Not Secure": it is served over plain http. **Put a certificate on it.** The phone's live camera scanner only works over https, and password and invitation links in emails are only shown on a real https address.

## 3. After the update: checks (all should pass)
```bash
node scripts/preflight.mjs                       # go-live gate: lists blockers and advice
pnpm --filter @reimsys/api mail:check -- --to you@company.com    # why email would not send, step by step
node scripts/healthcheck.mjs                     # prints nothing when all is well
```
- `https://<host>/api/health` returns `{"ok":true}`.
- **The API must be rebuilt AND restarted, not only the web app.** Check: `curl https://<host>/api/auth/privacy-info` must return JSON with `retention`, `contact` and `version`. If it returns a 404 or lacks `version`, the web page is newer than the API (seen on staging: the Settings page then showed "Required" boxes and could not save). Run `pnpm build` and `pm2 restart reimsys`, and make sure the process restarted is the one serving the port.
- Sign in, open **Audit log → Emails**: a test from **Access → Email → Send a test email** must show status `sent`, not `logged`.
- On a phone over https: sign in, New receipt, Scan receipt.
- Do **not** run `e2e/*.mjs` against production (they create records). They are for a development or staging copy only.

## 4. What production needs that staging may not have
1. **No demo accounts.** Seed with `SEED_DEMO=false pnpm --filter @reimsys/api db:seed`, then create the first Super Admin with `pnpm --filter @reimsys/api admin:create -- --email <address> --name "<name>"` (a temporary password is printed once). The demo password is public; never leave those accounts active. On an existing database: create the real admin, sign in as them, then `pnpm --filter @reimsys/api demo:off`.
2. **A clean database.** Test and sample receipts must not go live. On a new production database there are none. If data was copied from staging: back up, then `pnpm --filter @reimsys/api data:clear -- --confirm reimsys` (keeps users, roles, settings, categories).
3. **Database logins.** `reimsys_app` is created from `docs/db-grants.sql` (it can read and append to the audit log but never change or delete it) and `reimsys_migrate` has full rights on the one database. The app must never run as `root`. Give the database `root` account a password.
4. **Backups.** Cron the nightly backup, copy it off the server, and rehearse one restore into a spare database (`docs/BACKUP.md`):
   `0 2 * * * cd /srv/reimsys && node scripts/backup.mjs >> /var/log/reimsys-backup.log 2>&1`
5. **Monitoring.** `*/5 * * * * cd /srv/reimsys && node scripts/healthcheck.mjs --webhook <chat or ntfy URL>` (posts only when the API, disk space, backup age or the email queue is wrong).
6. **Nginx.** Use the block in `docs/DEPLOY.md` section 5. Two points matter: `client_max_body_size 12m` (evidence files are up to 10 MB) and the `/api/events` block with `proxy_buffering off` (live updates).
7. **Never expose the storage folder** through Nginx. Files are served only by the API, which records every view.

## 4a. The live database is new and empty: first start, in this order
1. Create the database and the two logins (`docs/DEPLOY.md` section 2), and apply `docs/db-grants.sql` **after** the migrations.
2. `pnpm --filter @reimsys/api exec prisma migrate deploy` (runs every migration from the start, with the full-rights login).
3. `SEED_DEMO=false pnpm --filter @reimsys/api db:seed` (roles, rights, categories; **no demo accounts**).
4. `pnpm --filter @reimsys/api admin:create -- --email <address> --name "<name>"`. Hand the printed temporary password to that person; they choose their own at first sign-in and read the privacy notice.
5. Start the API (`pm2`), set `SETTINGS_KEY` **before** step 6, then that admin signs in and sets up **Access → Email** (the mail account is stored in the database, so a new database starts without one), the company details, the categories, and Access → Settings → Privacy notice (retention period and contact).
6. Create the real users from Access → Users. Run `node scripts/preflight.mjs` and clear every BLOCKER.
Because the database is new, there is nothing to clear and no demo accounts to switch off. Do not copy staging data into it.

## 5. Rollback
Restore the backup taken in step 1 (`node scripts/restore.mjs backups/<folder> --yes`, stop the API first), then `git checkout <previous tag>`, `pnpm install --frozen-lockfile`, `pnpm build`, `pm2 restart reimsys`.

## 6. Please send back
- The output of `node scripts/preflight.mjs` and `mail:check`.
- Whether email arrives from the live server (and, if not, the status text from Audit log → Emails).
- The https address, so the team can finish the notice and first-user setup.

## Still to come from the project team (not blockers for deploying)
The client's retention period and data protection contact (filled in under Access → Settings → Privacy notice), their document and report layouts, and the final category list and branding.
