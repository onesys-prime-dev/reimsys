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
| Roles | Med Ref, Checker, Approver, Accounting, Super Admin. Permissions are rows, set per role only |
| Super Admin | Manages users and roles. Cannot approve. Cannot mark paid by default (can be granted on the Access page, audited) |
| Accounting | Rank 25. Marks approved receipts as paid (`payment.mark`, locked). Sees only Approved and Paid receipts. Never pays a receipt they encoded |
| Statuses | Draft, Submitted, Returned, Checked, Approved, Disapproved, Reserved, Paid |
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
| Approved to Paid | Accounting (not the encoder) | Payment date, method, proof file, amount per receipt (a shortfall needs a reason) | One email to the Med Ref per payment |
| Paid to Approved | Accounting | Reason | Email: disregard the payment notice. The payment row and proof stay |

The Approver's "take back" (undo) only works from Approved, so a paid receipt must have its payment reversed first.

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
- **Reimbursement code:** not needed as a claim number (the client used it only because Google Forms cannot show past reimbursements). One receipt = one reference number. *Superseded on 2026-11-20 for processing:* see **Batches** at the end of this plan.
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
5. **Reason for spending:** a specific reason (one line) and "Choose the general classification of your reason", in the same order as the client form: Fuel; Meeting, Seminar, or Convention; Representation; Transportation; Parking; Printing or Photocopying; Meal; Other: (with a box for their own words, required when Other is chosen; column `classificationOther`, migration `20261015020000_classification_other`).
6. **Proof and review:** proof stays required (up to the file limit in Settings), then submit. The chart's "Review the details?" question, the "new reimbursement code" and the "reference no. cancellation" are left out: REIMSYS shows a review page, numbers every receipt, and keeps the history.

Changes in data: three new optional columns (`invoiceUnderCompany`, `reasonForSpending`, `classification`; migration `20261015010000_form_flow`, undone by the second part of `docs/rollback-client-form.sql`). The written "no BIR reason" is no longer asked. Product / Service is asked only on the BIR path; reports fall back to the classification for receipts without a BIR invoice. The Checker's "seen / not seen" answers are asked only when the invoice is under the company.

## Payment step (built 2026-10-15)
Spec: `docs/superpowers/specs/2026-10-15-payment-step-design.md`. Plan: `docs/superpowers/plans/2026-10-15-payment-step.md`.
- **Role:** Accounting (`accounting`, rank 25). Permission `payment.mark` (locked for Accounting). Default grants: `payment.mark`, evidence view/download/print, reports.
- **Status:** Approved → Paid (pay) and Paid → Approved (reverse, reason required). Paid cannot be edited, withdrawn or deleted.
- **Data:** table `payment` (`PAY-YYYY-NNNNNN`, payee, method, date, proof file with type, size and SHA-256, who recorded it). Receipts gain `paymentId`, `paidAmount`, `paidShortReason`, `paidAt`. Migration `20261015030000_payment_step`, undone by `docs/rollback-payment-step.sql`. The app database user can only read and add payment rows.
- **Rules:** one payment covers one person's receipts (up to 25), the amount per receipt is at most the receipt amount, a shortfall needs a reason, the date cannot be in the future, the proof (JPG/PNG/WEBP/HEIC/PDF) is required for every method. All receipts change in one transaction with a version check, so a receipt is never paid twice.
- **Screens:** "Ready to pay" (queue by person, tick boxes, "Mark as paid" bar and dialog), Payment card on the receipt (proof view/download/print, audited), "Reverse payment", Paid pill and filter, Accounting dashboard, approver tiles "Approved, not paid" and "Paid", report Payment filter with paid columns and totals, payment methods list under Access → Settings.
- **Notices:** Med Ref gets one email per payment (`paid`) and one per reversal (`payment_reversed`); Accounting gets an in-app notice when a receipt is approved, no email.
- **Tests:** `packages/shared/test/payments.test.ts`, `e2e/payment-flow.mjs` (API, every role), `e2e/payment-ui.mjs` (browser, computer and phone).

## Return reasons (built 2026-10-16)
Plan: `docs/superpowers/plans/2026-10-16-return-issues.md`.
- **What:** when a Checker returns a receipt, or an Approver asks for more proof, they tick problems from a short list instead of typing. The Med Ref sees each problem with a **Fix** button that opens the receipt form on the right step.
- **The list** (one place: `packages/shared/src/returnIssues.ts`): photo blurry or cut off; photo missing or wrong file (both go to Proof and review); amount, date, vendor name/address/TIN, invoice number (go to Invoice details); VAT or withholding (VAT details); reason for spending or classification (Reason for spending); and "Something else" (no Fix, the note says it).
- **Rules:** ticks make the note optional; nothing ticked, or "Something else", needs words. The problems are saved as codes in `receipt.returnIssues` and the typed note stays in `lastNote`. They are replaced on every return and cleared whenever the receipt leaves Returned. Notices, emails and the history show the ticked problems in words, then the note.
- **Fix:** opens `/receipts/<id>/edit?step=<step>`, only for the owner while the receipt can be edited. The form skips steps the answers make unnecessary, so a step that does not exist (for example VAT on a receipt with no BIR invoice) falls back to Invoice details; an unknown or misplaced `?step=` is ignored. Receipts returned before this feature show their note as before, with no Fix buttons.
- **Data:** one additive nullable column (migration `20261016010000_return_issues`), undone by `docs/rollback-return-issues.sql`.
- **Tests:** `packages/shared/test/returnIssues.test.ts`, `e2e/return-issues-flow.mjs` (API), `e2e/return-ui.mjs` (browser, computer and phone).

## Still missing (review of 2026-10-20)
Code, typecheck and the 189 unit tests are fine. These are the gaps between "built" and "live". Tick them off as they are done.

