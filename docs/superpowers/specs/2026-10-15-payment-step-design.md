# Payment step: design

**Status:** written for review, not approved yet. Nothing in this document has been built.
**Date:** 2026-10-15

## 1. Purpose

After a reimbursement is approved, someone at the client has to actually pay the Med Ref back. REIMSYS currently stops at "Approved". This adds a **payment step** so the system shows what has been paid, when, how, and how much, and so one named role (the point person) is responsible for recording it.

Success looks like:
- Accounting can see every approved receipt waiting for payment, grouped by person.
- Accounting can record one payment for one receipt or for several receipts of the same person.
- The Med Ref is told when they have been paid, and can see the proof.
- Reports show paid and unpaid amounts.
- A mistaken payment can be reversed, and nothing is ever lost from the history.

## 2. Decisions (from the discussion on 2026-10-15)

| Topic | Decision |
|---|---|
| Who pays | A new **Accounting** role. Approvers and the Super Admin cannot mark paid. A person cannot mark their own receipt paid. |
| One or many | Both. A payment can cover one receipt or several receipts of the **same person**. |
| Amount | Accounting types the amount paid per receipt. It is pre-filled with the receipt amount. |
| Short payment | Allowed. The receipt is marked Paid with the real amount and a **required reason**. One payment per receipt, no instalments. |
| What is recorded | Payment date, payment method, proof file. (No reference number.) |
| Mistakes | Accounting can **reverse** a payment with a required reason. The receipt returns to Approved. The history is kept. |
| Reports | Liquidation reports get a Paid / Not yet paid / All filter and paid columns. |
| Approach | A new **Paid** status plus a **payment** record (not just fields on the receipt). |
| Name | The role is called **Accounting** (code `accounting`). The Super Admin can rename it on the Access page. The screen is "Ready to pay", the button is "Mark as paid". |

### Assumptions to confirm
1. The proof file is required for every method, including cash (a signed voucher).
2. The amount paid cannot be more than the receipt amount.
3. A reversal is per receipt, not per whole payment.
4. The method list starts as: Bank transfer, Cheque, Cash, E-wallet. The Super Admin can edit it.
5. The Accounting role's rank is 25, so it neither manages nor is managed by the review roles. Rank only controls who can manage whom.

## 3. Status flow

```
… → Checked → Approved → Paid
                ▲          │
                └──────────┘  reversed by Accounting, reason required
```

- New status **paid**. New actions: `pay` (Approved → Paid) and `reverse_payment` (Paid → Approved).
- `pay` needs `payment.mark`, is never allowed for the receipt's own encoder, and needs a payment date, a method, a proof file, and an amount per receipt.
- `reverse_payment` needs `payment.mark` and a note.
- The Approver's 10-minute "take back" (`undo`) only works from Approved. Once Paid, the payment must be reversed first, then the Approver may take back the approval (inside its window).
- Paid is otherwise final: it cannot be edited, withdrawn or deleted.

## 4. The role

- New role `accounting` (name "Accounting", rank 25, a system role).
- New permission `payment.mark` ("Mark approved receipts as paid"), **locked** for Accounting like the review permissions, so the pay path can't be removed by accident.
- Default grants: `payment.mark`, `evidence.view/download/print`, `report.generate`.
- Visibility: Accounting sees receipts whose status is Approved or Paid. They cannot see drafts, submitted or checked receipts.
- The Super Admin has no `payment.mark` by default (separation of duties). It can be granted on the Access page if the client wants a backup, and every such change is audited.

## 5. Data

New table `payment` (mapped lowercase like the others):
- `id`, `paymentNo` (`PAY-2026-000001`, from the existing sequence helper), `payeeId` (the Med Ref), `method`, `paidOn` (date), `proofFile` (stored name), `proofMime`, `proofSize`, `proofSha256`, `recordedById`, `createdAt`.

New fields on `receipt`:
- `paymentId` (nullable link to `payment`), `paidAmount` (decimal, nullable), `paidShortReason` (nullable text), `paidAt` (nullable, when it was marked).
- Status value `paid` is added to the allowed values (it is a plain string column, so no schema type change).

New setting: the list of payment methods, kept in the existing Settings area.

On reversal the receipt's `paymentId`, `paidAmount`, `paidShortReason` and `paidAt` are cleared. The `payment` row and the full story stay in the audit log. A payment whose receipts have all been reversed is shown as "Reversed" in its own history.

Migration: additive only (new table, new nullable columns). `docs/db-grants.sql` gets the new table, and a rollback script is added in the style of `rollback-client-form.sql`.

## 6. API

All routes require sign-in and are checked server-side.

