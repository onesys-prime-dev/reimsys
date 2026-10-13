# Deploying REIMSIS

One Linux server runs everything: Node (API + built web app), MySQL, Nginx for HTTPS. Redis is not needed; the job queue lives in MySQL.

## 1. Server prerequisites

- Node.js 20 or newer, pnpm (`npm i -g pnpm`)
- MySQL 8 or MariaDB 10.4+
- Nginx with a TLS certificate (Let's Encrypt is fine)
- An SMTP account for outgoing mail

## 2. Database

Create the database and two users: one for migrations (full rights on the schema), one for the running app.

```sql
CREATE DATABASE reimsis CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'reimsis_migrate'@'localhost' IDENTIFIED BY '<strong password>';
GRANT ALL ON reimsis.* TO 'reimsis_migrate'@'localhost';
FLUSH PRIVILEGES;
```

Run migrations and seed with the migrate user, then create the app user with `docs/db-grants.sql`. That script removes UPDATE and DELETE on the audit log, so even a bug in the app cannot rewrite history.

## 3. Build and configure

```bash
git clone <repo> /srv/reimsis && cd /srv/reimsis
pnpm install --frozen-lockfile
cp apps/api/.env.example apps/api/.env      # edit it, see below
pnpm --filter @reimsis/api exec prisma migrate deploy
pnpm --filter @reimsis/api db:seed           # creates roles, permissions, categories and the demo users
pnpm build
```

After seeding, sign in as `admin@example.com`, create the real users on the Access page, then deactivate every `@example.com` demo account. The demo password is public, so do not skip this.

`apps/api/.env` for production:

```
NODE_ENV=production
PORT=4000
DATABASE_URL="mysql://reimsis_app:<password>@localhost:3306/reimsis"
WEB_ORIGIN=https://reimsis.example.com
SESSION_DAYS=7
STORAGE_DIR=/var/lib/reimsis/storage
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SMTP_SECURE=false
MAIL_FROM="Your Organisation <no-reply@example.com>"
ORG_NAME="Your Organisation"
```

`WEB_ORIGIN` must be the exact public address, because writes are rejected when the browser's Origin does not match it.

Use `DATABASE_URL` with the migrate user only when running migrations; the running app uses `reimsis_app`.

## 4. Run with PM2

```bash
npm i -g pm2
cd /srv/reimsis/apps/api
pm2 start dist/server.js --name reimsis
pm2 save && pm2 startup
```

The API process also serves the built web app and runs the background worker (emails, PDFs, reports). Run exactly one instance.

## 5. Nginx

```nginx
server {
  server_name reimsis.example.com;
  client_max_body_size 12m;            # evidence files are up to 10 MB
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
mysqldump --single-transaction -u reimsis_migrate -p reimsis | gzip > /backups/reimsis-$(date +%F).sql.gz
tar -czf /backups/reimsis-files-$(date +%F).tgz -C /var/lib/reimsis storage
find /backups -mtime +30 -delete
```

Copy the backups off the server. Test a restore at least once before going live.

## 7. Updating

```bash
cd /srv/reimsis && git pull
pnpm install --frozen-lockfile
pnpm --filter @reimsis/api exec prisma migrate deploy
pnpm build
pm2 restart reimsis
```

## 8. Checks after deploying

- `https://<host>/api/health` returns `{"ok":true}`
- Sign in, then Access > Users: add a test user and confirm the audit log records it
- Admin > Audit log > Emails: send a test by returning a receipt, and confirm the status is `sent`, not `logged`
- Run `node e2e/api-flow.mjs` with `API=https://<host>/api` against a staging copy, never against live data (it creates records)

## Notes

- Report and document layouts are placeholders until the organisation's own forms are supplied. They live in `apps/api/src/lib/documents.ts` and `reports.ts`.
- Evidence files are served only through the API and every view, download and print is audited. Do not expose the storage folder through Nginx.
- Passwords are argon2 hashed. Accounts lock for 15 minutes after 5 wrong attempts; an administrator can unlock sooner.
