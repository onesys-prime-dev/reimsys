# REIMSYS: Final Build Plan (v1)

Reimbursement Management System. First client: a pharmacy.
Visual references: `docs/REIMSYS BUILD PLAN.html` (diagrams) and `docs/REIMSYS UI MOCK.html` (clickable mock, white theme).

## 1. Scope

**In v1:** Med Ref encodes receipts + evidence, Checker verifies, Approver decides. Audit on every action, email and in-app notifications, multi-user access with ranking, monitoring views, CSV/XLSX import and export, evidence upload/view/download/print, reimbursement document per approved receipt, approved-only liquidation reports (PDF/XLSX/CSV), profile page, access control page, responsive UI (phone + PC).

**Not in v1:** Accounting role (design leaves room for it), per-user permission overrides, second-level approval.

## 2. Locked decisions

| Topic | Decision |
|---|---|
| Stack | React + Vite + TypeScript, Node/Express + TypeScript, MySQL (XAMPP MariaDB in dev), Prisma |
| Repo | Monorepo: `apps/api`, `apps/web`, `packages/shared` |
| Auth | Argon2, httpOnly cookie sessions with refresh, CSRF token, lockout after repeated failures |
| Roles | Med Ref, Checker, Approver, Super Admin. Permissions are rows, set per role only |
| Super Admin | Manages users and roles. Cannot approve |
| Statuses | Draft, Submitted, Returned, Checked, Approved, Disapproved, Reserved |
| Reserved | Approver can release it back to the Checked queue |
| Disapproved / Approved | Final. Disapproved can be copied to a new Draft |
| Approval | Any Approver can act; first one wins (optimistic `version` check) |
| Checker queue | Shared, any Checker |
| Checked requires | Evidence viewed at least once (logged) |
| Currency | PHP, `DECIMAL(12,2)` |
| Evidence | JPG/PNG/WEBP/HEIC/PDF, 10 MB each, 10 per receipt, SHA-256 stored, served only via authorised endpoint, audit row written before streaming |
| Files | Storage adapter: local disk now, S3-compatible later |
| Jobs | Email and document/report generation through a queue and worker. DB-backed queue in dev, Redis + BullMQ in production |
| Documents | Reimbursement doc `REIM-YYYY-NNNNNN`, one per approved receipt. Layouts are placeholders until the client's manual forms arrive |
| UI | White, clean, teal accent, light default with optional dark. Matches `docs/REIMSYS UI MOCK.html` |
| Audit | Append-only table. App DB user has no UPDATE/DELETE on it |

## 3. Status rules

| Transition | Who | Required | Effects |
|---|---|---|---|
| Draft to Submitted | Med Ref (owner) | 1+ evidence, valid amount and date | Notify Checkers |
| Submitted to Checked | Checker | Evidence viewed; remarks optional | Notify Approvers |
| Submitted to Returned | Checker | Remarks | Email Med Ref |
| Returned to Submitted | Med Ref | Edited record | Notify Checkers |
| Checked to Approved | Approver | Remark optional | Email, build document |
| Checked to Disapproved | Approver | Reason | Email with reason |
| Checked to Reserved | Approver | Note | Email with note |
| Reserved to Checked | Approver | Remark optional | In-app notice |

All transitions go through one state-machine module. Each writes an audit row and queues notifications.

## 4. Core tables

`roles`, `permissions`, `role_permissions`, `users`, `user_profiles`, `sessions`, `receipts`, `receipt_evidence`, `receipt_reviews`, `reimbursement_documents`, `liquidation_reports`, `import_jobs`, `notifications`, `email_log`, `audit_logs`, `sequences`.

## 5. Delivery phases (all built)