- `GET /api/payments/queue` : approved, unpaid receipts grouped by person, with totals. Needs `payment.mark`.
- `POST /api/payments` : body has `receiptIds`, `method`, `paidOn`, per-receipt `amount` and optional `shortReason`, and the proof file. Rules: all receipts are Approved, none is the payer's own, all belong to the **same** Med Ref, amounts are > 0 and not above the receipt amount, a shortfall has a reason, the date is not in the future, the proof passes the same file-type and size checks as evidence. All receipts change status in one transaction with a version check, so two people cannot pay the same receipt twice.
- `POST /api/receipts/:id/reverse_payment` : note required.
- `GET /api/payments/:id/proof?mode=view|download|print` : audited before any byte is sent. Allowed for the payee, Accounting, and anyone who can see the receipt.
- `GET /api/receipts/:id` : gains a `payment` block (number, date, method, amount paid, short reason, who recorded it, proof file info).
- The Paid / Not yet paid filter and paid columns are added to the report request, preview, view, XLSX, CSV and PDF.

## 7. Screens

- **Accounting dashboard:** "To pay" (count and amount), "Paid this month", and the queue.
- **Ready to pay** (new page, Accounting only): approved receipts grouped by Med Ref, tick boxes (only within one person), a sticky "Mark as paid" bar. The dialog collects date, method, proof, and an amount per receipt with a reason box that appears for a shortfall.
- **Receipt detail:** a Paid pill (new colour), a Payment card (date, method, amount paid, proof viewer with download and print), and for Accounting a "Reverse payment" action with a reason.
- **Receipts list:** Paid chip and filter. Approver and checker dashboards show Approved vs Paid.
- **Reports:** Paid / Not yet paid / All selector, new columns (paid on, method, amount paid), totals for amount paid and unpaid balance.
- **Settings:** an editable list of payment methods.
- Phone layout: the queue becomes cards, the "Mark as paid" bar docks at the bottom, as the other action bars do.

## 8. Notifications

- Med Ref: in-app notice and one email per payment listing the receipts and amounts (new editable template `paid`). A reversal sends another (`payment_reversed`).
- Accounting: an in-app notice when a receipt is approved and ready to pay. No email, so inboxes do not fill up.
- Both new emails appear in the Email templates editor with sample data and live preview.

## 9. Audit and security

- Audited: `payment.marked`, `payment.reversed`, and every proof view, download and print, in the same style as evidence.
- Proof files use the existing storage, file-signature check, size limit and authorised endpoint. They are never public.
- The payment, with all receipts, is created in a single transaction. A failed file upload leaves nothing half-paid.
- The Paid status is included in the append-only audit and the database grants for the new table follow the existing rule (audit stays insert-only).

## 10. Impact on what already exists

Wherever the code lists statuses or says "approved", it needs a decision about "paid":
- State rules and their tests (`packages/shared`), the receipt list and counts, dashboards, the visibility rule for each role, the permission matrix, notifications and the template list, reports and the report view, import/export (a Paid column on export), the audit group filters, the seed (new role and permission), the e2e scripts, and the documents (PLAN, EMAIL, DEPLOY, db-grants).
- The reimbursement document and its numbering are unchanged.

## 11. Testing

- Unit: the new transitions and who may use them, including "never your own receipt".
- Workflow API: pay one, pay a batch for one person, a mixed-person batch is refused, short payment needs a reason, overpayment refused, future date refused, bad proof file refused, double-pay race refused, reverse with a reason, `undo` blocked while paid, every role's permissions, Paid hidden from roles that should not see it, and the proof is only served to the right people and is audited.
- Reports: the Paid / Not yet paid filter and totals match the data in PDF, XLSX, CSV and on screen.
- Browser: the queue, the dialog (including the shortfall box), the receipt payment card, the reports filter, and the phone layout.
- Email: the two new templates render, escape input, and are sent (to the local test mailbox only; real mail stays off during tests).
- Regression: all existing suites must still pass.

## 12. Rollout

1. Back up the database and tag the current version (as was done before the client form).
2. Run the additive migration, then seed the new role, permission and methods list.
3. Create the real Accounting user on the Access page.
4. Roll back with the rollback script, or restore the backup, if needed.

## 13. Out of scope

Instalment or partial payments over time, different methods inside one batch, a second signature on payments, connecting to a bank or accounting software, and a payment reference number.

## 14. Build order (for the plan that follows)

1. Shared rules: status, actions, role, permission, tests.
2. Database migration, seed, grants, rollback.
3. Payment API and proof storage, with API tests.
4. Notifications and the two email templates.
5. Reports, report view and export.
6. Screens: Ready to pay, payment dialog, receipt payment card, filters, dashboards, settings list.
7. Browser tests, phone checks, documents, then a full regression.
