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
- **Retiring the demo accounts.** `pnpm --filter @reimsys/api demo:off` switches off the five shared-password demo accounts. It refuses to run until a real Super Admin exists.

- **Live updates.** Screens update themselves with no refresh (a small "Live" light shows it is connected). See the "Live updates" section in `docs/DEPLOY.md`.
- Security: see docs/SECURITY.md. Idle timeout (60 min, with warning), 12-hour limit, stronger passwords, formula-safe exports, spreadsheet bomb guard.

## Phase 2: the client's Google Form (planned, not built)

Source: the client's current "REIMBURSEMENT FORM" (11 screenshots in `REIMSIS SYSTEM PLAN/forms`). The system replaces that form, so a receipt must capture everything the form does.

### What the form asks, step by step
1. **Start:** email (the signed-in user replaces this) and "New Reimbursement Code? If no, write the code".
2. **Details:** "With BIR Registered Invoice under SOLARA PHARMA CORP.?" Yes / No.
3. **Company check** (when Yes): three ticks that the company name, TIN (801-590-238-00000) and address are completely visible on the invoice.
4. **Invoice:** invoice date, invoice no., vendor name, vendor address, vendor TIN, gross amount (before any deduction), Business transaction: Product / Service.
5. **VAT:** Vatable / Non-vatable (letterhead says "VAT" or "NON-VAT"), vatable amount (without VAT and deductions), VAT amount (0 if none), Withheld tax? Yes / No.
6. **Withholding** (when Yes): rate and amount.
7. **End** and submit.

### Mapping to REIMSYS
| Form | REIMSYS today | Change |
|---|---|---|
| Email | signed-in user | none (dropped) |
| Reimbursement code | ref no. per receipt | decide: one code per claim or per receipt |
| BIR invoice, 3 company ticks | none | new fields; the Checker confirms each tick against the evidence |
| Invoice date / gross amount | receipt date / amount | reuse |
| Invoice no., vendor TIN, vendor address | none | new fields (payee becomes vendor name) |
| Product / Service | category | new field (categories stay for reports) |
| VAT type, vatable amount, VAT amount | none | new fields, checked: vatable + VAT = gross |
| Withheld tax, rate, amount | none | new fields, checked: rate x base = amount |

### Behaviour
- The encode screen becomes a step-by-step wizard with the same order as the form, skipping steps that do not apply.
- Maths and TIN format (000-000-000-00000) are checked as the person types. Default: warn, do not block.
- The Checker sees the answers beside the evidence and confirms the three company ticks as seen / not seen.
- Our own company name, TIN and address become admin settings, not code.
- New columns flow into the receipt PDF, reports, CSV/XLSX export and import, and the email templates. Old receipts keep working with the new fields empty.

### Open questions for the client
1. Is a **reimbursement code** one claim holding several receipts, or one per receipt? (If a claim, a "claim" record sits above receipts: the biggest change.)
2. What happens when there is **no BIR invoice**: reject, or a lighter path with a required explanation?
3. Block or only warn when VAT / withholding maths does not add up?
4. Do the current categories stay next to Product / Service?

### Build order
1. Database fields and shared validation (with unit tests). 2. Wizard form. 3. Checker view. 4. PDF, reports, import/export, emails. 5. Browser tests and docs.

### Decisions (from the client)
- **Reimbursement code:** not needed. The client uses it only because Google Forms cannot show past reimbursements. REIMSYS already has history, search and a reference number (the "code") on every receipt, so the question is dropped and no claim grouping is built. One receipt = one reference number.
- **No BIR invoice:** allowed. The company check is skipped and a written reason is required; the Checker decides.
- **VAT / withholding maths:** warn only.
- **Categories:** replaced by Product / Service.

### Impact review (what this change touches)
A search found 185 mentions of category / payee across 36 files (schema, shared rules, API routes, documents, reports, imports, emails, web pages, tests). Live data: 26 receipts, 22 categories (17 are leftover test categories).

**Data (additive, nothing is deleted)**
- `receipt` gains: `birInvoice` (yes/no), three "company seen" ticks, `noBirReason`, `invoiceNo`, `vendorAddress`, `vendorTin`, `transactionType` (product/service), `vatType` (vatable/non-vatable), `vatableAmount`, `vatAmount`, `withheld` (yes/no), `whtRate`, `whtAmount`, and the Checker's three confirmations.
- Reused as they are: `payee` = vendor name, `receiptDate` = invoice date, `amount` = gross amount, `refNo` = the reimbursement code.
- `categoryId` becomes optional. The category table and old receipts are kept so old reports and history still read correctly; new receipts do not use categories. The 17 test categories are removed.
- Company name / TIN / address become a setting (`company`), editable by an admin.
- Old receipts keep the new fields empty and show "not recorded". The migration is one additive step, safe to run on the live database and on Linux.

**Rules (shared package, used by server and screen alike)**
- Draft: anything may be partly filled. Submit: required fields depend on the answers (BIR yes needs invoice no., vendor TIN, VAT block; BIR no needs the written reason).
- Warnings (never blocking): vatable + VAT differs from gross; withholding rate x base differs from amount; TIN not 000-000-000-00000; invoice date in the future; same vendor TIN + invoice no. already filed (duplicate).
- The receipt state machine (submit, check, return, approve, ...) does not change.

