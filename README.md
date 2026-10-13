# REIMSIS

Reimbursement Management System. See [docs/PLAN.md](docs/PLAN.md) for the plan, `docs/REIMSIS UI MOCK.html` for the clickable mock.

## Requirements

- Node.js 20+ (24 LTS installed), pnpm 12
- MySQL or MariaDB (XAMPP is fine). Redis is not needed in development.

## First run

```powershell
pnpm install
copy apps\api\.env.example apps\api\.env      # then check DATABASE_URL
# create the database once:
C:\xampp\mysql\bin\mysql.exe -u root -e "CREATE DATABASE IF NOT EXISTS reimsis CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
pnpm db:migrate
pnpm db:seed
pnpm dev
```

- Web: http://localhost:5173
- API: http://localhost:4000/api/health

## Dev accounts

Password for every seeded account: `Reimsis#2026` (development only, change before any real deployment).

| Role | Email |
|---|---|
| Super Admin | admin@example.com |
| Approver | paolo.v@example.com |
| Checker | liza.santos@example.com |
| Med Ref | ana.reyes@example.com, mark.dc@example.com |

## Layout

- `apps/api` Express + Prisma API (auth, users, roles, permissions, audit, profile)
- `apps/web` React + Vite app
- `packages/shared` roles, permissions, validation shared by both
- `e2e` Playwright scripts (uses installed Chrome)
- `docs` plan and mock

## Phase 1 status

Done: monorepo, schema and migration, argon2 sign in with lockout, cookie sessions you can revoke, forced password change, roles and permissions as data with locked grants, last-admin guard, append-only audit log, profile page, access control page, audit log page.

Next (phase 2): receipts, evidence upload and viewer, submit.