### Must do before real receipts
- [ ] **Limited database login.** Run `node scripts/setup-db-users.mjs --yes` so the system stops using `root` and the history log is append-only at the database level. It has never been run. (The script is deleted in the working tree: restore it or commit the deletion.) Add it to `docs/DEPLOY.md` and `docs/SECURITY.md`.
- [ ] **Production settings.** `NODE_ENV=production`, real https address in `WEB_ORIGIN`, `TLS_CERT`/`TLS_KEY` or Nginx, real `MAIL_FROM`.
- [ ] **Real email.** Fill in the SMTP details; until then emails are only written to the email log.
- [ ] **Remove dev accounts.** Deactivate the seeded accounts (shared password `Reimsys#2026`) and create the real users.
- [ ] **Clear test data.** Back up, then `data:clear` (keeps users, roles, settings, categories; restarts reference numbers).
- [ ] **Nightly backup + restore test.** Schedule `scripts/backup.mjs` (see `docs/BACKUP.md`), copy backups off the machine, and do one test restore.

### Needs the client
- [ ] Their own reimbursement document and liquidation report layouts (current ones are placeholders).
- [ ] The real category list, branding (logo, name), and a data retention period (then build the retention clean-up).

### Not built yet
- [ ] **Forgot-password and invitation emails.** Already built; the button link is left out of emails until `WEB_ORIGIN` is a public https address. Set it, then test both end to end.
- [ ] **Retention clean-up.** Nothing deletes or archives old records yet; build once the client sets the period.
- [ ] **Monitoring.** Something that checks `/api/health` and tells someone when the API, worker or email queue stops, and when the disk is nearly full.
- [ ] **Run the end-to-end checks against a staging copy.** `e2e/api-flow.mjs` and the UI scripts were not part of this review; run them with `API=https://<host>/api` before go-live.
- [ ] **User guide / training notes** for Med Refs, Checkers, Approvers and Accounting.

### Housekeeping
- [ ] The test screenshots in the project root (`bulk-*.png`, `comments*.png`, `undo-*.png`) change on every UI test run: commit them once or move them to a git-ignored folder.

## Go-live plan (2026-10-20)
Everything still open, in the order to do it. Each step ends with typecheck + tests. "Owner" is who has to act.

### Step 1. Privacy notice and first-sign-in acknowledgement (build)  · Owner: developer, wording from client
- **Page:** `/privacy`, readable without signing in, linked from the sign-in page and the sidebar footer. It says: what is collected (name, email, receipts and evidence images, vendor TINs, the history log including who viewed what), why, who can see it (by role), how long it is kept, that REIMSYS uses one cookie only to keep people signed in (no analytics, no third-party scripts), how to ask for a correction, and who the data protection officer is.
- **Acceptable-use line** on the same page: submit only genuine receipts, do not share your login, every action is recorded. No separate Terms page (staff only).
- **Acknowledgement:** after sign-in, a user who has not accepted the current version sees a short "I understand" screen (next to the forced password change). Stored on the user as `privacyAcceptedVersion` and `privacyAcceptedAt` (one additive migration, with a rollback in `docs/`). Accepting is written to the history log. Changing the version in one place makes everyone accept again.
- **Cookie:** no banner. Check the web app for any analytics or outside scripts before go-live.
- **Tests:** shared unit test for the version check, API flow (blocked until accepted, then allowed), browser check on computer and phone.

### Step 2. Database login and production settings  · Owner: developer + server admin
1. Back up (`node scripts/backup.mjs`).
2. Restore `scripts/setup-db-users.mjs`, run it without `--yes` to review, then with `--yes`. Restart the API. Confirm the app works and that the history log cannot be changed (try an UPDATE as `reimsys_app`: it must be refused).
3. Document the script in `docs/DEPLOY.md` and `docs/SECURITY.md`.
4. Set `NODE_ENV=production`, `WEB_ORIGIN` to the real https address, `TLS_CERT`/`TLS_KEY` or Nginx, and a real `MAIL_FROM`.

### Step 3. Email  · Owner: client gives SMTP details
1. Fill `SMTP_*` in `.env`, send a test from Settings, check the email log.
2. With the https address in place, switch on and test forgot-password and invitation emails (currently left out).

### Step 4. Client inputs  · Owner: client
1. Reimbursement document and liquidation report layouts: replace the placeholders and have the client sign off a sample PDF/XLSX.
2. Real category list and branding (logo, name): enter in Access → Settings.
3. Data retention period: write it into the privacy notice, then build the retention clean-up (Step 6).

### Step 5. Users and clean data  · Owner: developer + client
1. Create the real users and roles; deactivate every seeded account (shared password `Reimsys#2026`).
2. Run the end-to-end checks (`e2e/api-flow.mjs`, payment, return and UI scripts) against a staging copy, never live data.
3. Back up, then `data:clear` to remove test receipts and files (keeps users, roles, settings, categories).

### Step 6. Safety nets  · Owner: developer + server admin
1. **Backups:** schedule `scripts/backup.mjs` nightly (`docs/BACKUP.md`), copy off the machine, do one test restore with `scripts/restore.mjs` into a spare database.
2. **Monitoring:** a check on `/api/health` every few minutes, plus alerts for a stopped worker or email queue and low disk space; the alert goes to one named person.
3. **Retention clean-up:** a scheduled job that archives or deletes records older than the agreed period, audited, with a dry-run mode.

### Step 7. Training and launch  · Owner: client + developer
1. Short guide per role (Med Ref, Checker, Approver, Accounting) with the existing screenshots.
2. Pilot with a few Med Refs for a week; fix what they find.
3. Launch day: backup, confirm health check, confirm first real receipt flows through to a reimbursement document.

### Housekeeping (any time)
- Decide on `scripts/setup-db-users.mjs` (restore or commit the deletion).
- Commit the regenerated test screenshots once, or move them to a git-ignored folder.