1. **Foundation** (weeks 1-2): monorepo, schema + migrations, auth, roles/permissions, audit middleware, app shell, profile page, access control page. *Done when:* all four roles sign in, a permission change takes effect within a minute, every login is audited.
2. **Med Ref flow** (weeks 2-3): receipt form, drafts, evidence upload and viewer, download/print, submit.
3. **Checker and Approver** (weeks 3-5): state machine, queues, review workspace, evidence-view audit, all decisions.
4. **Notifications** (week 6): queue + worker, email templates, in-app bell, email log with retries.
5. **Documents and reports** (weeks 7-8): reimbursement document, liquidation report (PDF/XLSX/CSV).
6. **Import, monitoring, audit browser** (weeks 8-9).
7. **Polish and release** (week 10): phone/desktop QA, accessibility, real templates, backups, deployment guide.

## 5a. Differences from the first plan

- Redis is not used. The job queue (email, documents, reports) lives in MySQL and runs in the API process. Swap in BullMQ later if the load needs it.
- Receipt history is read from the audit log instead of a separate reviews table.
- Reviewers cannot act on receipts they encoded.
- Evidence views by a Checker are required before checking, counted since the latest submission.
- Added: category list managed by the administrator, email log with retry, daily digest email, audit export.

## 6. Still needed from the client side

- Reimbursement document and liquidation report templates (manual forms).
- SMTP host, sender address, credentials.
- Receipt category list and any budget codes.
- Data retention period.
- Hosting target (assumed: one Linux VM, Nginx, PM2).
- Client branding (logo, colours) to replace the placeholder "R".

## 7. Dev environment

Required on the dev machine: Node.js LTS (20+), npm or pnpm, XAMPP MySQL/MariaDB (present), Git (present). Redis optional in dev.

## 5b. Added after the first release

- **Withdraw:** a Med Ref can pull a submitted receipt back to Draft (only while nobody has checked it). Checkers are told.
- **Delete draft:** a draft can be deleted by its owner, files included. Anything submitted must be withdrawn first.
- **Possible duplicate warning:** a receipt with the same payee, amount and date as another receipt the viewer can see gets a warning with a link.
- **Per-person liquidation reports**, **editable email templates and look**, **email account set up in the app**, **test mode for email**, and the **REIMSYS** name and logo.

## Added after the first release

- **Taking a decision back.** The same approver can undo an approval or disapproval within 10 minutes, with a reason. The receipt returns to Checked, any reimbursement document is removed, and the Med Ref and checker receive a correction email (editable under Access, Email templates).
- **Approvers open the evidence too.** Approve, disapprove and reserve need the approver to have opened the evidence since the receipt was checked, the same rule the checker has.
- **Comments.** Anyone who can see a receipt can post a short comment. People already involved get a bell notice. Comments are in the audit log.
- **Bulk actions.** Checkers can mark up to 25 receipts checked, and approvers can approve up to 25, from the receipt list. Each goes through the normal rules, so receipts whose evidence was not opened are skipped and explained.
- **Receipt list.** Sorting, clear-filters, and an amber "Waiting" flag after two days with the next person.
- **Not yet built (needs a public https address):** forgot-password and invitation emails, because email links are left out until the app has a proper address.

### Added later still

- **Ask for more proof.** An approver who is not satisfied can send a checked receipt back to the Med Ref with a required note. The Med Ref can add photos or correct details and resubmit, and the receipt is checked again from the start. (A checker can already do the same with Return.)
- **Forgot password and invitations.** The sign-in page has "Forgot your password?". It emails a one-hour link, always answers the same way (so it cannot be used to find out who has an account), and ends every older sign-in once the new password is saved. A new user also receives an invitation email with a 72-hour link, in addition to the temporary password shown to the administrator.
- **Zoom fixed.** Zooming a large photo no longer hides its top and left edges.
- **Clear upload errors.** A file over the limit now says so, instead of a generic failure.
- **Retiring the demo accounts.** `pnpm --filter @reimsis/api demo:off` switches off the five shared-password demo accounts. It refuses to run until a real Super Admin exists.

- **Live updates.** Screens update themselves with no refresh (a small "Live" light shows it is connected). See the "Live updates" section in `docs/DEPLOY.md`.
