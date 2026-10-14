# REIMSYS

Reimbursement Management System. Med Refs encode receipts with evidence, a Checker verifies, an Approver decides. Every step is audited and emailed, and ends in a reimbursement document and liquidation reports.

Plan: [docs/PLAN.md](docs/PLAN.md) · Diagrams: `docs/REIMSYS BUILD PLAN.html` · Clickable mock: `docs/REIMSYS UI MOCK.html` · Deploying: [docs/DEPLOY.md](docs/DEPLOY.md)

## Requirements

- Node.js 20+ and pnpm 12
- MySQL or MariaDB (XAMPP is fine). Redis is not needed.

## First run

```powershell
pnpm install
copy apps\api\.env.example apps\api\.env      # then check DATABASE_URL
C:\xampp\mysql\bin\mysql.exe -u root -e "CREATE DATABASE IF NOT EXISTS reimsys CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
pnpm db:migrate
pnpm db:seed
pnpm dev
```

- Web: http://localhost:5173
- API: http://localhost:4000/api/health

## Dev accounts

Password for every seeded account: `Reimsys#2026`. Development only. Deactivate them before going live.

| Role | Email |
|---|---|
| Super Admin | admin@example.com |
| Approver | paolo.v@example.com |
| Checker | liza.santos@example.com |
| Med Ref | ana.reyes@example.com, mark.dc@example.com |

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | API and web app with hot reload |
| `pnpm typecheck` | Type check all packages |
| `pnpm test` | Unit tests (workflow rules, file detection, CSV, validation) |
| `pnpm test:api` | End-to-end API check of the whole workflow (needs the API running) |
| `pnpm test:ui` | Drives the real UI in Chrome through the main journey (needs API and web running) |
| `pnpm build` | Production build of the web app and API |

## What is built

- **Sign in and access:** argon2 passwords, lockout after 5 failures, revocable sessions, forced password change, roles and permissions stored as data with locked grants, last-administrator guard.
- **Receipts:** drafts, categories, evidence upload (JPG/PNG/WEBP/HEIC/PDF, real file type checked, duplicates flagged), in-app viewer, download and print.
- **Review workflow:** one state machine (Draft, Submitted, Returned, Checked, Approved, Disapproved, Reserved) shared by the API and the UI. Checker must open the evidence before checking, reasons and notes are required where the plan says, reviewers cannot review their own receipts, stale edits are rejected.
- **Audit:** every action, including each evidence view, download and print, is written to an append-only log. `docs/db-grants.sql` makes it append-only at the database level too.
- **Notifications:** in-app bell, emails through a retrying queue with an email log (and a daily digest). Without SMTP settings, emails are logged and not sent.
- **Documents and reports:** one reimbursement PDF per approved receipt; liquidation reports for approved records only as PDF, XLSX or CSV.
- **Import and export:** CSV or XLSX import with a preview and error report before anything is saved; export of any list.
- **Screens:** dashboard per role, receipts, review workspace, reports, import, profile, access control (users, roles and permissions, categories), audit log, email log. Phone and desktop.

## Layout

- `apps/api` Express + Prisma API, background worker
- `apps/web` React + Vite app
- `packages/shared` roles, permissions, state machine and validation shared by both
- `e2e` end-to-end scripts (use the installed Chrome)
- `docs` plan, mock, deployment guide, database grants

## Still needed from the client

Their own reimbursement document and liquidation report forms (the current layouts are placeholders), SMTP details, the real category list, branding, and a data retention period.