**Screens**
- Receipt form: a step-by-step wizard in the same order as the client's form (BIR, company check, invoice, VAT, withholding, evidence, review), mobile friendly, with a review page before submit. The same pages serve edit and "returned for correction".
- Receipt detail: the form answers in groups beside the evidence; Checker confirms the three company ticks as seen / not seen (a not-seen one needs a note); flagged warnings are shown to the Checker and Approver.
- Receipts list and search: new columns and search by invoice no., vendor, vendor TIN; filters by Product/Service and VAT type replace the category filter.
- Access page: category management is removed; a Company details card is added.

**Outputs**
- Receipt PDF (reimbursement document) shows the invoice, VAT and withholding blocks.
- Reports (PDF / XLSX / CSV): new columns, totals for gross, vatable, VAT and withheld; grouping by Product/Service instead of category; per-person reports unchanged.
- Import (CSV / XLSX): new template with the new columns; the old template still works. Export matches.
- Emails: templates can use invoice no. and vendor; defaults updated.
- Audit: every change still records old and new values for the new fields.

**Tests that must change**
- Unit: new validation, warnings and duplicate rules (shared); documents, emails, reports.
- Scripts: `api-flow`, `ui-flow`, `security` (new fields, bad numbers, formulas in vendor name), `real-files` / import, realtime and email tests that create receipts with a category.

### Suggested build in safe steps (each ends with typecheck + tests + a push)
1. **Foundation:** migration, schema, shared rules and warnings, API accepts the new fields (old fields still work, so nothing breaks).
2. **Form:** wizard, review page, detail view, list and search.
3. **Checker:** confirmations, warnings display, return / approve unchanged.
4. **Outputs:** PDF, reports, import / export, emails.
5. **Cleanup:** remove category use, company settings page, test categories, docs, full browser test run.

### Defaults I will use unless told otherwise
- Duplicate invoices (same vendor TIN + invoice no.): warn the Checker.
- When BIR = No: invoice no. and vendor TIN are optional, VAT and withholding steps are skipped.
- Product / Service is required on every receipt.
- The Checker cannot finish checking while a company tick is "not seen" without a note.

### Phase 2 status: built
Built on the branch `feature/client-form`, in this order: database fields and shared rules, API (create / edit / copy / export / check / reports / import), the step-by-step form, the detail page with the Checker's confirmation, list filters, reports and the receipt PDF, company details (Access > Company), and tests.

- Wizard: BIR invoice -> company check (or reason) -> invoice -> VAT -> withholding (only if tax was withheld) -> proof and review. Answers that do not apply are dropped when saving.
- Warnings (never blocking): vatable + VAT differs from gross, VAT not 12% of the vatable amount, non-vatable with VAT, withholding rate x base differs from the amount, badly formed TIN. Shown to the Med Ref while typing and to the Checker and Approver on the receipt. Duplicate invoices (same vendor TIN + invoice no.) are flagged too.
- The Checker answers "seen / not seen" for the company name, TIN and address when marking a BIR-invoice receipt checked. A "not seen" answer needs a note. Bulk check skips these on purpose.
- Receipts made before this change (and rows imported from the old template) keep their data, show "not recorded", and must have the invoice details filled in before they can be submitted.
- Categories are no longer used on new receipts (the table is kept for old ones); Product / Service replaces them in lists, reports and exports.
- Tests: 89 unit tests, `e2e/client-form.mjs` (47 checks), `e2e/client-form-ui.mjs` (browser, desktop and phone), plus the older suites updated for the new form.

### Going back (rollback)
The work lives on its own branch, so `main` is untouched until it is merged.
1. **Before merging:** just do not merge, or switch back with `git checkout main`. The git tag `before-client-form` marks the exact starting point.
2. **Database:** the migration only adds columns and makes the category optional. Old code keeps working on the new database as long as every receipt has a category (new receipts do not). `docs/rollback-client-form.sql` removes the new columns and gives category-less receipts a category first.
3. **Full restore:** a complete backup of the database and the evidence files was taken just before starting (`reimsys-backups/before-client-form-*.sql` and `storage-before-client-form.tgz`, next to the project folder). Restoring it loses anything done since.

### Form flow updated to the client's flow chart (reimbursement_form_flow_spacious.png)
1. **Reimbursement details:** With BIR-registered invoice? Yes / No.
2. **No:** a short screen (date, vendor name, vendor address, amount paid to vendor), then the reason for spending.
3. **Yes:** "Invoice under SOLARA PHARMA CORP.?" Yes leads to the company check (three ticks); No skips the ticks. Then the BIR invoice details (date, invoice no., vendor name, address, TIN, gross amount, Product / Service), then VAT details.
4. **Withheld tax: Yes** leads to the withholding step and the form finishes there (as drawn: no reason for spending). **No** leads to the reason for spending.
5. **Reason for spending:** a specific reason and one classification (Fuel, Representation, Meal, Meeting/seminar/convention, Transportation, Parking, Printing or photocopying, Other).
6. **Proof and review:** proof stays required (up to the file limit in Settings), then submit. The chart's "Review the details?" question, the "new reimbursement code" and the "reference no. cancellation" are left out: REIMSYS shows a review page, numbers every receipt, and keeps the history.

Changes in data: three new optional columns (`invoiceUnderCompany`, `reasonForSpending`, `classification`; migration `20261015010000_form_flow`, undone by the second part of `docs/rollback-client-form.sql`). The written "no BIR reason" is no longer asked. Product / Service is asked only on the BIR path; reports fall back to the classification for receipts without a BIR invoice. The Checker's "seen / not seen" answers are asked only when the invoice is under the company.