### Done means
All boxes in "Still missing" ticked, privacy notice live and accepted by every user, a restore test passed, and a nightly backup visible in `backups/`.

## Plan for today (2026-10-20)

REIMSYS — October 20, 2026

1. Restore scripts/setup-db-users.mjs and stop the screenshots in the project root showing as modified.
2. Back up, then run setup-db-users.mjs (dry run, then --yes) so the system stops using root. Restart the API.
3. Test sign-in, submitting a receipt and the audit log; confirm the app login cannot change or delete audit rows.
4. Add setup-db-users.mjs to docs/DEPLOY.md and docs/SECURITY.md.
5. Write the Privacy notice (what is collected, why, retention, contact, the one sign-in cookie, acceptable-use lines). (Needs client's lawyer or data protection officer to confirm)
6. Add the Privacy page (linked from sign-in and sidebar) and the first sign-in "I understand" step, with a test.
7. Set NODE_ENV=production, real https WEB_ORIGIN, TLS or Nginx, and real MAIL_FROM. (Needs the real values)
8. Configure SMTP and perform a test send; then switch on forgot-password and invitation emails and test both.
9. Back up the live database before clearing test data. (Wait for approval before clearing)
10. Create the first real users, then deactivate the seeded dev accounts.
11. Set up nightly backups in Task Scheduler, copy them off the machine, and rehearse a restore.
12. Run pnpm typecheck, pnpm test, then test:api and test:ui against a staging copy; check /api/health over https.
13. Ask the client for: document and report layouts, final categories and branding, retention period, data protection contact.

Not for today: retention clean-up, monitoring and alerts, user guide.

## Implementation plan (full review, 2026-10-20)
This replaces "Go-live plan" and "Plan for today" above where they differ. Nothing in it has been built or run yet.

### What the review found
1. **Forgot-password and invitation emails are already built** (`routes/auth.ts`, `lib/passwordLinks.ts`). Only the button link is left out of emails until `WEB_ORIGIN` is a public address (`isPublicLink` in `lib/email.ts`). So this is a test after `WEB_ORIGIN` and SMTP are set, not a build. The "Not built yet" line in "Still missing" is wrong.
2. **Switching to the limited database login will break the maintenance tools.** `scripts/backup.mjs`, `scripts/restore.mjs` and `prisma/clear-test-data.ts` all read `DATABASE_URL`, which becomes `reimsys_app` (no DROP, CREATE, or UPDATE/DELETE on the audit log and payments). Nothing in the code reads `MIGRATE_DATABASE_URL`, which the setup script adds. `pnpm db:migrate` and `db:seed` have the same problem. `mysqldump --routines` may also be refused. Fix before switching: those tools use `MIGRATE_DATABASE_URL` when it is set.
3. **Order matters for the new privacy columns.** A migration needs the full-rights login. Run it while `.env` still uses root, then switch users. `docs/db-grants.sql` needs no change, because the columns go on the existing `user` table.
4. **The first-sign-in gate already has a pattern to copy.** `middleware/auth.ts` blocks everything except `/api/me`, `/api/me/password` and `/api/auth/logout` while `mustChangePassword` is set, and `App.tsx` shows `ForcePasswordPage`. The privacy step follows the same shape, after the password step.
5. **Every e2e script that signs in will be blocked by the new gate** until the user has accepted. A shared helper must accept the notice after login, or the tests fail for the wrong reason. Also stop the live-update connection (`useLive`) from starting before acceptance.
6. **`demo:off` refuses to run without another active Super Admin**, so create the real admin first.
7. **No analytics or outside scripts and one cookie (`reimsys_sid`)** were found, so no cookie banner. The privacy page must say this and only this.
8. **Nothing in the app mentions privacy yet** (`/privacy` does not exist). It must be reachable before sign-in (`App.tsx` signed-out routes).
9. `docs/PLAN.md` has overlapping sections; this one is the source of truth.

### Phase A: build and fix locally (no approval needed, nothing live changes)
Each step ends with `pnpm typecheck` and `pnpm test`.
1. **Repo:** `git checkout scripts/setup-db-users.mjs`; add the root screenshots to `.gitignore`.
2. **Maintenance tools use the migrate login.** In `scripts/backup-lib.mjs` (`dbConfig`) and `prisma/clear-test-data.ts`, prefer `MIGRATE_DATABASE_URL`, else `DATABASE_URL`. Add `--no-tablespaces` if mysqldump asks for it. Document the PowerShell line for `db:migrate` and `db:seed`. Test by running a backup and a restore into `reimsys_restore_test` with only the migrate login.
3. **Privacy columns.** `User.privacyAcceptedVersion Int?` and `privacyAcceptedAt DateTime?`; migration `20261020010000_privacy_notice`; `docs/rollback-privacy-notice.sql`.
4. **Shared:** `PRIVACY_VERSION = 1` and `needsPrivacy(user)` in `packages/shared`, with a unit test (null, old version, current). `me` returns `privacyRequired`.
5. **API:** `POST /api/me/privacy` records version and time and writes an audit entry (`privacy.accepted`). Extend `requireAuth` so a user who must accept can only call `/api/me`, `/api/me/privacy`, `/api/auth/logout` (code `PRIVACY_REQUIRED`), after the password rule. Add `/api/privacy` as a public read of the version if the page needs it.
6. **Web:** `pages/Privacy.tsx` (the notice text, one place); public route `/privacy` in the signed-out routes and a signed-in route; links on `Login.tsx` and the sidebar footer; `PrivacyAcceptPage` shown after `ForcePasswordPage` in `App.tsx`; `useLive` waits for acceptance.
7. **Notice text:** what is collected, why, who sees it by role, retention (placeholder "to be confirmed by the client"), the one sign-in cookie and no analytics, how to ask for a correction, the data protection contact (placeholder), and the three acceptable-use lines.
8. **Tests:** update the shared e2e login helper to accept the notice; add `e2e/privacy-flow.mjs` (blocked until accepted, then allowed, audit entry written, new version asks again); add a browser check on computer and phone. Run `pnpm test:api`, `pnpm test:ui`, and `node e2e/security.mjs` on the dev copy.
9. **Docs:** `DEPLOY.md` (setup script, the migrate-login commands, privacy rollout and rollback), `SECURITY.md` (database login, privacy gate), `BACKUP.md` (which login backups use), fix the "Not built yet" line above.

### Phase B: database login (needs your go-ahead, changes the live setup)
1. `node scripts/backup.mjs`; confirm the newest folder in `backups/` has `database.sql` and `files.tar.gz`.
2. `node scripts/setup-db-users.mjs` (dry run), then `--yes`; restart the API.
3. Check: sign in, submit a receipt, open the audit log. As `reimsys_app` an UPDATE or DELETE on `auditlog` and `payment` must be refused.
4. Re-run a backup and the restore rehearsal with the new login.
To go back: copy `apps/api/.env.before-app-user` over `.env`.

### Phase C: production settings and email (needs real values from you)
Needed: the https address, certificate or Nginx, SMTP host/user/password, the From address.
1. `NODE_ENV=production`, `WEB_ORIGIN`, `TLS_CERT`/`TLS_KEY` (or Nginx), `MAIL_FROM`. Check `/api/health` over https.
2. SMTP in Settings; send a test; check the email log.
3. Test forgot-password and an invitation end to end (the button must now appear). Publish SPF/DKIM/DMARC for the sending domain.
4. On a phone over https, test the live scanner.

### Phase D: data and accounts (needs your approval for each step)
1. Back up the live database. **Wait for approval before clearing.**
2. `data:clear` with the migrate login.
3. Create the first real Super Admin, sign in as them, then create the other real users.
4. `pnpm --filter @reimsys/api demo:off`.
5. Each real user accepts the notice on first sign-in; confirm in the audit log.

### Phase E: safety nets
1. Nightly backup in Windows Task Scheduler (`docs/BACKUP.md`), a copy off the machine, one restore rehearsal.
2. Run `pnpm typecheck`, `pnpm test`, `test:api`, `test:ui` and `e2e/security.mjs` against a staging copy.

### Waiting on the client (blocks the privacy wording, not the build)
Retention period, data protection contact, lawyer sign-off on the notice, document and report layouts, final categories and branding.

### Later
Retention clean-up (needs the period), monitoring and alerts, user guide.

### Risks and how each is handled
| Risk | Handling |
|---|---|
| Backup or restore fails after the user switch | Phase A step 2, rehearsed in Phase B step 4 |
| Everyone is locked out by the privacy gate | Gate allows `/api/me`, accept and logout only; tested; rollback SQL; the version constant is the single switch |
| Tests fail because of the gate | Shared login helper accepts the notice |
| Real data cleared by mistake | Backup first, approval first, `data:clear` needs the database name typed |
| Locked out of admin when turning off demo accounts | `demo:off` already refuses without another active Super Admin |

### Phase A progress (2026-10-20)
- Done: setup script restored; screenshots untracked and git-ignored; backup, restore, seed, `data:clear` and migrations use `MIGRATE_DATABASE_URL` when present; privacy notice built (migration `20261020010000_privacy_notice`, rollback `docs/rollback-privacy-notice.sql`, shared version rule, API gate and `POST /api/me/privacy`, public `/privacy`, first-sign-in acceptance, sidebar link); `e2e/privacy-flow.mjs` and `e2e/privacy-ui.mjs` pass; `realtime-api` and `realtime-ui` accept the notice for the users they create; docs updated (`DEPLOY.md`, `SECURITY.md`, `BACKUP.md`).
- Found by the new test: the gate must also let the password change through (it comes first). Fixed.
- Left for later phases: the live limited-login switch (Phase B), production settings and email (C), data and accounts (D), nightly backup and the full run on a staging copy (E).

### Phase B done (2026-10-20)
- The system now runs as `reimsys_app`; `reimsys_migrate` is used by migrations, seed, `data:clear`, backup and restore (`MIGRATE_DATABASE_URL`). Checked as `reimsys_app`: reading the history log works; UPDATE and DELETE on `auditlog`, UPDATE on `payment` and DROP TABLE are refused. `api-flow` (128 checks) and `privacy-flow` pass on the limited login.
- A backup and a restore into `reimsys_restore_test` (881 receipts) both worked with the new login. The setup script now also grants `reimsys_migrate` that one spare database name, so restores can be rehearsed. The "REIMSYS nightly backup" scheduled task (02:00, `node scripts/backup.mjs`) already exists and last ran OK; it now uses the migrate login. Backups are still on the same disk: copy them elsewhere.
- **XAMPP MariaDB had damaged its own system tables** while this was being done (not reimsys data). Repaired: `mysql.global_priv`, `columns_priv`, `procs_priv`, `proxies_priv`, `roles_mapping`, `db`, `gtid_slave_pos` (recreated). `multi-master.info` held 487 lines of error-log text, which made MariaDB refuse to start; it was emptied (original kept in `C:\xampp\mysql\data_quarantine_20261020`, with 1,120 stray `master-*`, `relay-log-*` files moved there). Raw copy of the data folder before repairs: `C:\xampp\mysql\data_before_repair_20261020`.
- **Check your other XAMPP projects.** Repairing `mysql.db` dropped 5 per-database permission rows. `hris_test` and `pma` now show only USAGE. If an app fails with "access denied", grant it again on its own database. When everything works, the two safety folders can be deleted.

### Review follow-up (2026-10-20, later)
- Done: the Access user list shows who has accepted the privacy notice (`e2e/access-tabs.mjs` opens every Access tab on computer and phone: all pass); test data cleared with `data:clear` (backup `backups/20261020-021040` first) and all test users deactivated, leaving only the six demo accounts; live scanner (`scan-ui`, `scan-live`), `reminders`, `api-flow`, `privacy-flow`, `payment-flow`, `return-issues-flow` and `ui-flow` pass on the clean database.
- **Still to do:** remove Check, Approve, Pay and Create receipt from the Super Admin role (Access → Roles and permissions). Not done: it needs the administrator's own say-so.
- Still needs real values: https address, SMTP, From address (Phase C); first real Super Admin, real users, then `demo:off` (Phase D); phone camera and real inbox tests.
- Done (later): Check, Approve, Pay and Create receipt removed from the Super Admin role (audited). Super Admin now has 11 rights and sees Dashboard, Receipts, Reports, Access and Audit log. Role sweep: no problems.

### Production readiness work (2026-10-20, evening)
Target: a Linux server / VPS (`docs/DEPLOY.md`, new "Go-live runbook").
- Done: fonts bundled with the app (no Google requests; CSP tightened to the app's own address; checked in Chrome through the API port with no CSP errors); `scripts/preflight.mjs` (go-live gate, lists blockers and advice); `scripts/healthcheck.mjs` (API, disk, backup age, stuck emails, optional webhook); `BACKUP_COPY_TO` / `--copy-to` off-disk backup copy (tested); `SEED_DEMO=false` seed and `pnpm --filter @reimsys/api admin:create` so a real server never has demo accounts (tested on a spare database); runbook, BACKUP and SECURITY docs updated.
- On this dev PC `node scripts/preflight.mjs` reports 6 blockers: production mode, https address, SMTP, real From address, demo accounts active, no real Super Admin. These only clear on the real server.
- Still needs from you: the server and domain, SMTP details and From address, the first real admin's name (email given: onesysprimedev@gmail.com), the retention period and data protection contact, lawyer sign-off on the notice, document/report layouts, categories and branding.

## System plan for 2026-10-21
Only the software itself. Items follow the list agreed on 2026-10-21. Another working session is committing to the same branch, so: **fetch and merge before every commit, one item per commit, and note a claimed item in this list before starting it.**

### Already landed today (verify, do not rebuild)
- **2. Remove photo** (`949c5ab`): button on Profile, audit entry, API tests.
- **3. Privacy fields in Settings** (`4d47682`): retention period, data protection contact and notice version are Settings fields; the notice reads them.
- **12. Test reliability** (`949c5ab`): sign-in rate limits can be reset for test runs.
- Verification to do first: `pnpm typecheck`, `pnpm test`, `api-flow`, `privacy-flow`, `profile-flow`, `profile-ui`, `privacy-ui`; open Access → Settings and the Privacy page; remove a photo in Chrome; raise the version and confirm everyone is asked again.

### Order of work (smallest and safest first; each ends with typecheck, unit tests and the browser tests that touch it)
| # | Item | What changes | How it is checked |
|---|---|---|---|
| A | Verify the three landed items | nothing, unless a test fails | the tests above |
| B | **7. Phone filters** on Audit log, email log, Access users | reuse the Receipts `Filters` button pattern (`.fgroup`) | `role-sweep`, `access-tabs`, phone screenshots |
| C | **8. Compact headings** on the new-receipt form and the receipt detail page | CSS and small markup; keep Back link and status/amount block | `privacy-ui`, `return-ui`, `ui-flow`, screenshots |
| D | **4. Access → Email warning and full check** | move the `mail:check` logic into `lib/mailDiagnose.ts` (used by the command and by `POST /api/settings/mail/diagnose`); add `passwordUnreadable` to the mail settings view; a "Run full check" button lists each step (account, key, name, ports, login) with ok or the fix | unit test with a fake host and a wrong key, `email-settings` test, a new API test |
| E | **5. Receipts footer total** | the list endpoint also returns the sum of amounts for the current filters (all pages, one `aggregate` query, same permission filters); the footer shows "N receipts · ₱total" | `api-flow`: the sum equals the sum of all pages for several filters and for a Med Ref (own receipts only) |
| F | **9. Dark mode sweep** | a script takes dark screenshots of every screen for every role on computer and phone; fix low contrast (variables first, then individual rules) | screenshots reviewed one by one; an automated contrast check on text and pill colours |
| G | **11. Help page** | `/help` with one short guide per role (what you do, step by step, what the statuses mean, who to ask), linked from the sidebar footer and the phone menu; text first, existing screenshots where they help | each role sees only its own guide plus the shared basics; `role-sweep` |
| H | **10. Retention clean-up** | see below | see below |
| I | **1. Live scanner outline** | see below | see below |
| J | **6. Ready to pay** | see "Decisions" | |

### 10. Retention clean-up (largest, destructive, so built in two safe phases)
- The app's database login cannot delete payments or history rows (`docs/db-grants.sql`), so "delete old receipts" is not possible for the app as it is, and the history log must stay anyway.
- **Phase 1 (build now, deletes nothing):** a setting "keep records for N months" (empty = off, the default); a **preview** that lists, by status and month, which receipts would be affected (only finished ones: paid, disapproved, and approved-and-paid, older than N months by their last decision date); an admin-only page with an export of that list (CSV) and an audit entry each time it is run. Check: the counts match a direct database query.
- **Phase 2 (only after the rule is decided):** archive, not delete: a migration adds `archivedAt` to `receipt`; archived receipts are hidden from lists and reports but still open by direct link for audit; their evidence files are moved into a dated archive folder that the backup also copies. Fully reversible with an "unarchive". Rollback SQL in `docs/`.

### 1. Live scanner outline (needs the real photo)
- Send the original photo of the Metro Parking ticket. It is turned into a small fixture next to `light-desk-frame.json`.
- The detector is tuned against that fixture plus the 202 existing tests, which must all keep passing. A first attempt without the photo was tried and removed because it broke an existing scene.
- If the outline still cannot be made right, the fallback is a visible "Outline looks wrong? Drag the corners" hint in the camera screen and starting the editor on the whole frame.

### Decisions needed
1. **Ready to pay (J):** each person's group already has a pinned header with their receipt count and total, inside one scrolling list. Making every group scroll separately would give a scroll box inside a scroll box. Recommendation: leave as it is.
2. **Footer total (E):** a total across all pages needs the new server number. Recommendation: add it.
3. **Retention (H):** archive (reversible) or delete? Recommendation: archive. Which statuses count as finished, and what is the starting period? Phase 1 can be built without these.
4. **Photo (I):** please send the original ticket photo.

### Done means
All items ticked, every browser test green on a clean run, `docs/PLAN.md` and the docs updated, and one commit per item on `myBranch`.

### Progress on the system plan (2026-10-21)
- A done: Remove photo, privacy fields in Settings and the rate-limit switch verified; the privacy settings test now puts everything back (it used to leave the raised version and test text behind).
- B done: Audit activity filters and Export behind a Filters button on phones (the email log and Access users have a single control, so no button was needed).
- C done: the form heading was already one line; the receipt detail title brought in line.
- D done: Access → Email "Run full check" (account, key, name, ports, login), red warning for an unreadable password, `mail:check` shares the same checks (`e2e/mail-check.mjs`).
- E done: the Receipts footer shows the total of every matching receipt (`e2e/list-total.mjs` compares it to the sum by hand).
- F done: `e2e/dark-sweep.mjs` (dark, or `--light`) measures text contrast on every screen for every role; 0 low-contrast texts in both modes on 82 screens.
- G done: Help page (`/help`), guides shown by what a person may do (`e2e/help-ui.mjs`).
- H phase 1 done: Access → Settings → "Keeping records": a keeping period in months (0 = off) and a preview of finished receipts (paid or disapproved) older than it, with a CSV list; it changes nothing and is audited (`e2e/retention.mjs`). **Phase 2 (archive) is not built**: it waits for the rule (which statuses, which period, archive or delete).
- I waiting for the original photo of the Metro Parking ticket.
- J left as it is (already pinned per-person headers with totals).

### System plan: final state (2026-10-21)
- Rebuilt after the other session's versions were reverted (by choice): **12** `RATE_LIMIT_OFF=1` (development only, ignored in production); **2** Remove photo (file deleted, audit entry, Add/Change/Remove buttons); **3** the retention period, contact and version of the privacy notice are Settings fields (`/api/auth/privacy-info` is public; raising the version makes everyone accept again). Each has API and browser tests, and every test puts back what it changes (the privacy tests restore the settings and the accepting accounts, so they pass when run again and again).
- `pnpm test:all` (`e2e/run-all.mjs`) runs typecheck, unit tests and every API and browser check in turn. Start the API with `RATE_LIMIT_OFF=1` first.
- Still open: **I** the live scanner outline (needs the original ticket photo); **H phase 2** archiving old records (needs the rule); **J** Ready to pay was left as it is.

## Batches (2026-11-20)

A **batch** is a code (B-2026-000004, generated) that groups receipts so they can be found and worked on together. It is a label, not a second workflow: each receipt keeps its own status and every rule of the single-receipt steps still applies.

### Decisions
- **Who makes batches:** Accounting and both admin roles (new permission `batch.manage`). Checkers, Approvers and Accounting open batches to work on them. Med Refs only see the code on their receipt.
- **People per batch:** one person or several. Paying a batch records **one payment per person**, all with the same date, method and proof file.
- **Code:** generated, with an optional name (up to 80 characters).
- **One bad receipt:** does not hold up the rest. A returned or disapproved receipt simply stays behind.
- **What can go in:** submitted, returned, checked, reserved and approved receipts, in no other batch, up to 300 per batch. Drafts are private to the Med Ref. Paid and disapproved receipts are finished.
- **Taking out:** allowed until paid. A paid receipt stays, so the batch is a true record of what was paid together. Only an empty batch can be deleted.
- **Closing:** stops more receipts being added; the receipts carry on as usual. It can be reopened.

### What it does
- **Check / Approve a batch** runs the normal step on every receipt of the batch waiting for that person. The evidence must still have been opened (and the company details confirmed for BIR invoices), so anything not ready is skipped and listed with its reason.
- **Pay a batch** checks every receipt first, then records everything in one transaction or nothing.
- **Notices:** one summary per person (in the bell and by the new editable `batch_update` email) instead of one per receipt. Payments still send the usual one email per payment.
- **Where it shows:** Batches page (find by code, open/closed), batch page (progress by status, grouped by person, what is waiting for you), Ready to pay (batches with receipts to pay), dashboard (batches waiting for you), receipt page and lists (the code), receipts list (filter `?batchId=`, search by code), exports (Batch column), liquidation reports (batch filter), Help (a Batches guide), audit log (every add, remove, close, check, approve and payment).

### Not done, on purpose
- **The code is not printed on the reimbursement PDF.** The PDF is made once, at approval, and a receipt can join or leave a batch after that, so a printed code could be wrong.
- **No batch column in import.** Import makes drafts, and drafts cannot be in a batch.

### Database
Migration `20261120010000_batches` adds the `batch` table and `receipt.batchId`, `notification.batchId` (additive; rollback in `docs/rollback-batches.sql`). The new table needs the app login's rights: `node scripts/grant-app-user.mjs --yes --admin root` (or the line in `docs/db-grants.sql`). Re-running the seed grants `batch.manage` once.

### Tests
`packages/shared/test/batches.test.ts`, `e2e/batch-flow.mjs` (API, every role) and `e2e/batch-ui.mjs` (Chrome, computer and phone), both in `e2e/run-all.mjs`.

## Batch cutoffs (plan, 2026-11-20)

A **cutoff** fills a batch automatically at a set time, closes it, and (for a repeating schedule) opens the next one. After the cutoff it is an ordinary batch: its receipts are checked, approved and paid exactly as before. One mechanism serves both kinds: every batch can carry a **cutoff time** and a **fill rule**, and a repeating schedule only makes the next batch with those filled in.

### Decisions
- **Both kinds:** repeating schedules ("every Friday 5:00 PM") and a one-off cutoff on any batch made by hand.
- **At the cutoff:** add every matching receipt that is in no batch, close the batch, open the next one, send one summary.
- **Rules per schedule:** which status, which date counts, optional charge locations and people.
- **Latecomers:** stay out of any batch, so the next run takes them. They can still be added by hand before that.
- **Who:** repeating schedules need a new permission `batch.schedule` (Admin and Super Admin by default; roles can be changed in Access). A one-off cutoff on a batch needs `batch.manage` (Accounting and both admins).
- **What each person may pull in:** "anything in progress" needs `receipt.view_all`. Without it (Accounting by default) only "approved" is offered and the API refuses the other, so nobody fills a batch with receipts they cannot see.

### The fill rule (shared `cutoffRuleSchema`, stored as JSON on the batch and on the schedule)
| Field | Choices | Notes |
|---|---|---|
| `statuses` | `approved` / `in_progress` | In progress = submitted, checked, approved. **Returned and reserved are never pulled in** (they wait on the Med Ref or are on hold on purpose); they can still be added by hand. |
| `date` | `approved` / `submitted` / `receipt` | Default `approved` for approved-only, `submitted` otherwise. Approved = `decidedAt`. Submitted = `submittedAt`, which resets when a returned receipt is sent again, so one fixed after the cutoff goes to the next run. Receipt = `receiptDate`, which has no time, so "dated on or before the cutoff day". |
| `chargeLocationIds` | empty = all | |
| `encoderIds` | empty = everyone | |

Categories are left out: receipts on the current form are Product or Service, not categories.

### Database (migration `20261121010000_batch_cutoffs`, additive; rollback in `docs/rollback-batch-cutoffs.sql`)
- **New table `batchschedule`:** `id`, `name` (60), `isOn`, `repeat` (`weekly` / `monthly`), `days` (weekly: weekdays such as `5` or `1,5`; monthly: month days such as `15,L`, `L` = last day), `time` (`17:00`), `timeZone` (default from Settings, Asia/Manila), `rule` (JSON text), `lastRunAt`, `lastBatchId`, `lastCount`, `createdById`, timestamps.
- **New on `batch`:** `cutoffAt` (when it fills), `cutoffRule` (JSON text), `scheduleId` (FK, set null on delete), `part` (default 1; 2, 3 ... for overflow), `cutoffClaimedAt` (a run in progress), `cutoffDoneAt` (the cutoff ran or was cancelled). **A batch is due only when `cutoffAt <= now` and `cutoffDoneAt` is empty.**
- **Unique `(scheduleId, cutoffAt, part)`:** a schedule can never get two batches for the same slot, whatever retries or a second server do. Hand-made batches have no schedule, so the key does not limit them.
- Grants for the new table (`docs/db-grants.sql`, `scripts/grant-app-user.mjs`); the seed grants `batch.schedule` once.

### Working out the next cutoff (shared `nextCutoff(schedule, after)`)
Walks forward day by day in the schedule's time zone (up to 400 days) and returns the first chosen day and time strictly after `after`. Days 29 to 31 in a shorter month mean that month's last day, and are not counted twice when both 30 and 31 are chosen. The local time is turned into a real instant with the zone's offset on that day, checked twice so a daylight-saving change cannot shift it (Manila has none; tested with New York). The screen preview and the worker use the same function, so they always agree.

### The worker (`apps/api/src/lib/cutoffs.ts`, every minute, started in `server.ts` next to the email schedules)
1. **Keep schedules alive.** Every switched-on schedule without a current batch (one of its batches with no `cutoffDoneAt`) gets one, with the next cutoff after now. This also mends a lost batch.
2. **Claim each due batch** with one conditional update (`cutoffDoneAt` empty, and `cutoffClaimedAt` empty or older than 10 minutes). Two servers or two ticks cannot both run it. A crash mid-run is picked up again after 10 minutes; every step below is safe to repeat.
3. **Closed by hand before the cutoff:** the cutoff counts as cancelled (`cutoffDoneAt` set, audit `batch.cutoff_cancelled`), nothing is added, and the schedule moves on to its next batch.
4. **Fill**, in a transaction holding the batch row lock (as adding by hand does): matching receipts, oldest first, with `batchId IS NULL` and the allowed statuses inside the update itself, so a receipt added by hand at the same moment is never in two batches. Up to 300 per batch; the rest go into **part 2, 3 ...** (same schedule and cutoff, named "... (part 2)", closed and done at once). Nothing is dropped.
5. **Nothing in it at all** (none matched and none added by hand): a schedule's batch stays open and its cutoff moves to the next slot (renamed to the new date, audit `batch.cutoff_rolled`, a bell note to the schedule's maker, no email). A hand-made batch stays open with its cutoff removed and its maker is told. No empty closed batches pile up.
6. **Close:** `closedAt` and `cutoffDoneAt` set, claim cleared. **Reopening later never re-runs it**, because `cutoffDoneAt` stays.
7. **Next batch** for the schedule: the first slot after this cutoff that is still in the future. A server that was down over several slots runs the missed one once, at its own cutoff time, and does not replay every missed week. The unique key makes a second attempt a harmless no-op.
8. **Tell people once:** a bell note and the new editable `batch_cutoff` email to everyone with `batch.manage`, plus the schedule's maker: "B-2026-000031 · Weekly run Pasig · 20 Nov closed at cutoff: 12 receipts, PHP 34,500.00. Next cutoff Fri 27 Nov, 5:00 PM." Med Refs are not told (they do not see batches).
9. **Record:** audit as "System (cutoff schedule <name>)": `batch.cutoff_run` on the batch (counts, refs, part batches) and `batch.receipt_added` on each receipt. The schedule's `lastRunAt`, `lastBatchId` and `lastCount` are updated. Open screens refresh through the usual write announcements.

### Run now, move, pause, delete
- **Run cutoff now** (on the batch, `batch.manage`): steps 2 to 9 at once, recorded as that person. It **uses up that slot**: the next batch gets the slot after the original cutoff, not tomorrow.
- **Change this cutoff** (one batch only, e.g. a holiday): a new time and/or rule. A time already past asks "Run it now?" and runs only when confirmed.
- **Editing a schedule** updates its current batch's cutoff and rule (the form says so). A new time already past asks the same question. Closed batches never change.
- **Pausing a schedule** removes the cutoff from its current batch, which becomes an ordinary batch. Switching it on again puts the next cutoff back.
- **Deleting a schedule:** its current batch is deleted if empty, otherwise it keeps its receipts as an ordinary batch without a cutoff. Past batches keep their history (the schedule link becomes empty).
- **Deleting a schedule's current batch** is refused: "Pause or delete the schedule instead."
- **Hand-made batch with a cutoff:** set it when making the batch or later; change or remove it until it has run.

### Overlap
Two switched-on schedules overlap when their statuses meet and their charge-location and people filters meet (an empty filter means all). It is allowed, since a receipt can only be in one batch and the earlier cutoff takes it, but the schedule list shows "Overlaps with: ..." so it is never a surprise.

### API
- `/api/batch-schedules` (`batch.schedule`): `GET` (each with plain words, next cutoff, last run, overlaps), `GET /choices` (charge locations, people, default time zone), `POST`, `PATCH /:id` (incl. on/off and `confirmPast`), `DELETE /:id`, `GET /:id/preview` (count and total it would add now).
- `/api/batches`: `POST /` takes optional `cutoffAt` and `cutoffRule`; `PATCH /:id` takes `cutoffAt` (or null), `cutoffRule`, `confirmPast`; new `POST /:id/cutoff/run`; `GET /:id` adds `cutoff` (time, rule, plain words, schedule, done or not) and `wouldAdd` (count and total, and how many are at steps this person cannot see); `GET /` adds each batch's cutoff time and schedule name (no per-row preview: too heavy for a list).
- `DELETE /:id` refuses a schedule's current batch (`SCHEDULE_BATCH`). Errors in plain words, as elsewhere.

### Screens
- **Batches page:** a **Cutoff schedules** tab for `batch.schedule`: name, plain words ("Every Friday at 5:00 PM (Asia/Manila). Takes receipts approved before then, charged to Pasig."), next cutoff, last run (count and link), on/off switch, overlap warning. Form: name; Weekly (weekday chips) or Monthly (day chips 1 to 31 and Last day); time; status, date, charge locations, people; a live plain-words line and "If it ran now: 12 receipts, PHP 34,500.00".
- **Batch rows:** "Cutoff Fri 20 Nov, 5:00 PM" or "Closed at cutoff", with the schedule name.
- **Batch page:** a cutoff panel: when, time left, rule in words, "12 receipts (PHP 34,500.00) would be added now (3 at steps you cannot see)", **Run cutoff now** (confirm), **Change this cutoff**, and on hand-made batches **Set / Remove cutoff**.
- **New batch dialog:** optional "Close automatically at" with the rule (only "approved" when the person lacks `receipt.view_all`).
- Computer and phone layouts, dark mode. Help: a "Cutoffs" part in the Batches guide.

### Not done, on purpose
- **No holiday calendar.** Move one cutoff with "Change this cutoff".
- **No filter by category or type.** Charge location and people cover how runs are split today; more can be added to the rule later without a database change.
- **The code year** is the year the batch was opened (a batch opened 28 Dec for a 2 Jan cutoff is B-2026-...). Harmless; codes stay unique.

### Tests
- `packages/shared/test/cutoffs.test.ts`: `nextCutoff` (one and several weekdays, same day before and after the time, 15th and last day, 31st in a 30-day month and in February, leap year, year end, New York daylight-saving days), rule schema and defaults, plain words, overlap, which rules a person may choose.
- `e2e/batch-cutoff-flow.mjs` (API): a schedule opens a batch; the preview matches; at the cutoff (set in the past by SQL, run by the worker within a minute and by Run now) it fills, closes, opens the next and tells Accounting once; a latecomer goes to the next run; returned and reserved receipts stay out; a receipt in another batch stays there; reopening does not re-run; closing before the cutoff cancels it; an empty run rolls over; 305 matching receipts make part 1 (300) and part 2 (5); two Run now calls at once give one result; a stale claim re-runs without doubles; pause, resume, edit and delete behave as above; the current batch cannot be deleted; Accounting cannot choose "in progress"; Med Ref and Checker get 403 on schedules; audit rows.
- `e2e/batch-cutoff-ui.mjs` (Chrome, computer and phone): make a schedule, see the plain words and preview, Run now, see the closed batch and the next one.
- `e2e/email-templates.mjs` count 17 to 18; both new tests in `e2e/run-all.mjs`.

### Build order (each step ends with typecheck and its tests)
1. Shared: rule schema, `nextCutoff`, plain words, overlap, permission, email template; unit tests.
2. Migration, rollback SQL, grants, seed.
3. `lib/cutoffs.ts` worker and its start-up.
4. API routes; `e2e/batch-cutoff-flow.mjs`.
5. Screens; `e2e/batch-cutoff-ui.mjs`.
6. Help, a progress note here, full `run-all` and production build.

