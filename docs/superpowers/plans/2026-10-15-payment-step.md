# Payment Step Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a payment step to REIMSYS: a new **Accounting** role marks approved reimbursements as **Paid** (one payment for one or several receipts of the same person, with date, method, proof and amount), can reverse a mistaken payment, and reports show paid and unpaid amounts.

**Architecture:** A new `paid` receipt status and two new actions (`pay`, `reverse_payment`) live in the shared state machine (`packages/shared`). A new `payment` table holds one row per payment (receipts link to it, and carry `paidAmount`, `paidShortReason`, `paidAt`). Paying goes through its own route (`POST /api/payments`, multipart with the proof file, one transaction with a version check per receipt); reversing goes through the existing `runAction` pipeline. The web app gets a "Ready to pay" page, a payment dialog, a payment card on the receipt, report filters and a settings list for payment methods.

**Tech Stack:** TypeScript monorepo (pnpm): Express 5 + Prisma 6 + MySQL/MariaDB (`apps/api`), React 18 + Vite + TanStack Query + react-router 6 (`apps/web`), zod + shared rules (`packages/shared`), vitest for unit tests, plain Node scripts (`e2e/*.mjs`) and Playwright (installed Chrome) for end-to-end checks, PDFKit and ExcelJS for reports, nodemailer for email.

**Spec:** `docs/superpowers/specs/2026-10-15-payment-step-design.md` (read it first; this plan implements all of it).

## Global Constraints

- Package scope is `@reimsys/*`; database is `reimsys`; Prisma tables are mapped to lowercase (`@@map("payment")`).
- New role: code `accounting`, name "Accounting", rank **25**, system role. New permission `payment.mark` (label "Mark approved receipts as paid", group "Payments"), **locked** for Accounting. Super Admin does **not** get `payment.mark` by default.
- Status flow: `Approved → Paid` (action `pay`) and `Paid → Approved` (action `reverse_payment`, note required). `undo` stays available only from Approved/Disapproved, so a paid receipt must be reversed first. Paid receipts cannot be edited, withdrawn or deleted.
- Nobody pays or reverses a receipt they encoded (`notOwner`, error code `OWN_RECEIPT`).
- A payment covers receipts of **one** Med Ref only, at most `BULK_MAX` (25) receipts, needs: payment date (not in the future), a method from the editable list (default: Bank transfer, Cheque, Cash, E-wallet), a **proof file for every method** (JPG/PNG/WEBP/HEIC/PDF, checked by file signature, size limit `evidenceMaxMb`), and an amount per receipt that is > 0 and **not more than** the receipt amount. A shortfall needs a reason (`shortReason`). One payment per receipt, no instalments.
- Payment numbers are `PAY-YYYY-NNNNNN`, from the existing sequence helper.
- Accounting sees only receipts whose status is Approved or Paid (never drafts, submitted or checked ones), and never their own receipts in the queue.
- Notifications: Med Ref gets an in-app notice and **one email per payment** (template `paid`); a reversal sends `payment_reversed`. Accounting gets an in-app notice when a receipt is approved, **no email**.
- Audit actions: `payment.marked`, `payment.reversed`, `payment.proof_viewed`, `payment.proof_downloaded`, `payment.proof_printed`. The audit row is written **before** any proof byte is sent.
- Database changes are **additive only** (new table, new nullable columns). `docs/db-grants.sql` gives the app user `SELECT, INSERT` only on `payment` (payments are never edited or deleted). A rollback script is added in the style of `docs/rollback-client-form.sql`.
- Wording on screens: the page is "Ready to pay", the button is "Mark as paid", the role is "Accounting". Plain words, no jargon.
- Tests must never email real inboxes: every demo user is `@example.com` (the reserved-address guard logs instead of sending). Do not turn off that guard.
- Every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (pass it as a second `-m`). After every commit run `git push origin myBranch` (all work goes to the branch `myBranch`).
- Code style: match the surrounding files (comment density, naming, idiom). Money is handled in cents when comparing. Dates are `YYYY-MM-DD` strings in the API.

## Review Focus

Inputs and conditions the spec implies but that no single happy-path test covers. Each has a test in the task that owns the code.

1. **Two Accounting users pay the same receipt at the same moment.** Exactly one payment wins, the other gets a conflict, the receipt ends up paid once, no half-made payment or orphan proof file is left behind. (Task 6, race check.)
2. **Receipts of two different people ticked in one payment.** Refused by the server (`MIXED_PAYEES`), not only hidden by the screen. (Task 6.)
3. **Money and dates at the edges.** `0.1 + 0.2`-style float sums, an amount typed with three decimals, one centavo short (needs a reason), zero, negative and `NaN`; and a payment dated "today" in Manila before 8am, when the UTC date is still yesterday (must be accepted; default date and `max` on the screen use the local date). (Task 2 unit tests, Task 6.)
4. **A database that already exists.** The seed only grants default permissions to *newly created* permissions, so the new Accounting role would get nothing for `evidence.view/download/print` and `report.generate`, which already existed. The seed must give a newly created role its defaults. (Task 3, checked again in Task 6: accounting can open evidence.)
5. **Bad or odd proof files, and paying again after a reversal.** A text file renamed `.png`, a missing proof, an oversized proof are refused and leave nothing behind; a reversed receipt can be paid again with a new proof, the old proof stays reachable to Accounting, and the history shows both events. (Task 6, Task 7.)

---

## File Structure

**Create**
- `packages/shared/src/payments.ts`: payment method list, request schema, `paymentIssues()` (pure money/date rules), `totalOf()`.
- `packages/shared/test/payments.test.ts`: unit tests for the above.
- `apps/api/prisma/migrations/20261015030000_payment_step/migration.sql`: additive migration (generated by Prisma, then renamed).
- `docs/rollback-payment-step.sql`: undo script.
- `apps/api/src/lib/paymentMethods.ts`: read/save the editable method list (stored in the `setting` table).
- `apps/api/src/lib/paymentNotices.ts`: builds the `paid` email data and sends the Med Ref notice.
- `apps/api/src/routes/payments.ts`: methods, queue, create payment, proof download.
- `e2e/payment-helpers.mjs`: login/call/make-approved-receipt/pay helpers shared by the two payment scripts.
- `e2e/payment-flow.mjs`: API workflow checks for the whole payment step.
- `e2e/payment-ui.mjs`: browser checks (desktop + phone).
- `apps/web/src/components/PayDialog.tsx`: the "Mark as paid" dialog.
- `apps/web/src/components/PaymentMethods.tsx`: editable method list card for Settings.
- `apps/web/src/pages/ReadyToPay.tsx`: the Accounting queue page.

**Modify**
- `packages/shared/src/receipts.ts`, `packages/shared/src/index.ts`, `packages/shared/src/emailTemplates.ts`.
- `packages/shared/test/workflow.test.ts`, `packages/shared/test/templates.test.ts`.
- `apps/api/prisma/schema.prisma`, `apps/api/prisma/seed.ts`.
- `apps/api/src/lib/receipts.ts` (visibility, include, detail), `apps/api/src/lib/sequence.ts`, `apps/api/src/lib/notify.ts`, `apps/api/src/lib/emailTemplates.ts` (no change needed unless noted), `apps/api/src/lib/reports.ts`.
- `apps/api/src/routes/receipts.ts` (actions, export), `apps/api/src/routes/misc.ts` (dashboard), `apps/api/src/routes/reports.ts`, `apps/api/src/server.ts`.
- `apps/api/test/pdf.test.ts`, `apps/api/test/email.test.ts`.
- `apps/web/src/ui.tsx`, `apps/web/src/types.ts`, `apps/web/src/api.ts`, `apps/web/src/App.tsx`, `apps/web/src/styles.css`, `apps/web/src/pages/ReceiptDetail.tsx`, `Dashboard.tsx`, `Reports.tsx`, `ReportView.tsx`, `AppSettings.tsx`, `Audit.tsx`.
- `docs/db-grants.sql`, `docs/PLAN.md`, `docs/EMAIL.md`, `docs/DEPLOY.md`.

**Running things.** The API runs on port 4000 and the web app on 5173 (`pnpm dev`, or `pnpm dev:api` and `pnpm dev:web`). Check with `curl http://localhost:4000/api/health`. After any change to `schema.prisma`, run `pnpm --filter @reimsys/api db:generate` and restart the API process. Run one unit test file with `pnpm exec vitest run <path>`; all unit tests with `pnpm test`; types with `pnpm typecheck`.

---

## Task 1: Shared rules: status, actions, role, permission

**Files:**
- Modify: `packages/shared/src/receipts.ts:3-35`
- Modify: `packages/shared/src/index.ts:3-60`
- Test: `packages/shared/test/workflow.test.ts`

**Interfaces:**
- Produces: `RECEIPT_STATUSES` now includes `'paid'`; `STATUS_LABEL.paid = 'Paid'`; `ReceiptAction` includes `'pay' | 'reverse_payment'`; `TRANSITIONS` gains `pay` (approved → paid, `payment.mark`, note none, notOwner) and `reverse_payment` (paid → approved, `payment.mark`, note required, notOwner); `ROLE_CODES`/`DEFAULT_ROLES` gain `accounting` (rank 25); `PERMISSIONS` gains `payment.mark`; `DEFAULT_GRANTS['payment.mark'] = ['accounting']`; `LOCKED_GRANTS` gains `{ role: 'accounting', permission: 'payment.mark' }`.

- [ ] **Step 1: Update the two existing tests that would now be wrong, and add the new tests**

In `packages/shared/test/workflow.test.ts`, replace the test `'only lets a decision be taken back, nothing else, and it needs a reason'` (it used every permission, which now includes `payment.mark`) with:

```ts
  it('only lets a decision be taken back, nothing else, and it needs a reason', () => {
    const decider = perms('review.decide');
    expect(names(availableActions('approved', decider, false))).toEqual(['undo']);
    expect(names(availableActions('disapproved', decider, false))).toEqual(['undo']);
    expect(transitionFor('undo')!.note).toBe('required');
    expect(transitionFor('undo')!.to).toBe('checked');
  });
```

Replace the test `'only allows leaving a final status through undo'` with:

```ts
  it('only allows leaving a final status through undo, or through payment', () => {
    const out = TRANSITIONS.filter((t) => t.from.includes('approved') || t.from.includes('disapproved'));
    expect(out.map((t) => t.action)).toEqual(['undo', 'pay']);
    expect(TRANSITIONS.filter((t) => t.from.includes('disapproved')).map((t) => t.action)).toEqual(['undo']);
  });
```

Append this block at the end of the file:

```ts
describe('payment step', () => {
  it('gives Accounting pay on approved receipts and reverse on paid ones, never on their own', () => {
    expect(names(availableActions('approved', perms('payment.mark'), false))).toEqual(['pay']);
    expect(names(availableActions('paid', perms('payment.mark'), false))).toEqual(['reverse_payment']);
    expect(availableActions('approved', perms('payment.mark'), true)).toEqual([]);
    expect(availableActions('paid', perms('payment.mark'), true)).toEqual([]);
    for (const s of ['draft', 'submitted', 'returned', 'checked', 'disapproved', 'reserved'] as const) {
      expect(availableActions(s, perms('payment.mark'), false), s).toEqual([]);
    }
  });

  it('moves approved to paid and back, and a reversal needs a reason', () => {
    expect(transitionFor('pay')).toMatchObject({ from: ['approved'], to: 'paid', permission: 'payment.mark', note: 'none' });
    expect(transitionFor('reverse_payment')).toMatchObject({ from: ['paid'], to: 'approved', permission: 'payment.mark', note: 'required' });
  });

  it('keeps the approver from taking a decision back once it is paid', () => {
    const decider = perms('review.decide');
    expect(names(availableActions('paid', decider, false))).toEqual([]);
    expect(names(availableActions('approved', decider, false))).toEqual(['undo']);
  });

  it('makes Paid final: it cannot be edited and has no way out except a reversal', () => {
    expect(canEditReceipt('paid')).toBe(false);
    expect(TRANSITIONS.filter((t) => t.from.includes('paid')).map((t) => t.action)).toEqual(['reverse_payment']);
  });

  it('has an Accounting role that alone can mark paid, and the Super Admin cannot by default', () => {
    expect(DEFAULT_ROLES.find((r) => r.code === 'accounting')).toEqual({ code: 'accounting', name: 'Accounting', rank: 25 });
    expect(DEFAULT_GRANTS['payment.mark']).toEqual(['accounting']);
    expect(isLockedGrant('accounting', 'payment.mark')).toBe(true);
    expect(DEFAULT_GRANTS['payment.mark']).not.toContain('admin');
    for (const p of ['evidence.view', 'evidence.download', 'evidence.print', 'report.generate']) expect(DEFAULT_GRANTS[p], p).toContain('accounting');
    expect(PERMISSIONS.find((p) => p.code === 'payment.mark')).toMatchObject({ group: 'Payments' });
  });
});
```

Add `DEFAULT_ROLES` to the import list at the top of the file (it imports from `'../src/index'`).

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm exec vitest run packages/shared/test/workflow.test.ts`
Expected: FAIL (`paid` is not a status, `pay` is not a transition, no accounting role).

- [ ] **Step 3: Implement the shared rules**

In `packages/shared/src/receipts.ts`:

```ts
export const RECEIPT_STATUSES = ['draft', 'submitted', 'returned', 'checked', 'approved', 'disapproved', 'reserved', 'paid'] as const;
```
```ts
export const STATUS_LABEL: Record<ReceiptStatus, string> = {
  draft: 'Draft', submitted: 'Submitted', returned: 'Returned', checked: 'Checked',
  approved: 'Approved', disapproved: 'Disapproved', reserved: 'Reserved', paid: 'Paid',
};

export type ReceiptAction = 'submit' | 'withdraw' | 'check' | 'return' | 'approve' | 'disapprove' | 'reserve' | 'release' | 'undo' | 'request' | 'pay' | 'reverse_payment';
```
Append two entries to `TRANSITIONS` (after the `release` line):
```ts
  /** Paying is done from the payment form (it needs a date, method, proof and amounts), so the API has no plain /pay action route. */
  { action: 'pay', from: ['approved'], to: 'paid', permission: 'payment.mark', note: 'none', notOwner: true },
  { action: 'reverse_payment', from: ['paid'], to: 'approved', permission: 'payment.mark', note: 'required', notOwner: true },
```

In `packages/shared/src/index.ts`:
```ts
export const ROLE_CODES = ['medref', 'checker', 'approver', 'accounting', 'admin'] as const;
```
```ts
export const DEFAULT_ROLES: { code: RoleCode; name: string; rank: number }[] = [
  { code: 'medref', name: 'Med Ref', rank: 10 },
  { code: 'checker', name: 'Checker', rank: 20 },
  { code: 'approver', name: 'Approver', rank: 30 },
  { code: 'accounting', name: 'Accounting', rank: 25 },
  { code: 'admin', name: 'Super Admin', rank: 100 },
];
```
Add to `PERMISSIONS` right after the `review.decide` entry:
```ts
  { code: 'payment.mark', label: 'Mark approved receipts as paid', group: 'Payments' },
```
Change `ALL` and add the grant and the locked grant:
```ts
const ALL: RoleCode[] = ['medref', 'checker', 'approver', 'accounting', 'admin'];
```
```ts
  'payment.mark': ['accounting'],
```
(put it right after `'review.decide': ['approver'],`), and in `LOCKED_GRANTS` add `{ role: 'accounting', permission: 'payment.mark' },` after the approver line.

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm exec vitest run packages/shared/test/workflow.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Typecheck the whole repo to find every place that must handle `paid`**

Run: `pnpm typecheck`
Expected: errors only about `paid` missing from `Record<ReceiptStatus, …>` / `Record<ReceiptAction, …>` objects in `apps/web/src/ui.tsx` (`PILL`), `apps/web/src/pages/ReceiptDetail.tsx` (`COPY`) and `apps/api/src/routes/receipts.ts` (`SUMMARY`). Those are fixed in Tasks 7 and 10-12; do **not** fix them here. Note the list in the commit message.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/receipts.ts packages/shared/src/index.ts packages/shared/test/workflow.test.ts
git commit -m "Payment step: Paid status, pay and reverse_payment actions, Accounting role and payment.mark permission" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin myBranch
```

---

## Task 2: Shared rules: payment request, money and date checks, report filter

**Files:**
- Create: `packages/shared/src/payments.ts`
- Modify: `packages/shared/src/index.ts` (add `export * from './payments';`), `packages/shared/src/receipts.ts` (`reportRequestSchema`)
- Test: `packages/shared/test/payments.test.ts`

**Interfaces:**
- Consumes: `BULK_MAX` from `./receipts`.
- Produces (all exported from `@reimsys/shared`):
  - `DEFAULT_PAYMENT_METHODS: string[]`; `paymentMethodsSchema` (`{ methods: string[] }`, 1-12 unique non-empty names up to 40 chars).
  - `paymentLineSchema` / `paymentRequestSchema` (`{ method, paidOn, lines: { receiptId, version, amount, shortReason }[] }`).
  - `type PaymentLine = z.infer<typeof paymentLineSchema>`, `type PaymentRequest = z.infer<typeof paymentRequestSchema>`.
  - `paymentIssues(input: { paidOn: string; lines: { receiptId: number; amount: number; shortReason: string | null }[] }, receiptAmounts: ReadonlyMap<number, number>, now?: Date): PaymentIssue[]` where `PaymentIssue = { code: 'DATE_FUTURE' | 'DUPLICATE_RECEIPT' | 'OVERPAID' | 'SHORT_REASON'; message: string; receiptId?: number }`.
  - `totalOf(lines: { amount: number }[]): number` (sum in cents, returned in pesos).
  - `PAYMENT_FILTERS = ['all', 'paid', 'unpaid'] as const`, `type PaymentFilter`, `PAYMENT_FILTER_LABEL`.
  - `reportRequestSchema` gains `payment: PaymentFilter` (default `'all'`).

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/test/payments.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_PAYMENT_METHODS, PAYMENT_FILTER_LABEL, paymentIssues, paymentLineSchema, paymentMethodsSchema, paymentRequestSchema, reportRequestSchema, totalOf } from '../src/index';

const amounts = (...p: [number, number][]) => new Map(p);
const line = (receiptId: number, amount: number, shortReason: string | null = null) => ({ receiptId, amount, shortReason });
const codes = (r: ReturnType<typeof paymentIssues>) => r.map((i) => i.code);

describe('payment methods', () => {
  it('starts with the four methods from the spec', () => {
    expect(DEFAULT_PAYMENT_METHODS).toEqual(['Bank transfer', 'Cheque', 'Cash', 'E-wallet']);
  });
  it('needs at least one method, no blanks, no repeats (ignoring case)', () => {
    expect(paymentMethodsSchema.safeParse({ methods: [] }).success).toBe(false);
    expect(paymentMethodsSchema.safeParse({ methods: ['Cash', ' '] }).success).toBe(false);
    expect(paymentMethodsSchema.safeParse({ methods: ['Cash', 'cash'] }).success).toBe(false);
    expect(paymentMethodsSchema.safeParse({ methods: Array.from({ length: 13 }, (_, i) => 'M' + i) }).success).toBe(false);
    expect(paymentMethodsSchema.parse({ methods: [' Cash ', 'GCash'] }).methods).toEqual(['Cash', 'GCash']);
  });
});

describe('payment lines', () => {
  it('rounds an amount typed with extra decimals to centavos', () => {
    expect(paymentLineSchema.parse({ receiptId: 1, version: 3, amount: '1284.504', shortReason: '' }).amount).toBe(1284.5);
    expect(paymentLineSchema.parse({ receiptId: 1, version: 3, amount: '1284.504', shortReason: '' }).shortReason).toBeNull();
  });
  it('refuses zero, negative, empty and not-a-number amounts', () => {
    for (const amount of [0, -5, '', 'abc', NaN]) {
      expect(paymentLineSchema.safeParse({ receiptId: 1, version: 0, amount }).success, String(amount)).toBe(false);
    }
  });
  it('wants between 1 and 25 receipts and a method', () => {
    const ok = { method: 'Cash', paidOn: '2026-10-15', lines: [{ receiptId: 1, version: 0, amount: 10 }] };
    expect(paymentRequestSchema.safeParse(ok).success).toBe(true);
    expect(paymentRequestSchema.safeParse({ ...ok, lines: [] }).success).toBe(false);
    expect(paymentRequestSchema.safeParse({ ...ok, lines: Array.from({ length: 26 }, (_, i) => ({ receiptId: i + 1, version: 0, amount: 1 })) }).success).toBe(false);
    expect(paymentRequestSchema.safeParse({ ...ok, method: ' ' }).success).toBe(false);
    expect(paymentRequestSchema.safeParse({ ...ok, paidOn: '15/10/2026' }).success).toBe(false);
  });
});

describe('payment rules', () => {
  const now = new Date('2026-10-15T04:00:00Z');
  it('accepts the full amount, and a lower amount with a reason', () => {
    expect(paymentIssues({ paidOn: '2026-10-15', lines: [line(1, 100)] }, amounts([1, 100]), now)).toEqual([]);
    expect(paymentIssues({ paidOn: '2026-10-15', lines: [line(1, 90, 'Deducted a cash advance')] }, amounts([1, 100]), now)).toEqual([]);
  });
  it('needs a reason for any shortfall, even one centavo, and refuses an overpayment by one centavo', () => {
    expect(codes(paymentIssues({ paidOn: '2026-10-15', lines: [line(1, 99.99)] }, amounts([1, 100]), now))).toEqual(['SHORT_REASON']);
    expect(codes(paymentIssues({ paidOn: '2026-10-15', lines: [line(1, 100.01)] }, amounts([1, 100]), now))).toEqual(['OVERPAID']);
  });
  it('compares in centavos so 0.1 + 0.2 style sums are not a shortfall', () => {
    expect(paymentIssues({ paidOn: '2026-10-15', lines: [line(1, 0.1 + 0.2)] }, amounts([1, 0.3]), now)).toEqual([]);
    expect(totalOf([{ amount: 0.1 }, { amount: 0.2 }])).toBe(0.3);
    expect(totalOf([{ amount: 1284.5 }, { amount: 600 }])).toBe(1884.5);
  });
  it('refuses a future date but accepts today in Manila when the UTC date is still yesterday', () => {
    expect(codes(paymentIssues({ paidOn: '2026-10-20', lines: [line(1, 10)] }, amounts([1, 10]), now))).toEqual(['DATE_FUTURE']);
    // 02:30 on 16 Oct in Manila is 18:30 on 15 Oct in UTC.
    const manilaMorning = new Date('2026-10-15T18:30:00Z');
    expect(paymentIssues({ paidOn: '2026-10-16', lines: [line(1, 10)] }, amounts([1, 10]), manilaMorning)).toEqual([]);
  });
  it('flags a receipt listed twice', () => {
    expect(codes(paymentIssues({ paidOn: '2026-10-15', lines: [line(1, 10), line(1, 10)] }, amounts([1, 10]), now))).toEqual(['DUPLICATE_RECEIPT']);
  });
  it('points each problem at its receipt', () => {
    const r = paymentIssues({ paidOn: '2026-10-15', lines: [line(1, 10), line(2, 5)] }, amounts([1, 10], [2, 10]), now);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ code: 'SHORT_REASON', receiptId: 2 });
  });
});

describe('report filter', () => {
  const base = { from: '2026-10-01', to: '2026-10-31', format: 'csv' };
  it('defaults to all and accepts paid and unpaid', () => {
    expect(reportRequestSchema.parse(base).payment).toBe('all');
    expect(reportRequestSchema.parse({ ...base, payment: 'paid' }).payment).toBe('paid');
    expect(reportRequestSchema.parse({ ...base, payment: 'unpaid' }).payment).toBe('unpaid');
    expect(reportRequestSchema.safeParse({ ...base, payment: 'maybe' }).success).toBe(false);
  });
  it('has plain-words labels', () => {
    expect(PAYMENT_FILTER_LABEL).toEqual({ all: 'Paid and not yet paid', paid: 'Paid', unpaid: 'Not yet paid' });
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm exec vitest run packages/shared/test/payments.test.ts`
Expected: FAIL (module exports missing).

- [ ] **Step 3: Implement `payments.ts`**

Create `packages/shared/src/payments.ts`:

```ts
import { z } from 'zod';
import { BULK_MAX } from './receipts';

/** What the Super Admin sees until they edit the list. */
export const DEFAULT_PAYMENT_METHODS = ['Bank transfer', 'Cheque', 'Cash', 'E-wallet'];
export const PAYMENT_METHODS_MAX = 12;

export const paymentMethodsSchema = z
  .object({
    methods: z
      .array(z.string().trim().min(1, 'A payment method cannot be empty.').max(40, 'Keep each payment method under 40 characters.'))
      .min(1, 'Keep at least one payment method.')
      .max(PAYMENT_METHODS_MAX, `Use at most ${PAYMENT_METHODS_MAX} payment methods.`),
  })
  .refine((d) => new Set(d.methods.map((m) => m.toLowerCase())).size === d.methods.length, { message: 'Each payment method can only be listed once.', path: ['methods'] });

export const paymentLineSchema = z.object({
  receiptId: z.number().int().positive(),
  /** The version of the receipt the person was looking at, so a receipt that changed meanwhile is not paid blindly. */
  version: z.number().int().min(0),
  amount: z
    .coerce.number({ invalid_type_error: 'Enter the amount paid.' })
    .positive('The amount paid must be more than zero.')
    .max(9_999_999.99, 'That amount is too large.')
    .transform((n) => Math.round(n * 100) / 100),
  shortReason: z.string().trim().max(300, 'Keep the reason under 300 characters.').nullish().transform((v) => v || null),
});
export type PaymentLine = z.infer<typeof paymentLineSchema>;

export const paymentRequestSchema = z.object({
  method: z.string().trim().min(1, 'Choose how it was paid.').max(40),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date format YYYY-MM-DD.').refine((s) => !Number.isNaN(Date.parse(s)), 'Enter a valid date.'),
  lines: z.array(paymentLineSchema).min(1, 'Choose at least one receipt.').max(BULK_MAX, `Pay up to ${BULK_MAX} receipts at a time.`),
});
export type PaymentRequest = z.infer<typeof paymentRequestSchema>;

export interface PaymentIssue {
  code: 'DATE_FUTURE' | 'DUPLICATE_RECEIPT' | 'OVERPAID' | 'SHORT_REASON';
  message: string;
  receiptId?: number;
}

const cents = (n: number) => Math.round(n * 100);

/** Sum of the amounts, added in centavos so the result has no floating-point crumbs. */
export const totalOf = (lines: { amount: number }[]) => lines.reduce((s, l) => s + cents(l.amount), 0) / 100;

/**
 * The money and date rules for one payment. Used by the server (the real check) and by the payment dialog (so people see the
 * problem before they press the button). `receiptAmounts` maps each receipt id to the amount on the receipt.
 */
export function paymentIssues(
  input: { paidOn: string; lines: { receiptId: number; amount: number; shortReason: string | null }[] },
  receiptAmounts: ReadonlyMap<number, number>,
  now = new Date(),
): PaymentIssue[] {
  const out: PaymentIssue[] = [];
  // One day of room, the same as the receipt date, so "today" is never refused for someone ahead of the server's clock (Manila is 8 hours ahead of UTC).
  if (input.paidOn > new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10)) out.push({ code: 'DATE_FUTURE', message: 'The payment date cannot be in the future.' });
  const seen = new Set<number>();
  for (const l of input.lines) {
    if (seen.has(l.receiptId)) { out.push({ code: 'DUPLICATE_RECEIPT', message: 'The same receipt is listed twice.', receiptId: l.receiptId }); continue; }
    seen.add(l.receiptId);
    const full = receiptAmounts.get(l.receiptId);
    if (full === undefined) continue;
    if (cents(l.amount) > cents(full)) out.push({ code: 'OVERPAID', message: `The amount paid cannot be more than the receipt amount (${full.toFixed(2)}).`, receiptId: l.receiptId });
    else if (cents(l.amount) < cents(full) && !l.shortReason) out.push({ code: 'SHORT_REASON', message: 'Say why less than the full amount was paid.', receiptId: l.receiptId });
  }
  return out;
}
```

In `packages/shared/src/index.ts`, add after `export * from './receipts';`:
```ts
export * from './payments';
```

The report filter list lives in `receipts.ts` (next to the report schema that uses it), not in `payments.ts`: `payments.ts` already imports from `receipts.ts`, and importing back would be circular (this project has hit that before). In `packages/shared/src/receipts.ts`, directly above and replacing `reportRequestSchema`:
```ts
export const PAYMENT_FILTERS = ['all', 'paid', 'unpaid'] as const;
export type PaymentFilter = (typeof PAYMENT_FILTERS)[number];
export const PAYMENT_FILTER_LABEL: Record<PaymentFilter, string> = { all: 'Paid and not yet paid', paid: 'Paid', unpaid: 'Not yet paid' };

export const reportRequestSchema = z.object({
  from: dateString,
  to: dateString,
  categoryId: z.number().int().positive().nullish(),
  transactionType: z.enum(TRANSACTION_TYPES).nullish(),
  encoderId: z.number().int().positive().nullish(),
  payment: z.enum(PAYMENT_FILTERS).default('all'),
  format: z.enum(['pdf', 'xlsx', 'csv']),
});
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm exec vitest run packages/shared`
Expected: PASS (workflow, templates, brand, payments).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/payments.ts packages/shared/src/index.ts packages/shared/src/receipts.ts packages/shared/test/payments.test.ts
git commit -m "Payment step: payment request schema, money and date rules, report payment filter" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin myBranch
```

---

## Task 3: Database: schema, migration, seed, grants, rollback

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (`User`, `Receipt`, new `Payment`)
- Create: `apps/api/prisma/migrations/20261015030000_payment_step/migration.sql`
- Modify: `apps/api/prisma/seed.ts`
- Modify: `docs/db-grants.sql`
- Create: `docs/rollback-payment-step.sql`

**Interfaces:**
- Produces (Prisma client): `prisma.payment` with fields `id, paymentNo, payeeId, payee, method, paidOn, proofFile, proofMime, proofSize, proofSha256, recordedById, recordedBy, createdAt, receipts`; `Receipt` gains `paymentId, payment, paidAmount (Decimal?), paidShortReason, paidAt`.
- Produces (seed): the `accounting` role with its default grants, even on a database that already has the older permissions; a demo user `accounting@example.com` "Rica Tan".

- [ ] **Step 1: Back up and tag before touching the database**

```bash
git tag before-payment-step
git push origin before-payment-step
mkdir -p ../reimsys-backups
/c/xampp/mysql/bin/mysqldump.exe -u root --single-transaction --routines reimsys > ../reimsys-backups/before-payment-step-$(date +%Y%m%d-%H%M).sql
ls -la ../reimsys-backups | tail -3
```
Expected: a `.sql` file of a few hundred KB or more. (If your MySQL root has a password, add `-p`. Earlier backups live in the same folder.) Also copy the uploaded files: `tar czf ../reimsys-backups/storage-before-payment-step.tgz -C apps/api storage` (use the real `STORAGE_DIR` from `apps/api/.env` if it differs).

- [ ] **Step 2: Edit the Prisma schema**

In `model User`, after the `receipts Receipt @relation("Encoder")` line add:
```prisma
  paymentsReceived   Payment[]          @relation("PaymentPayee")
  paymentsRecorded   Payment[]          @relation("PaymentRecorder")
```
In `model Receipt`, after `lastNote String? @db.VarChar(1000)` add:
```prisma
  // Payment step. Filled while the receipt is Paid and cleared again when the payment is reversed.
  paymentId       Int?
  payment         Payment?                 @relation(fields: [paymentId], references: [id])
  paidAmount      Decimal?                 @db.Decimal(12, 2)
  paidShortReason String?                  @db.VarChar(300)
  paidAt          DateTime?
```
and next to the other `@@index` lines in `Receipt` add `@@index([paymentId])`.

Add the new model (put it after `ReimbursementDocument`):
```prisma
/// One payment made by Accounting to one Med Ref. It can cover several receipts. Rows are never edited or deleted.
model Payment {
  id           Int       @id @default(autoincrement())
  paymentNo    String    @unique @db.VarChar(30)
  payeeId      Int
  payee        User      @relation("PaymentPayee", fields: [payeeId], references: [id])
  method       String    @db.VarChar(40)
  paidOn       DateTime  @db.Date
  proofFile    String    @db.VarChar(200)
  proofMime    String    @db.VarChar(60)
  proofSize    Int
  proofSha256  String    @db.VarChar(64)
  recordedById Int
  recordedBy   User      @relation("PaymentRecorder", fields: [recordedById], references: [id])
  createdAt    DateTime  @default(now())
  receipts     Receipt[]

  @@index([payeeId])
  @@index([recordedById])
  @@map("payment")
}
```

- [ ] **Step 3: Generate the migration, rename it, apply it**

```bash
pnpm --filter @reimsys/api exec prisma migrate dev --create-only --name payment_step
```
Then rename the new folder under `apps/api/prisma/migrations/` (its name is a timestamp plus `_payment_step`) to `20261015030000_payment_step`, and open `migration.sql`. It must contain **only**: `CREATE TABLE payment …`, `ALTER TABLE receipt ADD COLUMN paymentId, paidAmount, paidShortReason, paidAt`, `CREATE INDEX receipt_paymentId_idx`, and the foreign keys (`receipt_paymentId_fkey` ON DELETE SET NULL, `payment_payeeId_fkey`, `payment_recordedById_fkey`). If it contains anything else (a drop, a modify of an old column), stop and fix the schema edit.

```bash
pnpm --filter @reimsys/api exec prisma migrate deploy
pnpm --filter @reimsys/api db:generate
```
Expected: "1 migration applied" and a regenerated client. Restart the API process afterwards.

- [ ] **Step 4: Make the seed give a newly created role its default grants, and add the demo user**

In `apps/api/prisma/seed.ts`, replace the role loop and the permission loop with:

```ts
  const roleRows = [];
  const newRoles = new Set<string>();
  for (const r of DEFAULT_ROLES) {
    const had = await prisma.role.findUnique({ where: { code: r.code } });
    if (!had) newRoles.add(r.code);
    roleRows.push(await prisma.role.upsert({ where: { code: r.code }, update: { name: r.name }, create: { code: r.code, name: r.name, rank: r.rank, isSystem: true } }));
  }
  const roleId = new Map(roleRows.map((r) => [r.code, r.id]));

  // Permissions added in a later release get their default grants once. Edits made on the access control page survive re-seeding.
  for (const p of PERMISSIONS) {
    const existing = await prisma.permission.findUnique({ where: { code: p.code } });
    const row = await prisma.permission.upsert({ where: { code: p.code }, update: { label: p.label, groupName: p.group }, create: { code: p.code, label: p.label, groupName: p.group } });
    const roles = DEFAULT_GRANTS[p.code] ?? [];
    // A brand-new permission goes to every role that should have it; a brand-new role gets the defaults of the permissions that already existed.
    const targets = existing ? roles.filter((r) => newRoles.has(r)) : roles;
    if (targets.length) await prisma.rolePermission.createMany({ data: targets.map((r) => ({ roleId: roleId.get(r)!, permissionId: row.id })), skipDuplicates: true });
  }
```
Add to the `demo` list, before the admin line:
```ts
    { email: 'accounting@example.com', name: 'Rica Tan', role: 'accounting', branch: 'Head Office' },
```

- [ ] **Step 5: Run the seed and check the result**

```bash
pnpm db:seed
```
Expected: "Seeded 15 permissions, 5 roles, 5 categories, 6 users."

Check the grants (this is Review Focus item 4):
```bash
/c/xampp/mysql/bin/mysql.exe -u root reimsys -e "SELECT r.code, GROUP_CONCAT(p.code ORDER BY p.code) AS perms FROM role r JOIN rolepermission rp ON rp.roleId=r.id JOIN permission p ON p.id=rp.permissionId WHERE r.code IN ('accounting','admin') GROUP BY r.code;"
```
Expected: `accounting` has `evidence.download,evidence.print,evidence.view,payment.mark,report.generate`; `admin` does **not** list `payment.mark`.

Run the seed a second time: it must print the same line and change nothing (`SELECT COUNT(*) FROM rolepermission` is the same before and after).

- [ ] **Step 6: Grants file and rollback script**

In `docs/db-grants.sql`, after the `reimbursementdocument` grant line add:
```sql
-- Payments are written once and never edited or deleted (a reversal clears the link on the receipt, the payment row stays).
GRANT SELECT, INSERT ON reimsys.payment TO 'reimsys_app'@'localhost';
```
Create `docs/rollback-payment-step.sql`:
```sql
-- Undoes the 20261015030000_payment_step migration. Run ONLY if you are going back to the version tagged "before-payment-step".
-- Safer alternative: restore the full backup from reimsys-backups/before-payment-step-*.sql (this loses anything done since).
-- 1. Paid receipts go back to Approved, so nothing is left in a status the old version does not know.
UPDATE `receipt` SET status = 'approved', paymentId = NULL, paidAmount = NULL, paidShortReason = NULL, paidAt = NULL WHERE status = 'paid';
-- 2. Accounting users are switched off and moved to Med Ref, then the Accounting role and its permission are removed.
UPDATE `user` SET isActive = 0, roleId = (SELECT id FROM `role` WHERE code = 'medref') WHERE roleId = (SELECT id FROM `role` WHERE code = 'accounting');
DELETE FROM `rolepermission` WHERE roleId = (SELECT id FROM `role` WHERE code = 'accounting');
DELETE FROM `role` WHERE code = 'accounting';
DELETE FROM `rolepermission` WHERE permissionId = (SELECT id FROM `permission` WHERE code = 'payment.mark');
DELETE FROM `permission` WHERE code = 'payment.mark';
-- 3. The new columns and the payment table.
ALTER TABLE `receipt` DROP FOREIGN KEY `receipt_paymentId_fkey`;
DROP INDEX `receipt_paymentId_idx` ON `receipt`;
ALTER TABLE `receipt` DROP COLUMN paymentId, DROP COLUMN paidAmount, DROP COLUMN paidShortReason, DROP COLUMN paidAt;
DROP TABLE `payment`;
DELETE FROM `setting` WHERE `key` = 'payment.methods';
DELETE FROM `_prisma_migrations` WHERE migration_name = '20261015030000_payment_step';
-- Uploaded proof files stay on disk under storage/proofs. They are not referenced any more and can be archived or deleted by hand.
```
Verify the rollback script on a scratch copy, not on the real database:
```bash
/c/xampp/mysql/bin/mysql.exe -u root -e "DROP DATABASE IF EXISTS reimsys_rbtest; CREATE DATABASE reimsys_rbtest;"
/c/xampp/mysql/bin/mysqldump.exe -u root reimsys | /c/xampp/mysql/bin/mysql.exe -u root reimsys_rbtest
/c/xampp/mysql/bin/mysql.exe -u root reimsys_rbtest < docs/rollback-payment-step.sql && echo ROLLBACK_OK
/c/xampp/mysql/bin/mysql.exe -u root reimsys_rbtest -e "SHOW TABLES LIKE 'payment'; SELECT COUNT(*) AS accounting_roles FROM role WHERE code='accounting';"
/c/xampp/mysql/bin/mysql.exe -u root -e "DROP DATABASE reimsys_rbtest;"
```
Expected: `ROLLBACK_OK`, no `payment` table listed, `accounting_roles` = 0. If a statement fails (for example a foreign-key name differs), fix the script until it passes, then re-run.

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20261015030000_payment_step apps/api/prisma/seed.ts docs/db-grants.sql docs/rollback-payment-step.sql
git commit -m "Payment step: payment table, receipt payment fields, Accounting role seed, grants and rollback script" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin myBranch
```

---
## Task 4: API foundations: who sees what, payment block, dashboard, numbers, method list

**Files:**
- Modify: `apps/api/src/lib/receipts.ts` (`visibleWhere`, `receiptInclude`, `receiptDetail`)
- Modify: `apps/api/src/lib/sequence.ts`
- Create: `apps/api/src/lib/paymentMethods.ts`
- Modify: `apps/api/src/routes/misc.ts` (dashboard)
- Create: `e2e/payment-helpers.mjs`, `e2e/payment-flow.mjs`

**Interfaces:**
- Consumes: Task 1 permission `payment.mark`, Task 3 Prisma fields.
- Produces:
  - `visibleWhere(auth)`: a user with `payment.mark` also sees `approved` and `paid`; a user with `review.decide` also sees `paid`.
  - `receiptInclude` includes `payment: { include: { recordedBy: { select: { id, name } } } }`.
  - `receiptDetail(...)` returns `payment: { id: number; paymentNo: string; method: string; paidOn: string; amount: number; shortReason: string | null; recordedBy: string; recordedAt: Date | null; proof: { mime: string; size: number } } | null`.
  - `nextPaymentNo(tx?: Tx): Promise<string>` → `PAY-YYYY-NNNNNN`.
  - `getPaymentMethods(): Promise<string[]>`, `savePaymentMethods(methods: string[], userId: number): Promise<void>` (setting key `payment.methods`).
  - `GET /api/dashboard` adds `paidThisMonth: { count: number; total: number }`; for a `payment.mark` user without review/encode permissions the queue is "Ready to pay" (approved, not their own).
  - e2e helpers (see Step 1) used by Tasks 6-8 and 13.

- [ ] **Step 1: Write the e2e helpers and the first checks**

Create `e2e/payment-helpers.mjs`:

```js
// Helpers for the payment scripts. Needs the API on port 4000 and the seeded demo users (password Reimsys#2026).
export const B = process.env.API ?? 'http://localhost:4000/api';
export const ORIGIN = new URL(B).origin;
const PW = 'Reimsys#2026';
export const tag = 'Pay test ' + Date.now().toString().slice(-6);
/** The reimbursement form's answers for a receipt with no BIR invoice: the shortest valid receipt. */
export const F = { birInvoice: false, vendorAddress: 'Test Street, Test City', reasonForSpending: 'Payment test', classification: 'fuel' };
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
/** Today's date where the tester is, not in UTC. */
export const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10); };

export const H = (c, json = true) => ({ cookie: c, 'x-requested-with': 'reimsys', origin: ORIGIN, ...(json ? { 'content-type': 'application/json' } : {}) });
export async function login(email) {
  const r = await fetch(B + '/auth/login', { method: 'POST', headers: H('', true), body: JSON.stringify({ email, password: PW }) });
  if (!r.ok) throw new Error('login failed for ' + email);
  return r.headers.get('set-cookie').split(';')[0];
}
export async function call(c, m, p, b) {
  const r = await fetch(B + p, { method: m, headers: H(c), body: b === undefined ? undefined : JSON.stringify(b) });
  return { s: r.status, d: await r.json().catch(() => null) };
}

export const USERS = { ana: 'ana.reyes@example.com', mark: 'mark.dc@example.com', liza: 'liza.santos@example.com', paolo: 'paolo.v@example.com', admin: 'admin@example.com', rica: 'accounting@example.com' };
export async function loginAll() {
  const U = {};
  for (const [k, e] of Object.entries(USERS)) U[k] = await login(e);
  return U;
}

async function step(c, r, action, note) {
  const res = await call(c, 'POST', `/receipts/${r.id}/${action}`, { version: r.version, ...(note ? { note } : {}) });
  if (res.s !== 200) throw new Error(`${action} on ${r.refNo} failed: ${res.s} ${JSON.stringify(res.d)}`);
  return res.d.receipt;
}
const view = (c, r) => fetch(`${B}/receipts/${r.id}/evidence/${r.evidence[0].id}/file?mode=view`, { headers: H(c, false) });

export async function makeDraft(U, owner, name, amount) {
  const c = U[owner];
  const r = (await call(c, 'POST', '/receipts', { payee: `${name} ${tag}`, receiptDate: today(), amount, ...F, description: 'Created by the payment test' })).d.receipt;
  const f = new FormData();
  f.append('files', new Blob([Buffer.concat([PNG, Buffer.from(name + tag + Math.random())])], { type: 'image/png' }), 'receipt.png');
  return (await (await fetch(`${B}/receipts/${r.id}/evidence`, { method: 'POST', headers: H(c, false), body: f })).json()).receipt;
}

/** A receipt that went the whole way: encoded by `owner`, checked by Liza, approved by Paolo. */
export async function makeApproved(U, owner, name, amount) {
  let r = await makeDraft(U, owner, name, amount);
  r = await step(U[owner], r, 'submit');
  await view(U.liza, r);
  r = await step(U.liza, r, 'check');
  await view(U.paolo, r);
  return step(U.paolo, r, 'approve');
}

/** Records a payment for `receipts` (receipt objects from the API). Options: amounts and reasons keyed by receipt id, method, paidOn, proof (Buffer), proofType, proofName, noProof. */
export async function pay(c, receipts, o = {}) {
  const f = new FormData();
  f.append('method', o.method ?? 'Bank transfer');
  f.append('paidOn', o.paidOn ?? today());
  f.append('lines', JSON.stringify(receipts.map((r) => ({ receiptId: r.id, version: r.version, amount: o.amounts?.[r.id] ?? r.amount, shortReason: o.reasons?.[r.id] ?? null }))));
  if (!o.noProof) f.append('proof', new Blob([o.proof ?? Buffer.concat([PNG, Buffer.from('proof' + Math.random())])], { type: o.proofType ?? 'image/png' }), o.proofName ?? 'proof.png');
  const res = await fetch(`${B}/payments`, { method: 'POST', headers: H(c, false), body: f });
  return { s: res.status, d: await res.json().catch(() => null) };
}

export function checker() {
  let failed = 0;
  const ok = (name, cond) => { console.log(cond ? '  ok  ' : '  FAIL', name); if (!cond) failed++; };
  const done = () => { console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed'); process.exit(failed ? 1 : 0); };
  return { ok, done };
}
```

Create `e2e/payment-flow.mjs`:

```js
// Checks the payment step through the API, as each role. Needs the API (4000) running and the seed applied.
// Usage: node e2e/payment-flow.mjs
import { B, H, PNG, call, checker, loginAll, makeApproved, makeDraft, pay, tag, today } from './payment-helpers.mjs';

const { ok, done } = checker();
const U = await loginAll();
console.log(`Run tag: ${tag}`);

console.log('\nWho sees what');
const a1 = await makeApproved(U, 'ana', 'Pay one', 1000);
const draft = await makeDraft(U, 'ana', 'Still a draft', 50);
ok('accounting can open an approved receipt', (await call(U.rica, 'GET', `/receipts/${a1.id}`)).s === 200);
ok('accounting cannot open a draft', (await call(U.rica, 'GET', `/receipts/${draft.id}`)).s === 404);
const ev = await fetch(`${B}/receipts/${a1.id}/evidence/${a1.evidence[0].id}/file?mode=view`, { headers: H(U.rica, false) });
ok('accounting can open the evidence (the seed gave the new role its grants)', ev.status === 200);
const dash = (await call(U.rica, 'GET', '/dashboard')).d;
ok('accounting dashboard queue is "Ready to pay"', dash.queueTitle === 'Ready to pay' && dash.queueTotal >= 1 && dash.queue.every((r) => r.status === 'approved'));
ok('dashboard has a paid-this-month summary', typeof dash.paidThisMonth?.count === 'number' && typeof dash.paidThisMonth?.total === 'number');
const detail = (await call(U.rica, 'GET', `/receipts/${a1.id}`)).d.receipt;
ok('an unpaid receipt has no payment block', detail.payment === null);
ok('accounting is offered "pay" on an approved receipt', detail.actions.some((a) => a.action === 'pay'));
ok('the approver is not offered "pay"', !(await call(U.paolo, 'GET', `/receipts/${a1.id}`)).d.receipt.actions.some((a) => a.action === 'pay'));

// END OF CHECKS
done();
```
(Later tasks insert their checks **directly above** the `// END OF CHECKS` line, so they can reuse `a1` and `U`.)

- [ ] **Step 2: Run it to see it fail**

Make sure the API is running (restarted after Task 3). Run: `node e2e/payment-flow.mjs`
Expected: FAIL on "accounting can open an approved receipt" (404, visibility not widened yet), the dashboard checks and the payment block check.

- [ ] **Step 3: Implement**

`apps/api/src/lib/receipts.ts`, in `visibleWhere`, replace the `review.decide` line and add one after it:
```ts
  if (p.has('review.decide')) ors.push({ status: { in: ['checked', 'reserved', 'approved', 'disapproved', 'paid'] } });
  // Accounting sees what is waiting to be paid and what was paid, nothing earlier in the workflow.
  if (p.has('payment.mark')) ors.push({ status: { in: ['approved', 'paid'] } });
```
`receiptInclude`:
```ts
export const receiptInclude = {
  category: true,
  encoder: { select: { id: true, name: true } },
  document: true,
  payment: { include: { recordedBy: { select: { id: true, name: true } } } },
} satisfies Prisma.ReceiptInclude;
```
In `receiptDetail`'s returned object, after the `document:` line:
```ts
    payment: r.payment ? {
      id: r.payment.id, paymentNo: r.payment.paymentNo, method: r.payment.method, paidOn: dateOnly(r.payment.paidOn),
      amount: dec(r.paidAmount) ?? 0, shortReason: r.paidShortReason, recordedBy: r.payment.recordedBy.name, recordedAt: r.paidAt,
      proof: { mime: r.payment.proofMime, size: r.payment.proofSize },
    } : null,
```

`apps/api/src/lib/sequence.ts`, append:
```ts
export async function nextPaymentNo(tx?: Tx) {
  const y = new Date().getFullYear();
  return formatNumber('PAY', await nextSequence(`payment-${y}`, tx), y);
}
```

Create `apps/api/src/lib/paymentMethods.ts`:
```ts
import { DEFAULT_PAYMENT_METHODS, paymentMethodsSchema } from '@reimsys/shared';
import { prisma } from '../db.js';

const KEY = 'payment.methods';

/** The methods Accounting can choose from. A missing or damaged saved list falls back to the defaults, never to an empty list. */
export async function getPaymentMethods(): Promise<string[]> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  if (!row) return [...DEFAULT_PAYMENT_METHODS];
  try {
    const parsed = paymentMethodsSchema.safeParse({ methods: JSON.parse(row.value) });
    if (parsed.success) return parsed.data.methods;
  } catch {
    /* fall back below */
  }
  return [...DEFAULT_PAYMENT_METHODS];
}

export async function savePaymentMethods(methods: string[], userId: number) {
  const value = JSON.stringify(methods);
  await prisma.setting.upsert({ where: { key: KEY }, update: { value, updatedById: userId }, create: { key: KEY, value, updatedById: userId } });
}
```

`apps/api/src/routes/misc.ts`, dashboard: insert a branch before the final `else` of the queue choice:
```ts
  else if (p.has('payment.mark')) { queueWhere = { status: 'approved', encoderId: { not: auth.user.id } }; queueTitle = 'Ready to pay'; }
```
After `const queueTotal = …` add:
```ts
  const now = new Date();
  const paidMonth = await prisma.receipt.aggregate({
    where: { AND: [scope, { status: 'paid', paidAt: { gte: new Date(now.getFullYear(), now.getMonth(), 1) } }] },
    _count: { _all: true }, _sum: { paidAmount: true },
  });
```
and add to the `res.json({ … })` object:
```ts
    paidThisMonth: { count: paidMonth._count._all, total: Number(paidMonth._sum.paidAmount ?? 0) },
```

- [ ] **Step 4: Run it to see it pass**

Run: `pnpm --filter @reimsys/api typecheck` then `node e2e/payment-flow.mjs`
Expected: typecheck shows only the known `SUMMARY` error in `routes/receipts.ts` (fixed in Task 7); the script prints `All checks passed`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/receipts.ts apps/api/src/lib/sequence.ts apps/api/src/lib/paymentMethods.ts apps/api/src/routes/misc.ts e2e/payment-helpers.mjs e2e/payment-flow.mjs
git commit -m "Payment step: Accounting visibility, payment block on receipts, dashboard summary, payment numbers and method list" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin myBranch
```

---

## Task 5: Email templates and the payment notice

**Files:**
- Modify: `packages/shared/src/emailTemplates.ts`
- Modify: `apps/api/src/lib/notify.ts`
- Create: `apps/api/src/lib/paymentNotices.ts`
- Test: `apps/api/test/email.test.ts` (existing template tests in `packages/shared/test/templates.test.ts` cover the new keys automatically)

**Interfaces:**
- Produces:
  - `TEMPLATE_KEYS` gains `'paid'` and `'payment_reversed'` (after `'reversed'`); new placeholders `paymentNo`, `method`, `paidOn`, `receiptList`.
  - `notify({ …, email: { template, data, link?, respectPref? } })`: `link` overrides the button address.
  - `paidEmailData(p: { paymentNo: string; method: string; paidOn: string; actorName: string }, lines: PaidLine[]): Record<string, string>` and `announcePaid(args: { payeeId: number; paymentNo: string; method: string; paidOn: string; actorName: string; lines: PaidLine[] }): Promise<void>`, where `PaidLine = { id: number; refNo: string; payee: string; amount: number; paid: number }` (`payee` is the vendor on the receipt, `amount` the receipt amount, `paid` the amount paid).

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/test/email.test.ts` (and add `import { paidEmailData } from '../src/lib/paymentNotices';` at the top):

```ts
describe('payment emails', () => {
  it('the paid email lists every receipt, the method and the total, and escapes what people typed', async () => {
    const data = paidEmailData({ paymentNo: 'PAY-2026-000007', method: 'GCash <b>', paidOn: '2026-10-15', actorName: 'Rica Tan' }, [
      { id: 1, refNo: 'RC-2026-000001', payee: 'Mercury <script>', amount: 1284.5, paid: 1284.5 },
      { id: 2, refNo: 'RC-2026-000002', payee: 'Shell', amount: 700, paid: 600 },
    ]);
    const m = await render('paid', { ...data, recipientName: 'Ana' }, HTTPS);
    expect(m.subject).toBe('Payment sent: PAY-2026-000007');
    expect(m.text).toContain('RC-2026-000001 · Mercury <script> · PHP 1,284.50');
    expect(m.text).toContain('RC-2026-000002 · Shell · PHP 600.00 (receipt PHP 700.00)');
    expect(m.text).toContain('PHP 1,884.50');
    expect(m.text).toContain('Oct 15, 2026');
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('Mercury &lt;script&gt;');
    expect(m.html).toContain('GCash &lt;b&gt;');
  });
  it('the reversal email names the payment and the reason', async () => {
    const s = sampleFor('payment_reversed');
    const m = await render('payment_reversed', s, HTTPS);
    expect(m.subject).toContain(s.refNo);
    expect(m.text).toContain(s.paymentNo);
    expect(m.text).toContain(s.note);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `pnpm exec vitest run apps/api/test/email.test.ts`
Expected: FAIL (`paymentNotices` does not exist, `paid` is not a template).

- [ ] **Step 3: Implement the templates**

In `packages/shared/src/emailTemplates.ts`:

```ts
export const TEMPLATE_KEYS = ['returned', 'approved', 'disapproved', 'reserved', 'released', 'reversed', 'paid', 'payment_reversed', 'digest', 'reset', 'invite', 'test'] as const;
```
Add to `PLACEHOLDERS` (after the `docNo` entry):
```ts
  { key: 'paymentNo', label: 'Payment number', example: 'PAY-2026-000012' },
  { key: 'method', label: 'How it was paid', example: 'Bank transfer' },
  { key: 'paidOn', label: 'Payment date', example: 'Oct 15, 2026' },
  { key: 'receiptList', label: 'Receipts in the payment, one per line (payment email only)', example: '• RC-2026-000123 · Mercury Drug - Mandaue · PHP 1,284.50' },
```
Add to `TEMPLATE_META` (after `reversed`):
```ts
  paid: { label: 'Reimbursement paid', when: 'Accounting marks one or more receipts as paid', to: 'The Med Ref who was paid', allowed: ['recipientName', 'actorName', 'paymentNo', 'method', 'paidOn', 'amount', 'receiptList', 'orgName'], hasReceipt: false },
  payment_reversed: { label: 'Payment reversed', when: 'Accounting reverses a payment', to: 'The Med Ref who was paid', allowed: [...RECEIPT_VARS, 'paymentNo'], hasReceipt: true },
```
Add to `DEFAULT_TEMPLATES` (after `reversed`):
```ts
  paid: {
    subject: 'Payment sent: {{paymentNo}}',
    heading: 'You have been paid',
    body: 'Hi {{recipientName}},\n\n{{actorName}} recorded payment {{paymentNo}} to you on {{paidOn}} by {{method}}, for a total of {{amount}}.\n\n{{receiptList}}\n\nYou can open the proof of payment on each receipt.',
    buttonLabel: 'View the payment',
    showDetails: false,
  },
  payment_reversed: {
    subject: 'Correction: the payment for {{refNo}} was reversed',
    heading: 'Please disregard the earlier payment notice',
    body: 'Hi {{recipientName}},\n\n{{actorName}} reversed payment {{paymentNo}} for {{refNo}} ({{payee}}). The receipt is back to Approved and is waiting to be paid again.\n\nReason:\n> {{note}}',
    buttonLabel: 'Open the receipt',
    showDetails: true,
  },
```
Add to `SAMPLE_OVERRIDES`:
```ts
  paid: { actorName: 'Rica Tan', amount: 'PHP 1,884.50', receiptList: '• RC-2026-000123 · Mercury Drug - Mandaue · PHP 1,284.50\n• RC-2026-000131 · Shell Mandaue · PHP 600.00' },
  payment_reversed: { actorName: 'Rica Tan', status: 'Approved', note: 'Recorded against the wrong person. It will be paid again today.', docNo: '' },
```

- [ ] **Step 4: Let a notice choose its button link**

In `apps/api/src/lib/notify.ts`, change the `email` field of `NotifyInput` to:
```ts
  email?: { template: TemplateKey; data: Record<string, string>; respectPref?: 'reservationReleased'; link?: string };
```
and in `notify()` the `link:` line to:
```ts
      link: input.email.link ?? (input.receiptId ? receiptUrl(input.receiptId) : undefined),
```

- [ ] **Step 5: The payment notice**

Create `apps/api/src/lib/paymentNotices.ts`:
```ts
import { config } from '../config.js';
import { notify, receiptUrl } from './notify.js';

export interface PaidLine { id: number; refNo: string; payee: string; amount: number; paid: number }

const php = (n: number) => 'PHP ' + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const longDate = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** Values for the "paid" email: one line per receipt, and a note on any receipt that was paid less than its amount. */
export function paidEmailData(p: { paymentNo: string; method: string; paidOn: string; actorName: string }, lines: PaidLine[]): Record<string, string> {
  const total = lines.reduce((s, l) => s + Math.round(l.paid * 100), 0) / 100;
  return {
    paymentNo: p.paymentNo, method: p.method, paidOn: longDate(p.paidOn), actorName: p.actorName, amount: php(total),
    receiptList: lines.map((l) => `• ${l.refNo} · ${l.payee} · ${php(l.paid)}${Math.round(l.paid * 100) < Math.round(l.amount * 100) ? ` (receipt ${php(l.amount)})` : ''}`).join('\n'),
  };
}

/** One in-app notice and one email to the person who was paid, however many receipts the payment covers. */
export async function announcePaid(a: { payeeId: number; paymentNo: string; method: string; paidOn: string; actorName: string; lines: PaidLine[] }) {
  const data = paidEmailData(a, a.lines);
  const first = a.lines[0]!;
  const what = a.lines.length === 1 ? first.refNo : `${a.lines.length} receipts`;
  await notify({
    userIds: [a.payeeId], type: 'payment.paid', receiptId: first.id,
    text: `${what} paid: ${data.amount} by ${a.method} (${a.paymentNo}).`,
    email: { template: 'paid', data, link: a.lines.length === 1 ? receiptUrl(first.id) : `${config.webOrigin}/receipts` },
  });
}
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `pnpm exec vitest run apps/api/test/email.test.ts packages/shared/test/templates.test.ts`
Expected: PASS, including the existing "every email renders without a leftover placeholder" test, which now also renders `paid` and `payment_reversed`.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/emailTemplates.ts apps/api/src/lib/notify.ts apps/api/src/lib/paymentNotices.ts apps/api/test/email.test.ts
git commit -m "Payment step: editable paid and payment reversed emails, payment notice" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin myBranch
```

---

## Task 6: Payments API: methods, queue, mark as paid, proof

**Files:**
- Create: `apps/api/src/routes/payments.ts`
- Modify: `apps/api/src/server.ts` (mount the router)
- Test: `e2e/payment-flow.mjs`

**Interfaces:**
- Consumes: `paymentRequestSchema`, `paymentMethodsSchema`, `paymentIssues`, `totalOf`, `EVIDENCE_MAX_BYTES` (shared); `getPaymentMethods`, `savePaymentMethods`, `nextPaymentNo`, `announcePaid`, `visibleWhere`, `receiptBrief`, `receiptInclude`, storage helpers (`saveFile`, `removeFile`, `readFile`, `sha256Of`, `sniff`).
- Produces:
  - `GET /api/payments/methods` → `{ methods: string[] }` (any signed-in user).
  - `PUT /api/payments/methods` body `{ methods: string[] }` → `{ methods }` (`settings.manage`), audited as `settings.payment_methods`.
  - `GET /api/payments/queue` (`payment.mark`) → `{ groups: { payee: { id: number; name: string; branch: string | null }; count: number; total: number; receipts: ReceiptBrief[] }[]; totals: { count: number; total: number } }`.
  - `POST /api/payments` (`payment.mark`), multipart fields `method`, `paidOn`, `lines` (JSON string of `{ receiptId, version, amount, shortReason }[]`), file `proof` → 201 `{ payment: { id, paymentNo, method, paidOn, count, total } }`. Error codes: `BAD_LINES`, `BAD_METHOD`, `PROOF_REQUIRED`, `BAD_FILE`, `FILE_TOO_LARGE`, `DUPLICATE_RECEIPT`, `OWN_RECEIPT` (403), `INVALID_STATE` (409), `RECORD_CHANGED` (409), `MIXED_PAYEES`, `DATE_FUTURE`, `OVERPAID`, `SHORT_REASON` (400 unless noted).
  - `GET /api/payments/:id/proof?mode=view|download|print`, audited `payment.proof_viewed|downloaded|printed`.

- [ ] **Step 1: Add the failing checks**

Insert directly above `// END OF CHECKS` in `e2e/payment-flow.mjs`:

```js
console.log('\nThe payment queue');
const a2 = await makeApproved(U, 'ana', 'Batch A', 250.5);
const a3 = await makeApproved(U, 'ana', 'Batch B', 749.5);
const m1 = await makeApproved(U, 'mark', 'Other person', 300);
for (const who of ['ana', 'liza', 'paolo', 'admin']) ok(`${who} cannot open the payment queue`, (await call(U[who], 'GET', '/payments/queue')).s === 403);
const q = await call(U.rica, 'GET', '/payments/queue');
const groupOf = (name) => q.d?.groups.find((g) => g.payee.name === name);
ok('accounting can open the queue', q.s === 200);
ok('the queue is grouped by person', !!groupOf('Ana Reyes')?.receipts.some((r) => r.id === a2.id) && !!groupOf('Mark Dela Cruz')?.receipts.some((r) => r.id === m1.id));
ok('each group has its count and total', groupOf('Ana Reyes')?.count >= 3 && groupOf('Ana Reyes')?.total >= 2000);

console.log('\nPayment methods');
const methods = (await call(U.rica, 'GET', '/payments/methods')).d?.methods ?? [];
ok('the method list starts with the four defaults', ['Bank transfer', 'Cheque', 'Cash', 'E-wallet'].every((m) => methods.includes(m)));
ok('accounting cannot change the method list', (await call(U.rica, 'PUT', '/payments/methods', { methods: ['Cash'] })).s === 403);
ok('the list cannot be emptied', (await call(U.admin, 'PUT', '/payments/methods', { methods: [] })).s === 400);
const changed = await call(U.admin, 'PUT', '/payments/methods', { methods: [...methods, 'GCash'] });
ok('the Super Admin can add a method', changed.s === 200 && changed.d.methods.includes('GCash'));
await call(U.admin, 'PUT', '/payments/methods', { methods });

console.log('\nRefused payments');
const code = (r) => r.d?.error?.code;
ok('approver cannot pay', (await pay(U.paolo, [a1])).s === 403);
ok('Super Admin cannot pay by default', (await pay(U.admin, [a1])).s === 403);
ok('receipts of two people in one payment are refused', code(await pay(U.rica, [a2, m1])) === 'MIXED_PAYEES');
ok('paying more than the receipt is refused', code(await pay(U.rica, [a1], { amounts: { [a1.id]: 1000.01 } })) === 'OVERPAID');
ok('paying less without a reason is refused', code(await pay(U.rica, [a1], { amounts: { [a1.id]: 999.99 } })) === 'SHORT_REASON');
ok('a zero amount is refused', (await pay(U.rica, [a1], { amounts: { [a1.id]: 0 } })).s === 400);
const future = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
ok('a future payment date is refused', code(await pay(U.rica, [a1], { paidOn: future })) === 'DATE_FUTURE');
ok('a method that is not on the list is refused', code(await pay(U.rica, [a1], { method: 'Bitcoin' })) === 'BAD_METHOD');
ok('a payment without proof is refused', code(await pay(U.rica, [a1], { noProof: true })) === 'PROOF_REQUIRED');
ok('a text file renamed .png is refused', code(await pay(U.rica, [a1], { proof: Buffer.from('this is not a picture at all'), proofName: 'proof.png' })) === 'BAD_FILE');
ok('the same receipt twice is refused', code(await pay(U.rica, [a1, a1])) === 'DUPLICATE_RECEIPT');
ok('a stale version is refused', code(await pay(U.rica, [{ ...a1, version: a1.version - 1 }])) === 'RECORD_CHANGED');
ok('a draft cannot be paid', (await pay(U.rica, [draft])).s === 404);
ok('after all that, the receipt is still approved', (await call(U.rica, 'GET', `/receipts/${a1.id}`)).d.receipt.status === 'approved');

console.log('\nNobody pays their own receipt');
const roles = (await call(U.admin, 'GET', '/roles')).d.roles;
const medrefRole = roles.find((r) => r.code === 'medref');
const grantsBefore = (await call(U.admin, 'GET', '/permissions')).d.grants[medrefRole.id];
try {
  await call(U.admin, 'PUT', `/roles/${medrefRole.id}/permissions`, { codes: [...grantsBefore, 'payment.mark'] });
  const own = await makeApproved(U, 'ana', 'Own receipt', 120);
  const r = await pay(U.ana, [own]);
  ok('a Med Ref with payment rights still cannot pay their own receipt', r.s === 403 && code(r) === 'OWN_RECEIPT');
} finally {
  await call(U.admin, 'PUT', `/roles/${medrefRole.id}/permissions`, { codes: grantsBefore });
}

console.log('\nPaying');
const p1 = await pay(U.rica, [a1], { method: 'Cash' });
ok('accounting pays one receipt', p1.s === 201 && /^PAY-\d{4}-\d{6}$/.test(p1.d.payment.paymentNo) && p1.d.payment.total === 1000);
const paid1 = (await call(U.rica, 'GET', `/receipts/${a1.id}`)).d.receipt;
ok('the receipt is Paid with a payment block', paid1.status === 'paid' && paid1.payment?.paymentNo === p1.d.payment.paymentNo && paid1.payment.amount === 1000 && paid1.payment.method === 'Cash' && paid1.payment.recordedBy === 'Rica Tan');
ok('a paid receipt cannot be paid again', code(await pay(U.rica, [paid1])) === 'INVALID_STATE');
ok('a paid receipt cannot be edited by its owner', (await call(U.ana, 'PATCH', `/receipts/${a1.id}`, { payee: 'Changed', receiptDate: today(), amount: 1, birInvoice: false, vendorAddress: 'x', reasonForSpending: 'x', classification: 'fuel' })).s === 409);
ok('the approver can no longer take the approval back', (await call(U.paolo, 'POST', `/receipts/${a1.id}/undo`, { version: paid1.version, note: 'Trying' })).s === 409);
ok('the approver still sees the paid receipt', (await call(U.paolo, 'GET', `/receipts/${a1.id}`)).d?.receipt.status === 'paid');
ok('there is no plain /pay action route', (await call(U.rica, 'POST', `/receipts/${a2.id}/pay`, { version: a2.version })).s === 404);

const batch = await pay(U.rica, [a2, a3], { amounts: { [a3.id]: 700 }, reasons: { [a3.id]: 'Cash advance of 49.50 deducted' } });
ok('accounting pays two receipts of one person in one payment, one of them short', batch.s === 201 && batch.d.payment.count === 2 && batch.d.payment.total === 950.5);
const b3 = (await call(U.ana, 'GET', `/receipts/${a3.id}`)).d.receipt;
ok('the short receipt keeps its real amount and reason', b3.payment?.amount === 700 && b3.payment?.shortReason === 'Cash advance of 49.50 deducted');
const b2 = (await call(U.ana, 'GET', `/receipts/${a2.id}`)).d.receipt;
ok('both receipts share one payment number', b2.payment?.paymentNo === b3.payment?.paymentNo);

console.log('\nTwo people paying the same receipt at once');
const race = await makeApproved(U, 'ana', 'Race', 100);
const both = await Promise.all([pay(U.rica, [race]), pay(U.rica, [race])]);
ok('exactly one wins and the other gets a conflict', both.map((x) => x.s).sort().join() === '201,409');
const raced = (await call(U.rica, 'GET', `/receipts/${race.id}`)).d.receipt;
ok('the receipt is paid once', raced.status === 'paid' && both.some((x) => x.s === 201 && x.d.payment.paymentNo === raced.payment.paymentNo));

console.log('\nProof of payment');
const proofUrl = (id, mode) => `${B}/payments/${id}/proof?mode=${mode}`;
const get = (c, url) => fetch(url, { headers: H(c, false) });
ok('the person who was paid can view the proof', (await get(U.ana, proofUrl(paid1.payment.id, 'view'))).status === 200);
ok('accounting can download the proof', (await get(U.rica, proofUrl(paid1.payment.id, 'download'))).headers.get('content-disposition')?.startsWith('attachment'));
ok('another Med Ref cannot see it', (await get(U.mark, proofUrl(paid1.payment.id, 'view'))).status === 404);
const audit = (await call(U.admin, 'GET', `/audit?action=payment.proof_&q=${encodeURIComponent(paid1.payment.paymentNo)}`)).d;
ok('every proof view and download is in the audit log', (audit?.items ?? []).length >= 2);

console.log('\nNotices');
const anaNotes = (await call(U.ana, 'GET', '/notifications')).d.items;
ok('the Med Ref has an in-app notice with the payment number', anaNotes.some((n) => n.text.includes(p1.d.payment.paymentNo)));
const ricaNotes = (await call(U.rica, 'GET', '/notifications')).d.items;
ok('accounting was told a receipt is ready to pay', ricaNotes.some((n) => n.text.includes('ready to pay')));
const mails = (await call(U.admin, 'GET', '/email-log')).d.items;
ok('one "paid" email per payment went to the Med Ref', mails.filter((e) => e.template === 'paid' && e.to === 'ana.reyes@example.com').length >= 2);
ok('accounting got no email about approvals', !mails.some((e) => e.to === 'accounting@example.com'));
const dash2 = (await call(U.rica, 'GET', '/dashboard')).d;
ok('paid this month went up', dash2.paidThisMonth.count >= 4 && dash2.paidThisMonth.total >= 2050.5);
```

- [ ] **Step 2: Run to see it fail**

Run: `node e2e/payment-flow.mjs`
Expected: FAIL from "The payment queue" onward (the routes return 404), and on the accounting "ready to pay" notice (added in Task 7, so that single check keeps failing until then).

- [ ] **Step 3: Implement the router**

Create `apps/api/src/routes/payments.ts`:

```ts
import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { EVIDENCE_MAX_BYTES, paymentIssues, paymentMethodsSchema, paymentRequestSchema, totalOf } from '@reimsys/shared';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { getSettings } from '../lib/appSettings.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { getPaymentMethods, savePaymentMethods } from '../lib/paymentMethods.js';
import { announcePaid } from '../lib/paymentNotices.js';
import { receiptBrief, receiptInclude, visibleWhere } from '../lib/receipts.js';
import { nextPaymentNo } from '../lib/sequence.js';
import { readFile, removeFile, saveFile, sha256Of, sniff } from '../lib/storage.js';
import { requireAuth, requirePerm } from '../middleware/auth.js';

export const paymentsRouter = Router();
paymentsRouter.use(requireAuth);

const idParam = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw notFound('Payment not found.');
  return n;
};
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: EVIDENCE_MAX_BYTES, files: 1 } });
const payLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false, message: { error: { code: 'RATE_LIMIT', message: 'Too many payments in a minute. Wait a moment.' } } });

/* ---------- payment methods ---------- */

paymentsRouter.get('/methods', async (_req, res) => {
  res.json({ methods: await getPaymentMethods() });
});

paymentsRouter.put('/methods', requirePerm('settings.manage'), async (req, res) => {
  const { methods } = paymentMethodsSchema.parse(req.body);
  const before = await getPaymentMethods();
  await savePaymentMethods(methods, req.auth!.user.id);
  await audit(req, { action: 'settings.payment_methods', entityType: 'settings', entityId: 'payment.methods', summary: `changed the payment methods to ${methods.join(', ')}`, before: { methods: before }, after: { methods } });
  res.json({ methods });
});

/* ---------- what is waiting to be paid ---------- */

paymentsRouter.get('/queue', requirePerm('payment.mark'), async (req, res) => {
  const auth = req.auth!;
  const rows = await prisma.receipt.findMany({
    where: { AND: [visibleWhere(auth), { status: 'approved', encoderId: { not: auth.user.id } }] },
    include: receiptInclude, orderBy: [{ decidedAt: 'asc' }, { id: 'asc' }], take: 1000,
  });
  const people = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.encoderId))] } }, select: { id: true, name: true, branch: true } });
  const groups = people.map((payee) => {
    const mine = rows.filter((r) => r.encoderId === payee.id);
    return { payee, count: mine.length, total: totalOf(mine.map((r) => ({ amount: Number(r.amount) }))), receipts: mine.map(receiptBrief) };
  }).sort((a, b) => a.payee.name.localeCompare(b.payee.name));
  res.json({ groups, totals: { count: rows.length, total: totalOf(rows.map((r) => ({ amount: Number(r.amount) }))) } });
});

/* ---------- mark as paid ---------- */

paymentsRouter.post('/', requirePerm('payment.mark'), payLimiter, upload.single('proof'), async (req, res) => {
  const auth = req.auth!;
  let lines: unknown;
  try { lines = JSON.parse(String(req.body?.lines ?? '')); } catch { throw badRequest('The list of receipts could not be read. Reload and try again.', 'BAD_LINES'); }
  const body = paymentRequestSchema.parse({ method: req.body?.method, paidOn: req.body?.paidOn, lines });

  const method = (await getPaymentMethods()).find((m) => m.toLowerCase() === body.method.toLowerCase());
  if (!method) throw badRequest('Choose one of the listed payment methods.', 'BAD_METHOD');
  const file = req.file;
  if (!file) throw badRequest('Attach the proof of payment (a photo or PDF).', 'PROOF_REQUIRED');
  const kind = sniff(file.buffer);
  if (!kind) throw badRequest('The proof must be a JPG, PNG, WEBP, HEIC or PDF file.', 'BAD_FILE');
  const maxMb = getSettings().evidenceMaxMb;
  if (file.size > maxMb * 1_048_576) throw badRequest(`The proof is over ${maxMb} MB.`, 'FILE_TOO_LARGE');

  const ids = body.lines.map((l) => l.receiptId);
  if (new Set(ids).size !== ids.length) throw badRequest('The same receipt is listed twice.', 'DUPLICATE_RECEIPT');
  const receipts = await prisma.receipt.findMany({ where: { AND: [{ id: { in: ids } }, visibleWhere(auth)] } });
  if (receipts.length !== ids.length) throw notFound('One of the receipts was not found.');
  for (const r of receipts) {
    if (r.encoderId === auth.user.id) throw forbidden('You cannot pay a receipt you encoded.', 'OWN_RECEIPT');
    if (r.status !== 'approved') throw conflict(`${r.refNo} is ${r.status}, so it cannot be paid.`, 'INVALID_STATE');
    if (body.lines.find((l) => l.receiptId === r.id)!.version !== r.version) throw conflict(`${r.refNo} changed since you opened it. Reload and try again.`, 'RECORD_CHANGED');
  }
  if (new Set(receipts.map((r) => r.encoderId)).size !== 1) throw badRequest('One payment can only cover the receipts of one person.', 'MIXED_PAYEES');
  const issue = paymentIssues(body, new Map(receipts.map((r) => [r.id, Number(r.amount)])))[0];
  if (issue) {
    const ref = receipts.find((r) => r.id === issue.receiptId)?.refNo;
    throw badRequest(ref ? `${ref}: ${issue.message}` : issue.message, issue.code);
  }

  const payeeId = receipts[0]!.encoderId;
  const proofFile = await saveFile('proofs', kind.ext, file.buffer);
  const now = new Date();
  let payment: { id: number; paymentNo: string };
  try {
    // Every receipt changes in the same transaction, and only if it is still approved at the version that was shown, so nobody pays twice.
    payment = await prisma.$transaction(async (tx) => {
      const p = await tx.payment.create({
        data: { paymentNo: await nextPaymentNo(tx), payeeId, method, paidOn: new Date(body.paidOn + 'T00:00:00Z'), proofFile, proofMime: kind.mime, proofSize: file.size, proofSha256: sha256Of(file.buffer), recordedById: auth.user.id },
      });
      for (const l of body.lines) {
        const done = await tx.receipt.updateMany({
          where: { id: l.receiptId, version: l.version, status: 'approved' },
          data: { status: 'paid', version: { increment: 1 }, paymentId: p.id, paidAmount: l.amount, paidShortReason: l.shortReason, paidAt: now },
        });
        if (!done.count) throw conflict('Someone else changed one of these receipts. Reload and try again.', 'RECORD_CHANGED');
      }
      return p;
    });
  } catch (err) {
    await removeFile(proofFile).catch(() => undefined);
    throw err;
  }

  for (const r of receipts) {
    const l = body.lines.find((x) => x.receiptId === r.id)!;
    await audit(req, {
      action: 'payment.marked', entityType: 'receipt', entityId: r.id, summary: `marked as paid (${payment.paymentNo})`,
      before: { status: 'approved' }, after: { status: 'paid', paymentNo: payment.paymentNo, amount: l.amount, method, paidOn: body.paidOn, ...(l.shortReason ? { note: l.shortReason } : {}) },
    });
  }
  await announcePaid({
    payeeId, paymentNo: payment.paymentNo, method, paidOn: body.paidOn, actorName: auth.user.name,
    lines: body.lines.map((l) => { const r = receipts.find((x) => x.id === l.receiptId)!; return { id: r.id, refNo: r.refNo, payee: r.payee, amount: Number(r.amount), paid: l.amount }; }),
  });
  res.status(201).json({ payment: { id: payment.id, paymentNo: payment.paymentNo, method, paidOn: body.paidOn, count: body.lines.length, total: totalOf(body.lines) } });
});

/* ---------- proof of payment ---------- */

const MODES = { view: ['evidence.view', 'inline', 'viewed'], print: ['evidence.print', 'inline', 'printed'], download: ['evidence.download', 'attachment', 'downloaded'] } as const;
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'application/pdf': 'pdf' };

/** The person who was paid, Accounting, and anyone who can see a receipt in the payment. Everyone else gets "not found". */
paymentsRouter.get('/:id/proof', async (req, res) => {
  const auth = req.auth!;
  const mode = (typeof req.query.mode === 'string' && req.query.mode in MODES ? req.query.mode : 'view') as keyof typeof MODES;
  const [perm, disposition, verb] = MODES[mode];
  if (!auth.permissions.has(perm)) throw forbidden();
  const p = await prisma.payment.findUnique({ where: { id: idParam(req.params.id) } });
  if (!p) throw notFound('Payment not found.');
  const allowed = p.payeeId === auth.user.id || auth.permissions.has('payment.mark')
    || !!(await prisma.receipt.findFirst({ where: { AND: [{ paymentId: p.id }, visibleWhere(auth)] }, select: { id: true } }));
  if (!allowed) throw notFound('Payment not found.');
  // The audit row is written before any byte is sent.
  await audit(req, { action: `payment.proof_${verb}`, entityType: 'payment', entityId: p.id, summary: `${verb} the proof of payment ${p.paymentNo}` });
  const buf = await readFile(p.proofFile);
  res.setHeader('Content-Type', p.proofMime);
  res.setHeader('Content-Disposition', `${disposition}; filename="${p.paymentNo}.${EXT[p.proofMime] ?? 'bin'}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(buf);
});
```

In `apps/api/src/server.ts` import it next to the other routers and mount it after the documents router:
```ts
import { paymentsRouter } from './routes/payments.js';
```
```ts
app.use('/api/payments', paymentsRouter);
```

- [ ] **Step 4: Run to see it pass**

Run: `pnpm --filter @reimsys/api typecheck` (only the known `SUMMARY` error may remain) and `node e2e/payment-flow.mjs`
Expected: every check passes except "accounting was told a receipt is ready to pay" (Task 7). If "a zero amount is refused" fails with 500, the zod error middleware is not catching the multipart parse: confirm the global error handler maps `ZodError` to 400 (it does for JSON routes) and that the parse runs inside the handler (it does above).

Also confirm no orphan proof files: count the files under the `proofs` folder in `STORAGE_DIR` before and after a second run of the script. It should grow by exactly 3 per run at this point (`p1`, `batch`, the race winner; Task 7 adds one more for the re-payment). No file is kept for any refused payment or for the race loser.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/payments.ts apps/api/src/server.ts e2e/payment-flow.mjs
git commit -m "Payment step: payment queue, mark as paid with proof in one transaction, protected proof downloads, editable methods" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin myBranch
```

---

## Task 7: Reversing a payment, and telling Accounting about approvals

**Files:**
- Modify: `apps/api/src/routes/receipts.ts` (`SUMMARY`, `runAction`, transition route loop)
- Test: `e2e/payment-flow.mjs`

**Interfaces:**
- Consumes: `transitionFor('reverse_payment')`, `r.payment` (from `receiptInclude`), template `payment_reversed`.
- Produces: `POST /api/receipts/:id/reverse_payment` body `{ version, note }` → `{ receipt }`; audited as `payment.reversed`; no `/api/receipts/:id/pay` route; on approve, every active `payment.mark` user (except the approver and the encoder) gets an in-app notice `receipt.ready_to_pay`.

- [ ] **Step 1: Add the failing checks**

Insert directly above `// END OF CHECKS`:

```js
console.log('\nReversing a payment');
let rv = (await call(U.rica, 'GET', `/receipts/${a2.id}`)).d.receipt;
const oldPaymentId = rv.payment.id;
ok('a reversal needs a reason', code(await call(U.rica, 'POST', `/receipts/${a2.id}/reverse_payment`, { version: rv.version })) === 'NOTE_REQUIRED');
ok('the Med Ref cannot reverse a payment', (await call(U.ana, 'POST', `/receipts/${a2.id}/reverse_payment`, { version: rv.version, note: 'No' })).s === 403);
ok('the approver cannot reverse a payment', (await call(U.paolo, 'POST', `/receipts/${a2.id}/reverse_payment`, { version: rv.version, note: 'No' })).s === 403);
const rev = await call(U.rica, 'POST', `/receipts/${a2.id}/reverse_payment`, { version: rv.version, note: 'Paid the wrong amount' });
ok('accounting reverses it with a reason', rev.s === 200 && rev.d.receipt.status === 'approved' && rev.d.receipt.payment === null);
const sibling = (await call(U.rica, 'GET', `/receipts/${a3.id}`)).d.receipt;
ok('the other receipt in the same payment stays paid', sibling.status === 'paid');
ok('the old proof is still there for accounting', (await get(U.rica, proofUrl(oldPaymentId, 'view'))).status === 200);
const again = await pay(U.rica, [rev.d.receipt]);
ok('the reversed receipt can be paid again', again.s === 201 && again.d.payment.id !== oldPaymentId);
const hist = (await call(U.rica, 'GET', `/receipts/${a2.id}/history`)).d.items.map((h) => h.action);
ok('the history shows paid, reversed and paid again', hist.filter((a) => a === 'payment.marked').length === 2 && hist.includes('payment.reversed'));
const anaNotes2 = (await call(U.ana, 'GET', '/notifications')).d.items;
ok('the Med Ref was told about the reversal', anaNotes2.some((n) => n.text.includes('was reversed') && n.text.includes('Paid the wrong amount')));
const mails2 = (await call(U.admin, 'GET', '/email-log')).d.items;
ok('a "payment reversed" email was sent', mails2.some((e) => e.template === 'payment_reversed' && e.to === 'ana.reyes@example.com'));
```

- [ ] **Step 2: Run to see it fail**

Run: `node e2e/payment-flow.mjs`
Expected: the reversal checks fail (`SUMMARY` has no `reverse_payment`; the API typecheck already fails on it) and "accounting was told a receipt is ready to pay" still fails.

- [ ] **Step 3: Implement**

In `apps/api/src/routes/receipts.ts`:

`SUMMARY`: add two entries:
```ts
  pay: 'marked as paid', reverse_payment: 'reversed the payment',
```
At the very top of `runAction`, right after `const t = transitionFor(action)!;`:
```ts
  if (action === 'pay') throw badRequest('Use the payment form to mark receipts as paid.', 'USE_PAYMENT_FORM');
```
Next to the other `if (action === …) Object.assign(data, …)` lines:
```ts
  // The payment row stays (it is the record of what happened); only the receipt's link to it is cleared.
  if (action === 'reverse_payment') Object.assign(data, { paymentId: null, paidAmount: null, paidShortReason: null, paidAt: null });
```
Replace the `await audit(req, { action: \`receipt.${action}\`, …` call with:
```ts
  await audit(req, {
    action: action === 'reverse_payment' ? 'payment.reversed' : `receipt.${action}`, entityType: 'receipt', entityId: r.id, summary: SUMMARY[action],
    before: { status: r.status, ...(action === 'reverse_payment' && r.payment ? { paymentNo: r.payment.paymentNo, amount: Number(r.paidAmount) } : {}) },
    after: { status: t.to, ...(note ? { note } : {}), ...(docNo ? { docNo } : {}), ...(action === 'check' && body.seen ? { seen: body.seen } : {}) },
  });
```
In the notifications block, after the `approve` line add:
```ts
  if (action === 'approve') await notify({ userIds: others(await usersWithPermission('payment.mark')).filter((id) => id !== r.encoderId), type: 'receipt.ready_to_pay', receiptId: r.id, text: `${ref} was approved and is ready to pay.` });
  if (action === 'reverse_payment') await notify({ userIds: [r.encoderId], type: 'payment.reversed', receiptId: r.id, text: `The payment for ${ref} was reversed. ${note}`, email: { template: 'payment_reversed', data: { ...mail, paymentNo: r.payment?.paymentNo ?? '' } } });
```
Change the route loop at the bottom so there is no plain pay route:
```ts
for (const t of TRANSITIONS) {
  if (t.action === 'pay') continue; // paying needs the proof and amounts: POST /api/payments
  receiptsRouter.post(`/:id/${t.action}`, async (req, res) => {
    res.json({ receipt: await runAction(req, t.action) });
  });
}
```

- [ ] **Step 4: Run to see it pass**

Run: `pnpm --filter @reimsys/api typecheck` (now clean) and `node e2e/payment-flow.mjs`
Expected: `All checks passed`.

Also run the existing API workflow to be sure nothing else moved: `node e2e/api-flow.mjs`
Expected: passes as before (if a check counts notifications per approval and now sees an extra Accounting one, update that check's expected count and say so in the commit message).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/receipts.ts e2e/payment-flow.mjs
git commit -m "Payment step: reverse a payment with a reason, history and emails; Accounting is told when a receipt is ready to pay" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin myBranch
```

---

## Task 8: Reports and export: paid filter, paid columns, totals

**Files:**
- Modify: `apps/api/src/lib/reports.ts`
- Modify: `apps/api/src/routes/reports.ts`
- Modify: `apps/api/src/routes/receipts.ts` (`/export` columns)
- Test: `apps/api/test/pdf.test.ts`, `e2e/payment-flow.mjs`

**Interfaces:**
- Consumes: `PaymentFilter`, `PAYMENT_FILTER_LABEL`, `reportRequestSchema.payment`.
- Produces:
  - `ReportFilters.payment?: PaymentFilter` (missing means `'all'`, so reports saved before this change still open).
  - Each report row gains `paid: boolean; paidAmount: number; paidOn: string; method: string; paymentNo: string; shortReason: string`.
  - `Totals` = `{ gross, vatable, vat, wht, paid, unpaid }` (`paid` = sum of amounts paid, `unpaid` = sum of gross amounts not yet paid).
  - `GET /api/reports/preview?…&payment=paid|unpaid|all` → `{ count, total, paid, unpaid }`; `GET /api/reports/:id/data` → `report.payment` plus the new row fields and totals.
  - CSV/XLSX columns appended after "Gross amount (PHP)": `Payment`, `Paid on`, `Method`, `Payment no.`, `Amount paid (PHP)`. PDF gains a "Paid" column and a second totals line.
  - Receipt export (`/api/receipts/export`) gains `Payment no.`, `Paid on`, `Amount paid (PHP)` at the end.

- [ ] **Step 1: Write the failing unit tests**

In `apps/api/test/pdf.test.ts`, replace the `row` and `totals` helpers and the import, and add tests:

```ts
import { describe, expect, it } from 'vitest';
import { buildCsv, buildPdf } from '../src/lib/reports';

const row = (i: number, paid = false) => ({
  docNo: `REIM-2026-${String(i).padStart(6, '0')}`, refNo: `RC-2026-${String(i).padStart(6, '0')}`, date: '2026-10-12', invoiceNo: `SI-${i}`, payee: 'Mercury Drug', vendorTin: '123-456-789-00000', category: 'Product', vatType: 'Vatable', vatable: 1147.77, vat: 137.73, wht: 0, encoder: 'Ana Reyes', approvedAt: '2026-10-13', amount: 1284.5,
  paid, paidAmount: paid ? 1200 : 0, paidOn: paid ? '2026-10-15' : '', method: paid ? 'Bank transfer' : '', paymentNo: paid ? 'PAY-2026-000001' : '', shortReason: paid ? 'Advance deducted' : '',
});
const totals = (n: number, paidRows = 0) => ({ gross: n * 1284.5, vatable: n * 1147.77, vat: n * 137.73, wht: 0, paid: paidRows * 1200, unpaid: (n - paidRows) * 1284.5 });
```
Keep the three existing PDF tests (they call `buildPdf([row(1)], totals(1), range)` etc., which still fit). Add:

```ts
describe('liquidation report payment columns', () => {
  it('the CSV has the payment columns and the paid total', async () => {
    const csv = (await buildCsv([row(1, true), row(2)], totals(2, 1))).toString('utf8');
    const [head, first, second, total] = csv.replace(/^﻿/, '').trim().split('\r\n');
    expect(head).toContain('Payment,Paid on,Method,Payment no.,Amount paid (PHP)');
    expect(first).toContain('Paid,2026-10-15,Bank transfer,PAY-2026-000001,1200');
    expect(second).toContain('Not yet paid,,,,');
    expect(total!.endsWith(',1200')).toBe(true);
  });
  it('the PDF with paid rows still fits on one page', async () => {
    const buf = await buildPdf([row(1, true), row(2), row(3, true)], totals(3, 2), { ...range, label: 'Payment: Paid' });
    expect(pages(buf)).toBe(1);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `pnpm exec vitest run apps/api/test/pdf.test.ts`
Expected: FAIL (no payment columns).

- [ ] **Step 3: Implement `lib/reports.ts`**

Imports: add `PAYMENT_FILTER_LABEL, type PaymentFilter` to the `@reimsys/shared` import.

```ts
export interface ReportFilters { from: string; to: string; categoryId?: number | null; transactionType?: string | null; encoderId?: number | null; payment?: PaymentFilter; scope: Prisma.ReceiptWhereInput }
```
`filterLabel`: change its parameter type to include `payment?: PaymentFilter` and add before `return`:
```ts
  if (f.payment && f.payment !== 'all') parts.push(`Payment: ${PAYMENT_FILTER_LABEL[f.payment]}`);
```
`reportRows`: replace `{ status: 'approved' },` with
```ts
      // Paid receipts were approved first, so "all" means both. Old saved reports have no payment filter and mean "all".
      { status: { in: f.payment === 'paid' ? ['paid'] : f.payment === 'unpaid' ? ['approved'] : ['approved', 'paid'] } },
```
add `payment: true` to the `include`, and add to each mapped row:
```ts
    paid: r.status === 'paid', paidAmount: r.paidAmount === null ? 0 : Number(r.paidAmount), paidOn: r.payment ? dateOnly(r.payment.paidOn) : '',
    method: r.payment?.method ?? '', paymentNo: r.payment?.paymentNo ?? '', shortReason: r.paidShortReason ?? '',
```
Replace the totals lines at the end of `reportRows`:
```ts
  const sum = (list: typeof data, k: 'amount' | 'vatable' | 'vat' | 'wht' | 'paidAmount') => Math.round(list.reduce((s, r) => s + r[k] * 100, 0)) / 100;
  return {
    rows: data, total: sum(data, 'amount'),
    totals: { gross: sum(data, 'amount'), vatable: sum(data, 'vatable'), vat: sum(data, 'vat'), wht: sum(data, 'wht'), paid: sum(data, 'paidAmount'), unpaid: sum(data.filter((r) => !r.paid), 'amount') },
  };
```
`Totals`, `HEAD`, `cells`:
```ts
type Totals = { gross: number; vatable: number; vat: number; wht: number; paid: number; unpaid: number };
const HEAD = ['Document no.', 'Receipt ref.', 'Invoice date', 'Invoice no.', 'Vendor', 'Vendor TIN', 'Type', 'VAT type', 'Vatable amount', 'VAT amount', 'Withholding amount', 'Encoded by', 'Approved', 'Gross amount (PHP)', 'Payment', 'Paid on', 'Method', 'Payment no.', 'Amount paid (PHP)'];
const cells = (r: Row) => [r.docNo, r.refNo, r.date, r.invoiceNo, r.payee, r.vendorTin, r.category, r.vatType, r.vatable, r.vat, r.wht, r.encoder, r.approvedAt, r.amount, r.paid ? 'Paid' : 'Not yet paid', r.paidOn, r.method, r.paymentNo, r.paid ? r.paidAmount : ''];
```
`buildCsv` total row:
```ts
  return Buffer.from(toCsv([HEAD, ...rows.map(cells), ['', '', '', '', '', '', '', 'Total', t.vatable, t.vat, t.wht, '', '', t.gross, '', '', '', '', t.paid]]));
```
`buildXlsx`: the subtitle becomes `` `Approved and paid records from ${f.from} to ${f.to}${f.label ? ' · ' + f.label : ''}` ``; the total row becomes
```ts
  const tot = ws.addRow(['', '', '', '', '', '', '', 'Total', sumOf('I'), sumOf('J'), sumOf('K'), '', '', sumOf('N'), '', '', '', '', sumOf('S')]);
```
the number formats `for (const c of [9, 10, 11, 14, 19])`, and the widths
```ts
  [16, 16, 13, 16, 28, 18, 12, 13, 15, 13, 17, 22, 12, 18, 13, 12, 15, 18, 16].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
```
`buildPdf`: the columns (Amount takes what is left, about 96 points):
```ts
    const cols = [{ h: 'Document no.', w: 84 }, { h: 'Invoice no.', w: 90 }, { h: 'Date', w: 56 }, { h: 'Vendor', w: 112 }, { h: 'Type', w: 48 }, { h: 'Encoded by', w: 78 }, { h: 'VAT', w: 62 }, { h: 'Withheld', w: 62 }, { h: 'Paid', w: 74 }, { h: 'Amount', w: 0 }];
    cols[9]!.w = W - cols.slice(0, 9).reduce((s, c) => s + c.w, 0);
```
the header alignment list `['Amount', 'VAT', 'Withheld', 'Paid'].includes(c.h)`, the subtitle text `` `Approved and paid records · ${f.from} to ${f.to}…` `` (keep the rest of that string), the row values
```ts
      const vals = [r.docNo, r.invoiceNo || r.refNo, r.date, r.payee, r.category, r.encoder, php(r.vat), php(r.wht), r.paid ? php(r.paidAmount) : 'Not yet', php(r.amount)];
```
and after the existing totals line add a second line:
```ts
    doc.font('Helvetica').fontSize(10).fillColor('#12232b').text(`Paid ${php(t.paid)}   ·   Not yet paid ${php(t.unpaid)}`, L, y + 28, { width: W, align: 'right' });
```
(The row loop's `j >= 6` right-alignment still covers VAT, Withheld, Paid and Amount.)

- [ ] **Step 4: Implement the routes**

`apps/api/src/routes/reports.ts`:
- `/preview`: add `payment: req.query.payment || undefined,` to the object being parsed, and respond with the totals too:
```ts
  const { rows, total, totals } = await reportRows({ ...q, scope: scopeFor(req) });
  res.json({ count: rows.length, total, paid: totals.paid, unpaid: totals.unpaid });
```
- `POST /`: add `payment: body.payment,` to `filters`.
- `/:id/data`: add `payment: f.payment ?? 'all',` to the `report` object in the response (rows and totals already carry the new fields).
- `/:id/file`: change the slug cleanup to `label.replace(/(Person|Category|Payment): /g, '')`.

`apps/api/src/routes/receipts.ts` `/export`: append `'Payment no.', 'Paid on', 'Amount paid (PHP)'` to `head`; append `r.payment?.paymentNo ?? '', r.payment ? dateOnly(r.payment.paidOn) : '', num(r.paidAmount)` to each data row; change the number-format list to `[10, 12, 13, 15, 16, 24]`; append `18, 12, 16` to the widths list.

- [ ] **Step 5: Add the report checks to the e2e script**

Insert directly above `// END OF CHECKS`:

```js
console.log('\nReports');
const first = today().slice(0, 8) + '01';
const range = `from=${first}&to=${today()}`;
const pv = async (payment) => (await call(U.rica, 'GET', `/reports/preview?${range}&payment=${payment}`)).d;
const [pAll, pPaid, pUnpaid] = [await pv('all'), await pv('paid'), await pv('unpaid')];
ok('paid + not yet paid = all', pAll.count === pPaid.count + pUnpaid.count && Math.abs(pAll.total - (pPaid.total + pUnpaid.total)) < 0.005);
ok('the preview gives the paid and unpaid totals', pAll.paid === pPaid.paid && pUnpaid.paid === 0 && Math.abs(pAll.unpaid - pUnpaid.total) < 0.005);
const made = await call(U.rica, 'POST', '/reports', { from: first, to: today(), format: 'csv', payment: 'paid' });
let rep;
for (let i = 0; i < 40; i++) { rep = (await call(U.rica, 'GET', `/reports/${made.d.report.id}/data`)).d; if (rep.report.status !== 'pending') break; await new Promise((r) => setTimeout(r, 500)); }
ok('a "paid only" report has only paid rows', rep.report.status === 'ready' && rep.report.payment === 'paid' && rep.rows.length > 0 && rep.rows.every((r) => r.paid));
ok('it includes the short payment with its real amount', rep.rows.some((r) => r.refNo === a3.refNo && r.paidAmount === 700 && r.shortReason));
ok('it leaves out the unpaid receipt of the other person', !rep.rows.some((r) => r.refNo === m1.refNo));
const csv = await (await fetch(`${B}/reports/${made.d.report.id}/file`, { headers: H(U.rica, false) })).text();
ok('the CSV has the payment columns and the payment numbers', csv.includes('Amount paid (PHP)') && csv.includes(p1.d.payment.paymentNo));
const ex = await (await fetch(`${B}/receipts/export?format=csv&status=paid`, { headers: H(U.rica, false) })).text();
ok('the receipt export has the payment columns', ex.includes('Payment no.') && ex.includes(p1.d.payment.paymentNo));
```

- [ ] **Step 6: Run everything for this task**

Run: `pnpm exec vitest run apps/api/test` then `node e2e/payment-flow.mjs` then `node e2e/person-report.mjs`
Expected: unit tests pass; the flow prints `All checks passed`; the person-report script passes (its "approved" totals now include paid receipts, which is correct: if it compares to a count of `status=approved` receipts only, change it to count approved + paid and note this in the commit message).

Open one generated PDF and one XLSX by eye (the e2e report-shot script or the Reports page): columns fit, totals show "Paid" and "Not yet paid", no blank extra page.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/reports.ts apps/api/src/routes/reports.ts apps/api/src/routes/receipts.ts apps/api/test/pdf.test.ts e2e/payment-flow.mjs
git commit -m "Payment step: paid / not yet paid report filter, payment columns and totals in PDF, XLSX, CSV and receipt export" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin myBranch
```

---
## Task 9: Web foundations: Paid pill, types, menu, route, browser script

**Files:**
- Modify: `apps/web/src/ui.tsx` (`PILL`, icon `wallet`), `apps/web/src/styles.css` (`.s-paid`), `apps/web/src/types.ts`, `apps/web/src/api.ts` (`localToday`), `apps/web/src/App.tsx` (menu, route, title), `apps/web/src/pages/Audit.tsx` (`GROUPS`)
- Create: `apps/web/src/pages/ReadyToPay.tsx` (a first version that lists the queue; Task 10 adds selecting and paying)
- Create: `e2e/payment-ui.mjs`

**Interfaces:**
- Consumes: `GET /api/payments/queue`, `ReceiptDetail.payment` from the API.
- Produces:
  - `PaymentInfo` type and `ReceiptDetail.payment: PaymentInfo | null` in `apps/web/src/types.ts`.
  - `PaymentQueue` type: `{ groups: { payee: { id: number; name: string; branch: string | null }; count: number; total: number; receipts: ReceiptBrief[] }[]; totals: { count: number; total: number } }`.
  - `localToday(): string` in `apps/web/src/api.ts` (the date on the person's device, `YYYY-MM-DD`).
  - Route `/pay` (only with `payment.mark`), menu item "Ready to pay" (icon `wallet`); "Receipts" menu item also shown to `payment.mark` users.
  - `e2e/payment-ui.mjs` with an `// END OF CHECKS` marker that Tasks 10-12 add above.

- [ ] **Step 1: Write the browser script with the first checks**

Create `e2e/payment-ui.mjs`:

```js
// Drives the payment step in Chrome as Accounting and as a Med Ref, on a computer screen and a phone screen.
// Needs the API (4000) and the web app (5173) running, and the seed applied. Usage: node e2e/payment-ui.mjs [screenshot-dir]
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG, call, loginAll, makeApproved, pay } from './payment-helpers.mjs';

const OUT = process.argv[2] ?? path.join(os.tmpdir(), 'reimsys-pay-shots');
fs.mkdirSync(OUT, { recursive: true });
const proofFile = path.join(OUT, `proof-${Date.now()}.png`);
fs.writeFileSync(proofFile, Buffer.concat([PNG, Buffer.from(String(Date.now()))]));

const U = await loginAll();
const r1 = await makeApproved(U, 'ana', 'UI pay A', 500);
const r2 = await makeApproved(U, 'ana', 'UI pay B', 320.75);
const r3 = await makeApproved(U, 'mark', 'UI pay other person', 150);
const paidBefore = await makeApproved(U, 'ana', 'UI already paid', 90);
await pay(U.rica, [paidBefore]);

const browser = await chromium.launch({ channel: 'chrome' });
let failed = 0;
const ok = (name, cond) => { console.log(cond ? '  ok  ' : '  FAIL', name); if (!cond) failed++; };
const sessions = [];
async function open(email, size = { width: 1280, height: 820 }) {
  const ctx = await browser.newContext({ viewport: size, baseURL: process.env.WEB ?? 'http://localhost:5173', acceptDownloads: true });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/401|403|404|409/.test(m.text()) && page.errors.push(m.text()));
  await page.goto('/');
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', 'Reimsys#2026');
  await page.click('button[type=submit]');
  await page.waitForSelector('.shell');
  sessions.push({ email, page });
  return { ctx, page };
}
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true });
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const toastText = async (page) => (await page.locator('.toast').last().innerText().catch(() => ''));

console.log('Accounting, computer screen');
const acc = await open('accounting@example.com');
ok('the menu has "Ready to pay" and "Receipts"', (await acc.page.locator('.side .nav >> text=Ready to pay').count()) === 1 && (await acc.page.locator('.side .nav >> text=Receipts').count()) === 1);
await acc.page.click('.side .nav >> text=Ready to pay');
await acc.page.waitForSelector(`text=${r1.refNo}`);
ok('the queue shows the approved receipts grouped by person', await acc.page.locator('.card', { hasText: 'Ana Reyes' }).locator(`text=${r1.refNo}`).isVisible() && await acc.page.locator('.card', { hasText: 'Mark Dela Cruz' }).locator(`text=${r3.refNo}`).isVisible());
await shot(acc.page, 'pay-1-queue');
await acc.page.goto(`/receipts/${paidBefore.id}`);
await acc.page.waitForSelector('.pill.s-paid');
ok('a paid receipt shows the Paid pill', await acc.page.locator('.dh .pill.s-paid').isVisible());

// END OF CHECKS
for (const s of sessions) ok(`no errors on the page for ${s.email}`, s.page.errors.length === 0 || (console.log(s.page.errors), false));
await browser.close();
console.log(failed ? `\n${failed} check(s) failed. Screenshots in ${OUT}` : `\nAll checks passed. Screenshots in ${OUT}`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run to see it fail**

Run (API and web app running): `node e2e/payment-ui.mjs`
Expected: FAIL on the menu check (no "Ready to pay").

- [ ] **Step 3: Implement**

`apps/web/src/ui.tsx`: add to `PATHS`:
```ts
  wallet: 'M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a1 1 0 0 1-1-1V7zM4 7l11-3v3M16 13.5h.01',
```
and the pill map:
```ts
const PILL: Record<ReceiptStatus, string> = { draft: 's-draft', submitted: 's-sub', returned: 's-ret', checked: 's-chk', approved: 's-app', disapproved: 's-dis', reserved: 's-res', paid: 's-paid' };
```
`apps/web/src/styles.css`, right after the `.s-app…` line:
```css
.s-paid{background:var(--accent-soft);color:var(--accent)}
```
(`--accent-soft` exists in both the light and dark themes.)

`apps/web/src/types.ts`: add
```ts
export interface PaymentInfo {
  id: number; paymentNo: string; method: string; paidOn: string; amount: number; shortReason: string | null;
  recordedBy: string; recordedAt: string | null; proof: { mime: string; size: number };
}
export interface PaymentQueue {
  groups: { payee: { id: number; name: string; branch: string | null }; count: number; total: number; receipts: ReceiptBrief[] }[];
  totals: { count: number; total: number };
}
```
and in `ReceiptDetail` add `payment: PaymentInfo | null;` after `document`.

`apps/web/src/api.ts`, after `todayIso`:
```ts
/** Today on this device. Use it for dates people pick: in Manila the UTC date is still yesterday until 8am. */
export const localToday = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10); };
```

Create `apps/web/src/pages/ReadyToPay.tsx` (first version, read-only list):
```tsx
import { useQuery } from '@tanstack/react-query';
import { api, money } from '../api';
import type { PaymentQueue } from '../types';
import { Empty } from '../ui';
import { ReceiptRow } from './Receipts';

export function ReadyToPayPage() {
  const q = useQuery({ queryKey: ['payments-queue'], queryFn: () => api<PaymentQueue>('/payments/queue'), refetchInterval: 30_000 });
  const groups = q.data?.groups ?? [];
  return (
    <>
      <div className="ph">
        <div><h1>Ready to pay</h1><p>Approved receipts waiting for payment, by person. One payment covers one person's receipts.</p></div>
        {q.data && <div className="muted" style={{ textAlign: 'right' }}><b style={{ display: 'block', fontSize: '1.3rem', color: 'var(--ink)' }}>{money(q.data.totals.total)}</b>{q.data.totals.count} receipt{q.data.totals.count === 1 ? '' : 's'}</div>}
      </div>
      {!q.data && <div className="empty">Loading…</div>}
      {q.data && !groups.length && <Empty title="Nothing to pay">Every approved receipt has been paid.</Empty>}
      <div className="stack">
        {groups.map((g) => (
          <section key={g.payee.id} className="card">
            <div className="card-h"><h2>{g.payee.name}</h2><small>{g.payee.branch ? `${g.payee.branch} · ` : ''}{g.count} receipt{g.count === 1 ? '' : 's'} · {money(g.total)}</small></div>
            {g.receipts.map((r) => <ReceiptRow key={r.id} r={r} showEncoder={false} />)}
          </section>
        ))}
      </div>
    </>
  );
}
```

`apps/web/src/App.tsx`:
- lazy import: `const ReadyToPayPage = lazy(() => import('./pages/ReadyToPay').then((m) => ({ default: m.ReadyToPayPage })));`
- `titleFor`: add `'/pay': 'Ready to pay'` to the lookup object.
- menu items: change the Receipts `show` to `can('receipt.create') || can('receipt.view_all') || can('review.decide') || can('payment.mark')`, and add after it:
```tsx
    { to: '/pay', label: 'Ready to pay', icon: 'wallet', show: can('payment.mark') },
```
- route: `<Route path="/pay" element={can('payment.mark') ? <ReadyToPayPage /> : <Navigate to="/" replace />} />`

`apps/web/src/pages/Audit.tsx`: add `['payment.', 'Payments']` to `GROUPS` after the documents entry.

- [ ] **Step 4: Run to see it pass**

Run: `pnpm typecheck` (the only error left should be the `COPY` record in `ReceiptDetail.tsx`, fixed in Task 11), then `node e2e/payment-ui.mjs`
Expected: all checks pass. Look at `pay-1-queue.png`: groups are readable, no empty gaps.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/ui.tsx apps/web/src/styles.css apps/web/src/types.ts apps/web/src/api.ts apps/web/src/App.tsx apps/web/src/pages/Audit.tsx apps/web/src/pages/ReadyToPay.tsx e2e/payment-ui.mjs
git commit -m "Payment step: Paid pill, Ready to pay page and menu for Accounting, payments in the audit filter" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin myBranch
```

---

## Task 10: Selecting receipts and the "Mark as paid" dialog

**Files:**
- Create: `apps/web/src/components/PayDialog.tsx`
- Modify: `apps/web/src/pages/ReadyToPay.tsx`
- Test: `e2e/payment-ui.mjs`

**Interfaces:**
- Consumes: `paymentIssues`, `totalOf` (shared); `GET /api/payments/methods`, `POST /api/payments`; `localToday`.
- Produces: `PayDialog({ payee: string; lines: PayLine[]; onClose: () => void; onDone: () => void })` with `PayLine = { id: number; refNo: string; vendor: string; amount: number; version: number }`. Accessible names: `Paid on`, `Method`, `Proof of payment`, `Amount paid for <refNo>`, `Why less was paid for <refNo>`. Used again in Task 11.

- [ ] **Step 1: Add the failing checks**

Insert directly above `// END OF CHECKS` in `e2e/payment-ui.mjs`:

```js
console.log('Selecting and paying');
await acc.page.goto('/pay');
await acc.page.waitForSelector(`text=${r1.refNo}`);
await acc.page.getByLabel(`Select ${r1.refNo}`).check();
await acc.page.getByLabel(`Select ${r3.refNo}`).check();
ok('ticking another person starts a new selection', !(await acc.page.getByLabel(`Select ${r1.refNo}`).isChecked()) && (await acc.page.locator('.savebar').innerText()).includes('1 selected'));
await acc.page.getByLabel(`Select ${r1.refNo}`).check();
await acc.page.getByLabel(`Select ${r2.refNo}`).check();
ok('the bar shows how many and how much', /2 selected/.test(await acc.page.locator('.savebar').innerText()) && (await acc.page.locator('.savebar').innerText()).includes('820.75'));
await acc.page.click('.savebar >> text=Mark as paid');
const dlg = acc.page.locator('.modal');
await dlg.waitFor();
ok('the dialog lists both receipts with their amounts filled in', (await dlg.getByLabel(`Amount paid for ${r1.refNo}`).inputValue()) === '500' && (await dlg.getByLabel(`Amount paid for ${r2.refNo}`).inputValue()) === '320.75');
const payBtn = dlg.locator('button.ok', { hasText: 'Mark as paid' });
ok('it cannot be sent without a proof', await payBtn.isDisabled());
await dlg.getByLabel('Proof of payment').setInputFiles(proofFile);
await dlg.getByLabel(`Amount paid for ${r2.refNo}`).fill('300');
ok('paying less asks for a reason', await dlg.getByLabel(`Why less was paid for ${r2.refNo}`).isVisible() && await payBtn.isDisabled());
await dlg.getByLabel(`Why less was paid for ${r2.refNo}`).fill('Parking fee not covered');
ok('the total updates', (await dlg.innerText()).includes('800.00'));
await shot(acc.page, 'pay-2-dialog');
await payBtn.click();
await acc.page.waitForSelector('.toast');
ok('it confirms with the payment number', /PAY-\d{4}-\d{6}/.test(await toastText(acc.page)));
await acc.page.waitForSelector(`text=${r1.refNo}`, { state: 'detached' });
ok('the paid receipts leave the queue, the other person stays', (await acc.page.locator(`text=${r2.refNo}`).count()) === 0 && (await acc.page.locator(`text=${r3.refNo}`).count()) === 1);
```

- [ ] **Step 2: Run to see it fail**

Run: `node e2e/payment-ui.mjs`
Expected: FAIL at "Select …" (no checkboxes yet).

- [ ] **Step 3: Implement the dialog**

Create `apps/web/src/components/PayDialog.tsx`:
```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { paymentIssues, totalOf } from '@reimsys/shared';
import { api, errMsg, localToday, money } from '../api';
import { Field, Modal, useToast } from '../ui';

export interface PayLine { id: number; refNo: string; vendor: string; amount: number; version: number }

/** Records one payment for one person's receipts: the date, how it was paid, the proof, and what was paid on each receipt. */
export function PayDialog({ payee, lines, onClose, onDone }: { payee: string; lines: PayLine[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const methods = useQuery({ queryKey: ['payment-methods'], queryFn: () => api<{ methods: string[] }>('/payments/methods') });
  const [method, setMethod] = useState('');
  const [paidOn, setPaidOn] = useState(localToday());
  const [file, setFile] = useState<File | null>(null);
  const [amounts, setAmounts] = useState<Record<number, string>>(() => Object.fromEntries(lines.map((l) => [l.id, String(l.amount)])));
  const [reasons, setReasons] = useState<Record<number, string>>({});

  const chosen = method || methods.data?.methods[0] || '';
  const parsed = lines.map((l) => ({ receiptId: l.id, version: l.version, amount: Math.round(Number(amounts[l.id]) * 100) / 100, shortReason: (reasons[l.id] ?? '').trim() || null }));
  const badAmount = (id: number) => { const n = parsed.find((p) => p.receiptId === id)!.amount; return !Number.isFinite(n) || n <= 0; };
  const issues = paymentIssues({ paidOn, lines: parsed.filter((p) => !badAmount(p.receiptId)) }, new Map(lines.map((l) => [l.id, l.amount])));
  const issueFor = (id: number) => issues.find((i) => i.receiptId === id && i.code !== 'SHORT_REASON');
  const total = totalOf(parsed.filter((p) => !badAmount(p.receiptId)));
  const ready = !!file && !!chosen && !!paidOn && !issues.length && lines.every((l) => !badAmount(l.id));

  const save = useMutation({
    mutationFn: () => {
      const f = new FormData();
      f.append('method', chosen);
      f.append('paidOn', paidOn);
      f.append('lines', JSON.stringify(parsed));
      f.append('proof', file!);
      return api<{ payment: { paymentNo: string } }>('/payments', { method: 'POST', form: f });
    },
    onSuccess: (d) => {
      toast(`Marked as paid. Payment ${d.payment.paymentNo}.`);
      for (const k of ['payments-queue', 'receipts', 'receipt', 'dashboard', 'history']) qc.invalidateQueries({ queryKey: [k] });
      onDone();
    },
    onError: (e) => { toast(errMsg(e), 'bad'); qc.invalidateQueries({ queryKey: ['payments-queue'] }); },
  });

  return (
    <Modal title={`Mark as paid: ${payee}`} onClose={onClose}>
      <div className="form">
        <Field label="Paid on"><input type="date" value={paidOn} max={localToday()} onChange={(e) => setPaidOn(e.target.value)} /></Field>
        <Field label="Method">
          <select value={chosen} onChange={(e) => setMethod(e.target.value)}>{methods.data?.methods.map((m) => <option key={m}>{m}</option>)}</select>
        </Field>
        <Field label="Proof of payment" hint="Photo or PDF of the transfer, cheque or signed voucher" className="full">
          <input type="file" aria-label="Proof of payment" accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
      </div>
      <div style={{ display: 'grid', gap: 10, margin: '14px 0' }}>
        {lines.map((l) => {
          const p = parsed.find((x) => x.receiptId === l.id)!;
          const short = !badAmount(l.id) && Math.round(p.amount * 100) < Math.round(l.amount * 100);
          const problem = badAmount(l.id) ? 'Enter an amount greater than zero.' : issueFor(l.id)?.message;
          return (
            <div key={l.id} className="callout" style={{ margin: 0, display: 'block' }}>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
                <span><b>{l.vendor}</b><small className="muted" style={{ display: 'block' }}>{l.refNo} · receipt {money(l.amount)}</small></span>
                <input style={{ width: 130, textAlign: 'right' }} inputMode="decimal" aria-label={`Amount paid for ${l.refNo}`} value={amounts[l.id]} onChange={(e) => setAmounts((s) => ({ ...s, [l.id]: e.target.value }))} />
              </div>
              {problem && <span className="err" style={{ display: 'block' }}>{problem}</span>}
              {short && <input style={{ marginTop: 8, width: '100%' }} aria-label={`Why less was paid for ${l.refNo}`} placeholder="Why less than the full amount was paid (required)" maxLength={300} value={reasons[l.id] ?? ''} onChange={(e) => setReasons((s) => ({ ...s, [l.id]: e.target.value }))} />}
            </div>
          );
        })}
      </div>
      {issues.some((i) => i.code === 'DATE_FUTURE') && <p className="err">The payment date cannot be in the future.</p>}
      <p><b>Total {money(total)}</b> · {lines.length} receipt{lines.length === 1 ? '' : 's'}. {payee.split(' ')[0]} will get one email.</p>
      <div className="btns">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn ok" disabled={!ready || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Mark as paid'}</button>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 4: Add selecting and the bar to the page**

Replace `apps/web/src/pages/ReadyToPay.tsx` with:
```tsx
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { totalOf } from '@reimsys/shared';
import { api, money } from '../api';
import { PayDialog } from '../components/PayDialog';
import type { PaymentQueue } from '../types';
import { Empty } from '../ui';
import { ReceiptRow } from './Receipts';

export function ReadyToPayPage() {
  const q = useQuery({ queryKey: ['payments-queue'], queryFn: () => api<PaymentQueue>('/payments/queue'), refetchInterval: 30_000 });
  // One payment is for one person, so a selection always belongs to one group. Ticking someone else starts a new selection.
  const [picked, setPicked] = useState<{ payeeId: number; ids: number[] } | null>(null);
  const [paying, setPaying] = useState(false);
  const groups = q.data?.groups ?? [];
  const group = picked ? groups.find((g) => g.payee.id === picked.payeeId) : undefined;
  const chosen = group ? group.receipts.filter((r) => picked!.ids.includes(r.id)) : [];

  const toggle = (payeeId: number, id: number) => setPicked((s) => {
    if (!s || s.payeeId !== payeeId) return { payeeId, ids: [id] };
    const ids = s.ids.includes(id) ? s.ids.filter((x) => x !== id) : [...s.ids, id];
    return ids.length ? { payeeId, ids } : null;
  });
  const selectAll = (payeeId: number, ids: number[]) => setPicked({ payeeId, ids: ids.slice(0, 25) });

  return (
    <>
      <div className="ph">
        <div><h1>Ready to pay</h1><p>Approved receipts waiting for payment, by person. One payment covers one person's receipts.</p></div>
        {q.data && <div className="muted" style={{ textAlign: 'right' }}><b style={{ display: 'block', fontSize: '1.3rem', color: 'var(--ink)' }}>{money(q.data.totals.total)}</b>{q.data.totals.count} receipt{q.data.totals.count === 1 ? '' : 's'}</div>}
      </div>
      {!q.data && <div className="empty">Loading…</div>}
      {q.data && !groups.length && <Empty title="Nothing to pay">Every approved receipt has been paid.</Empty>}
      <div className="stack">
        {groups.map((g) => (
          <section key={g.payee.id} className="card">
            <div className="card-h">
              <h2>{g.payee.name}</h2>
              <small>{g.payee.branch ? `${g.payee.branch} · ` : ''}{g.count} receipt{g.count === 1 ? '' : 's'} · {money(g.total)}</small>
              {g.count > 1 && <button className="btn sm ghost" onClick={() => selectAll(g.payee.id, g.receipts.map((r) => r.id))}>Select all</button>}
            </div>
            {g.receipts.map((r) => <ReceiptRow key={r.id} r={r} showEncoder={false} pick={{ on: picked?.payeeId === g.payee.id && picked.ids.includes(r.id), toggle: () => toggle(g.payee.id, r.id) }} />)}
          </section>
        ))}
      </div>
      {group && chosen.length > 0 && (
        <div className="savebar" role="region" aria-label="Selected receipts">
          <span>{chosen.length} selected · {group.payee.name} · {money(totalOf(chosen))}</span>
          <span style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => setPicked(null)}>Clear</button>
            <button className="btn ok" onClick={() => setPaying(true)}>Mark as paid</button>
          </span>
        </div>
      )}
      {paying && group && (
        <PayDialog
          payee={group.payee.name}
          lines={chosen.map((r) => ({ id: r.id, refNo: r.refNo, vendor: r.payee, amount: r.amount, version: r.version }))}
          onClose={() => setPaying(false)}
          onDone={() => { setPaying(false); setPicked(null); }}
        />
      )}
    </>
  );
}
```
(If the queue refreshes while a dialog is open and a selected receipt disappeared, `chosen` shrinks; the server's version check is the real guard.)

- [ ] **Step 5: Run to see it pass**

Run: `pnpm --filter @reimsys/web typecheck` (only the `COPY` error may remain) and `node e2e/payment-ui.mjs`
Expected: all checks pass. Look at `pay-2-dialog.png`: the dialog fits the screen, the reason box sits under its receipt.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/PayDialog.tsx apps/web/src/pages/ReadyToPay.tsx e2e/payment-ui.mjs
git commit -m "Payment step: select one person's receipts and mark them paid with date, method, proof and amounts" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin myBranch
```

---

## Task 11: Receipt page: payment card, pay from the receipt, reverse a payment

**Files:**
- Modify: `apps/web/src/pages/ReceiptDetail.tsx`
- Test: `e2e/payment-ui.mjs`

**Interfaces:**
- Consumes: `ReceiptDetail.payment`, actions `pay` / `reverse_payment`, `PayDialog`, `GET /api/payments/:id/proof`.
- Produces: a "Payment" card (`section.card` with heading "Payment") showing number, date, method, amount paid, shortfall reason, who recorded it, and "View proof", "Download", "Print" buttons.

- [ ] **Step 1: Add the failing checks**

Insert directly above `// END OF CHECKS` in `e2e/payment-ui.mjs`:

```js
console.log('The receipt page');
await acc.page.goto(`/receipts/${r2.id}`);
const card = acc.page.locator('section.card', { has: acc.page.locator('h3', { hasText: 'Payment' }) });
await card.waitFor();
const cardText = await card.innerText();
ok('the payment card shows the number, method, amount and reason', /PAY-\d{4}-\d{6}/.test(cardText) && cardText.includes('Bank transfer') && cardText.includes('300.00') && cardText.includes('Parking fee not covered'));
const proofTab = acc.page.waitForEvent('popup');
await card.locator('text=View proof').click();
const proofPage = await proofTab;
ok('"View proof" opens the proof', (await proofPage.waitForLoadState().then(() => proofPage.url())).includes('/proof?mode=view'));
await proofPage.close();
await acc.page.click('.actionbar >> text=Reverse payment');
const rm = acc.page.locator('.modal');
ok('reversing needs a reason', await rm.locator('button', { hasText: 'Reverse payment' }).isDisabled());
await rm.locator('textarea').fill('Wrong amount, paying again');
await rm.locator('button', { hasText: 'Reverse payment' }).click();
await acc.page.waitForSelector('.dh .pill.s-app');
ok('the receipt is Approved again and the payment card is gone', (await card.count()) === 0);
await acc.page.click('.actionbar >> text=Mark as paid');
const one = acc.page.locator('.modal');
await one.getByLabel('Proof of payment').setInputFiles(proofFile);
await one.locator('button.ok', { hasText: 'Mark as paid' }).click();
await acc.page.waitForSelector('.dh .pill.s-paid');
ok('it can be paid again from the receipt page', await card.isVisible());
await shot(acc.page, 'pay-3-receipt');

console.log('Med Ref');
const ana = await open('ana.reyes@example.com');
await ana.page.goto(`/receipts/${r1.id}`);
await ana.page.waitForSelector('.dh .pill.s-paid');
const anaCard = ana.page.locator('section.card', { has: ana.page.locator('h3', { hasText: 'Payment' }) });
ok('the Med Ref sees the payment and the proof buttons', /PAY-/.test(await anaCard.innerText()) && await anaCard.locator('text=Download').isVisible());
ok('the Med Ref has no payment buttons', (await ana.page.locator('.actionbar >> text=Reverse payment').count()) === 0 && (await ana.page.locator('.actionbar >> text=Mark as paid').count()) === 0);
await ana.page.goto('/receipts');
ok('the receipts list has a Paid filter', await ana.page.locator('.chip', { hasText: 'Paid' }).isVisible());
```

- [ ] **Step 2: Run to see it fail**

Run: `node e2e/payment-ui.mjs`
Expected: FAIL at the payment card (it does not exist yet). The web typecheck also still fails on `COPY`.

- [ ] **Step 3: Implement**

In `apps/web/src/pages/ReceiptDetail.tsx`:

Imports: add `import { PayDialog } from '../components/PayDialog';` and change `const { me } = useAuth();` to `const { me, can } = useAuth();`.

Add two entries to `COPY`:
```ts
  pay: { label: 'Mark as paid', icon: 'wallet', cls: 'ok', title: '', desc: '', field: '', ok: '' },
  reverse_payment: { label: 'Reverse payment', icon: 'undo', cls: 'bad', title: 'Reverse this payment', desc: 'The receipt goes back to Approved and the Med Ref is told to disregard the payment notice. The payment and its proof stay in the history.', field: 'Why is the payment being reversed', ok: 'Payment reversed. The receipt is Approved again.' },
```
`ORDER`: put `'reverse_payment'` first and `'pay'` last:
```ts
const ORDER: ReceiptAction[] = ['reverse_payment', 'undo', 'request', 'withdraw', 'return', 'disapprove', 'reserve', 'check', 'approve', 'release', 'submit', 'pay'];
```
State: `const [payOpen, setPayOpen] = useState(false);`

In the action buttons, change the `click` line to:
```tsx
            const click = () => (a.action === 'submit' ? act.mutate({ action: 'submit' }) : a.action === 'pay' ? setPayOpen(true) : setModal(a.action));
```
Where the document card is shown, and in the two "worth a closer look" / "possible duplicate" conditions, treat paid like approved: replace `r.status === 'approved' && r.document` with `(r.status === 'approved' || r.status === 'paid') && r.document`, and `r.status !== 'approved' && r.status !== 'disapproved'` (twice) with `!['approved', 'disapproved', 'paid'].includes(r.status)`. Inside the document card keep `<StatusPill status="approved" />`.

Add the payment card as the first child of the left `.stack` (above the document card):
```tsx
          {r.payment && (
            <section className="card">
              <div className="card-h"><h3>Payment</h3><StatusPill status="paid" /></div>
              <div className="card-b">
                <dl className="dl">
                  <dt>Payment no.</dt><dd>{r.payment.paymentNo}</dd>
                  <dt>Paid on</dt><dd>{fmtDate(r.payment.paidOn)}</dd>
                  <dt>Method</dt><dd>{r.payment.method}</dd>
                  <dt>Amount paid</dt><dd>{money(r.payment.amount)}{r.payment.amount < r.amount && <small className="muted"> of {money(r.amount)}</small>}</dd>
                  {r.payment.shortReason && <><dt>Why less was paid</dt><dd>{r.payment.shortReason}</dd></>}
                  <dt>Recorded by</dt><dd>{r.payment.recordedBy}{r.payment.recordedAt ? ` · ${fmtDateTime(r.payment.recordedAt)}` : ''}</dd>
                </dl>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                  {can('evidence.view') && <a className="btn sm" href={`/api/payments/${r.payment.id}/proof?mode=view`} target="_blank" rel="noopener"><Icon name="eye" size={16} />View proof</a>}
                  {can('evidence.download') && <a className="btn sm" href={`/api/payments/${r.payment.id}/proof?mode=download`}><Icon name="download" size={16} />Download</a>}
                  {can('evidence.print') && <button className="btn sm" onClick={() => printUrl(`/api/payments/${r.payment!.id}/proof?mode=print`)}><Icon name="print" size={16} />Print</button>}
                </div>
                <small className="muted" style={{ display: 'block', marginTop: 8 }}>Opening the proof is recorded in the audit log.</small>
              </div>
            </section>
          )}
```
After the `NoteModal` line at the end of the page add:
```tsx
      {payOpen && <PayDialog payee={r.encoder.name} lines={[{ id: r.id, refNo: r.refNo, vendor: r.payee, amount: r.amount, version: r.version }]} onClose={() => setPayOpen(false)} onDone={() => { setPayOpen(false); refresh(); }} />}
```
The reversal uses the existing `NoteModal` (note required, button text from `COPY.reverse_payment.label`), so nothing else is needed for it.

- [ ] **Step 4: Run to see it pass**

Run: `pnpm typecheck` (clean now) and `node e2e/payment-ui.mjs`
Expected: all checks pass. Look at `pay-3-receipt.png`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/ReceiptDetail.tsx e2e/payment-ui.mjs
git commit -m "Payment step: payment card with proof on the receipt, pay and reverse from the receipt page" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin myBranch
```

---

## Task 12: Dashboards, reports screens, settings list, phone layout

**Files:**
- Modify: `apps/web/src/pages/Dashboard.tsx`, `apps/web/src/pages/Reports.tsx`, `apps/web/src/pages/ReportView.tsx`, `apps/web/src/pages/AppSettings.tsx`
- Create: `apps/web/src/components/PaymentMethods.tsx`
- Test: `e2e/payment-ui.mjs`

**Interfaces:**
- Consumes: dashboard `counts.paid`, `sums.paid`, `paidThisMonth`; report preview `paid`/`unpaid`; report data `report.payment`, row fields `paid`, `paidAmount`, `paidOn`, `method`; `GET/PUT /api/payments/methods`.
- Produces: Accounting dashboard tiles ("To pay", "Waiting to be paid", "Paid this month", "Paid"); Approver tiles show "Approved, not paid" and "Paid"; report "Payment" selector (accessible name "Payment"); report view "Paid" column and totals; Settings "Payment methods" card.

- [ ] **Step 1: Add the failing checks**

Insert directly above `// END OF CHECKS`:

```js
console.log('Dashboards, reports, settings');
await acc.page.goto('/');
const tiles = await acc.page.locator('.tiles').innerText();
ok('the accounting dashboard shows what is left to pay and what was paid this month', tiles.includes('To pay') && tiles.includes('Paid this month'));
ok('its queue is "Ready to pay"', await acc.page.locator('h2', { hasText: 'Ready to pay' }).isVisible());
const appr = await open('paolo.v@example.com');
const apTiles = await appr.page.locator('.tiles').innerText();
ok('the approver sees approved-not-paid and paid', apTiles.includes('Approved, not paid') && apTiles.includes('Paid'));
await acc.page.goto('/reports');
await acc.page.getByLabel('Payment').selectOption('paid');
await acc.page.waitForSelector('text=/paid record/');
ok('the report preview counts paid records', /\d+ paid record/.test(await acc.page.locator('.callout').innerText()));
await acc.page.click('button:has-text("Generate")');
await acc.page.waitForURL(/\/reports\/\d+/);
await acc.page.waitForSelector('th:has-text("Paid")');
const view = await acc.page.locator('.tiles').innerText();
ok('the report view shows paid and not yet paid totals', view.includes('Paid') && view.includes('Not yet paid'));
const admin = await open('admin@example.com');
await admin.page.goto('/access');
await admin.page.click('[role=tab] >> text=Settings');
await admin.page.waitForSelector('h2:has-text("Payment methods")');
ok('the Super Admin can edit the payment methods', await admin.page.locator('h2', { hasText: 'Payment methods' }).isVisible() && await admin.page.locator('input[value="Bank transfer"]').isVisible());

console.log('Phone screen');
const phone = await open('accounting@example.com', { width: 390, height: 800 });
await phone.page.goto('/pay');
await phone.page.waitForSelector(`text=${r3.refNo}`);
await phone.page.getByLabel(`Select ${r3.refNo}`).check();
const bar = await phone.page.locator('.savebar').boundingBox();
ok('on a phone the "Mark as paid" bar sits at the bottom, above the menu', !!bar && bar.y > 500);
ok('on a phone nothing scrolls sideways', await noSideScroll(phone.page));
await shot(phone.page, 'pay-4-phone');
await phone.page.click('.savebar >> text=Mark as paid');
ok('on a phone the dialog fits the width', await noSideScroll(phone.page));
await shot(phone.page, 'pay-5-phone-dialog');
```
(The settings screen is the "Settings" tab of the Access page, `AppSettingsTab` in `AppSettings.tsx`.)

- [ ] **Step 2: Run to see it fail**

Run: `node e2e/payment-ui.mjs`
Expected: FAIL at the dashboard tiles.

- [ ] **Step 3: Dashboard**

In `apps/web/src/pages/Dashboard.tsx`:
- the `Dash` interface gains `paidThisMonth: { count: number; total: number };`
- `BLURB` gains `pay: 'Record payments for approved reimbursements.',`
- `kind` becomes:
```ts
  const kind = can('review.check') ? 'check' : can('review.decide') ? 'decide' : can('receipt.create') ? 'receipt' : can('payment.mark') ? 'pay' : 'admin';
```
- the tiles for `decide` become:
```ts
    ] : kind === 'decide' ? [
      { label: 'To decide', value: n('checked'), to: '/receipts', alert: true },
      { label: 'On hold', value: n('reserved'), to: '/receipts' },
      { label: 'Approved, not paid', value: money(d.data?.sums.approved ?? 0), to: '/receipts' },
      { label: 'Paid', value: money(d.data?.sums.paid ?? 0), to: '/receipts' },
```
- add a branch for `pay` before the final admin tiles:
```ts
    ] : kind === 'pay' ? [
      { label: 'To pay', value: n('approved'), to: '/pay', alert: true },
      { label: 'Waiting to be paid', value: money(d.data?.sums.approved ?? 0), to: '/pay' },
      { label: 'Paid this month', value: money(d.data?.paidThisMonth.total ?? 0), to: '/receipts' },
      { label: 'Paid', value: n('paid'), to: '/receipts' },
```
- in the queue card, `showEncoder={kind !== 'receipt'}` already shows the person's name, which Accounting needs. Change the "View all" link target to `kind === 'pay' ? '/pay' : '/receipts'`.

- [ ] **Step 4: Reports screens**

`apps/web/src/pages/Reports.tsx`:
- state `const [payment, setPayment] = useState<'all' | 'paid' | 'unpaid'>('all');`
- add `...(payment !== 'all' ? { payment } : {})` to the `qs` object and `payment` to the POST body;
- the preview type becomes `{ count: number; total: number; paid: number; unpaid: number }`;
- add the field after "Product or service" (import `PAYMENT_FILTERS, PAYMENT_FILTER_LABEL` from `@reimsys/shared`):
```tsx
              <Field label="Payment"><select aria-label="Payment" value={payment} onChange={(e) => setPayment(e.target.value as typeof payment)}>{PAYMENT_FILTERS.map((k) => <option key={k} value={k}>{PAYMENT_FILTER_LABEL[k]}</option>)}</select></Field>
```
- the preview callout text becomes:
```tsx
<><b>{preview.data.count} {payment === 'paid' ? 'paid' : payment === 'unpaid' ? 'not yet paid' : 'approved'} record{preview.data.count === 1 ? '' : 's'} match</b><span>Total {money(preview.data.total)} · paid {money(preview.data.paid)} · not yet paid {money(preview.data.unpaid)}</span></>
```
- the page description becomes "Approved records only, paid or not yet paid. Pending, returned and disapproved records are never included."

`apps/web/src/pages/ReportView.tsx`:
- import `PAYMENT_FILTER_LABEL` from `@reimsys/shared`.
- `Data.report` gains `payment: 'all' | 'paid' | 'unpaid'`; each row gains `paid: boolean; paidAmount: number; paidOn: string; method: string`; `totals` gains `paid: number; unpaid: number`.
- tiles become: "Approved total" (`total`), "Paid" (`money(totals.paid)`), "Not yet paid" (`money(totals.unpaid)`), "Records" (`rows.length`). Drop "Average".
- the title line adds `{r.payment !== 'all' ? ` · ${PAYMENT_FILTER_LABEL[r.payment]}` : ''}` after the category.
- the table gains a "Paid" column right before the amount column: header `<th style={{ textAlign: 'right' }}>Paid</th>`; cell
```tsx
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{x.paid ? <>{money(x.paidAmount)}<br /><small className="muted">{fmtDate(x.paidOn)} · {x.method}</small></> : <span className="muted">Not yet</span>}</td>
```
  a matching footer cell `{money(totals.paid)}`, and the empty-row `colSpan` goes from 8 to 9. The closing note becomes "Only approved records appear in a liquidation report, paid or not yet paid."

- [ ] **Step 5: Payment methods card**

Create `apps/web/src/components/PaymentMethods.tsx`:
```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { paymentMethodsSchema } from '@reimsys/shared';
import { api, errMsg } from '../api';
import { Icon, useToast } from '../ui';

/** The list Accounting picks from when marking a receipt paid. */
export function PaymentMethodsCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['payment-methods'], queryFn: () => api<{ methods: string[] }>('/payments/methods') });
  const [draft, setDraft] = useState<string[]>([]);
  useEffect(() => { if (q.data) setDraft(q.data.methods); }, [q.data]);
  const parsed = paymentMethodsSchema.safeParse({ methods: draft });
  const dirty = JSON.stringify(draft) !== JSON.stringify(q.data?.methods ?? []);
  const save = useMutation({
    mutationFn: () => api<{ methods: string[] }>('/payments/methods', { method: 'PUT', body: { methods: draft } }),
    onSuccess: (d) => { qc.setQueryData(['payment-methods'], d); toast('Payment methods saved.'); },
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  return (
    <section className="card">
      <div className="card-h"><h2>Payment methods</h2><small>What Accounting can choose when marking a receipt paid</small></div>
      <div className="card-b" style={{ display: 'grid', gap: 8 }}>
        {draft.map((m, i) => (
          <div key={i} style={{ display: 'flex', gap: 8 }}>
            <input value={m} maxLength={40} aria-label={`Payment method ${i + 1}`} onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? e.target.value : x)))} />
            <button className="btn sm" type="button" aria-label={`Remove ${m || 'this method'}`} disabled={draft.length <= 1} onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}><Icon name="x" size={16} /></button>
          </div>
        ))}
        {!parsed.success && <span className="err">{parsed.error.issues[0]?.message}</span>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <button className="btn sm" type="button" disabled={draft.length >= 12} onClick={() => setDraft((d) => [...d, ''])}><Icon name="plus" size={16} />Add a method</button>
          <button className="btn pri sm" type="button" disabled={!dirty || !parsed.success || save.isPending} onClick={() => save.mutate()}>Save methods</button>
        </div>
      </div>
    </section>
  );
}
```
In `apps/web/src/pages/AppSettings.tsx` (the `AppSettingsTab` component shown on the Access page's Settings tab) import it and render `<PaymentMethodsCard />` right after the settings sections (before the `formbar` div). It saves on its own, separate from "Save settings".

- [ ] **Step 6: Phone layout**

Run the script once; if the phone checks fail, fix the CSS in `apps/web/src/styles.css` inside the existing `@media` block that shows `.bnav` (around line 230): the `.savebar` must sit above the bottom menu, e.g.
```css
  .savebar{bottom:calc(env(safe-area-inset-bottom,0px) + 70px)}
```
(only if the receipts-list bar has the same problem today; if that bar already sits above the menu, the payment bar uses the same class and needs nothing.) Any card header with the "Select all" button must wrap rather than push the page wider: add `flex-wrap:wrap` to `.card-h` only if `noSideScroll` fails.

- [ ] **Step 7: Run to see it pass**

Run: `pnpm typecheck` and `node e2e/payment-ui.mjs`
Expected: all checks pass. Look at `pay-4-phone.png` and `pay-5-phone-dialog.png`: no cut-off text, the bar does not cover the last receipt, the dialog scrolls inside itself.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/Dashboard.tsx apps/web/src/pages/Reports.tsx apps/web/src/pages/ReportView.tsx apps/web/src/pages/AppSettings.tsx apps/web/src/components/PaymentMethods.tsx apps/web/src/styles.css e2e/payment-ui.mjs
git commit -m "Payment step: Accounting and approver dashboards, paid filter and columns on reports, editable payment methods, phone layout" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin myBranch
```

---

## Task 13: Documents, full regression, and handover

**Files:**
- Modify: `docs/PLAN.md`, `docs/EMAIL.md`, `docs/DEPLOY.md`
- Modify (only if a check needs a new expected value): existing `e2e/*.mjs` scripts

**Interfaces:**
- Consumes: everything above.
- Produces: up-to-date documents and a green run of every suite.

- [ ] **Step 1: Update the documents**

`docs/PLAN.md`: in the roles section add Accounting (rank 25, `payment.mark` locked, sees Approved and Paid only, cannot pay own receipts, Super Admin does not pay by default); in the status flow add `Approved → Paid` and `Paid → Approved (reverse, reason required)` and the rule that `undo` needs the payment reversed first; in the data section add the `payment` table and the four receipt fields; in the screens section add "Ready to pay", the payment dialog, the payment card, the report Payment filter and the Settings payment methods list.

`docs/EMAIL.md`: add the two emails to the list of templates: "Reimbursement paid" (`paid`, one per payment, to the Med Ref, lists every receipt and amount) and "Payment reversed" (`payment_reversed`), with their placeholders (`paymentNo`, `method`, `paidOn`, `receiptList`). State that Accounting gets no email on approvals, only an in-app notice.

`docs/DEPLOY.md`: add an "Upgrading to the payment step" section with the rollout from the spec:
1. Back up the database and the storage folder; tag the version (`before-payment-step`).
2. `pnpm db:deploy` (applies `20261015030000_payment_step`), then `pnpm db:seed` (adds the Accounting role, its grants and the payment permission; edits made on the Access page are kept).
3. Run the new line of `docs/db-grants.sql` for the `payment` table as a MySQL administrator.
4. Create the real Accounting user on the Access page; check the payment methods under Settings.
5. To go back: `docs/rollback-payment-step.sql`, or restore the backup.

- [ ] **Step 2: Full regression**

With the API and web app running:
```bash
pnpm typecheck
pnpm test
node e2e/payment-flow.mjs
node e2e/payment-ui.mjs
node e2e/api-flow.mjs
node e2e/ui-flow.mjs
node e2e/security.mjs
node e2e/person-report.mjs
node e2e/client-form.mjs
node e2e/client-form-ui.mjs
node e2e/email-templates.mjs
node e2e/gaps-ui.mjs
node e2e/features-ui.mjs
node e2e/realtime-api.mjs
node e2e/explore.mjs
pnpm build
```
Expected: every command ends without a failure. If an older script fails because it expected the old world (for example a fixed number of roles or permissions, a status list without "Paid", the decider tiles "Approved"/"Disapproved", or report text "Approved records only"), update that expectation to the new behaviour and write which check changed and why in the commit message. If a script fails for any other reason, that is a bug in this feature: fix the code, not the test.

`node e2e/email-templates.mjs` and `e2e/email-settings.mjs` change saved settings and restore them; if either stops half-way, run `node e2e/restore-settings.mjs` before anything else.

- [ ] **Step 3: Send the two new emails to the test mailbox only**

```bash
node e2e/smtp-catcher.mjs &
```
In the app (Access → Email templates), preview "Reimbursement paid" and "Payment reversed": the sample shows two receipts with amounts, the total, the method and date; nothing reads `{{`. Then use "Send test" for each **to the local catcher address only**, never to a real inbox, and check both arrived in the catcher output with the logo and the plain-text part. Stop the catcher afterwards.

- [ ] **Step 4: Commit and push**

```bash
git add docs/PLAN.md docs/EMAIL.md docs/DEPLOY.md e2e
git commit -m "Payment step: documents and rollout notes; regression suites updated for the Paid status" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin myBranch
```

---

## Spec coverage

| Spec section | Where |
|---|---|
| 2 Decisions: Accounting pays, nobody pays own, one or many of one person, amount per receipt, short with reason, date/method/proof, reversal, report filter, Paid status + payment record, names | Tasks 1, 2, 3, 6, 7, 8, 10, 11 |
| 2 Assumptions: proof for every method, no overpayment, per-receipt reversal, method list editable, rank 25 | Tasks 1, 2, 4, 6, 7, 12 |
| 3 Status flow, `undo` only from Approved, Paid final | Task 1 (rules), Task 6 (undo blocked, edit blocked), Task 7 |
| 4 Role, locked permission, default grants, visibility, Super Admin without `payment.mark` | Tasks 1, 3, 4 |
| 5 Data, payment numbers, methods setting, migration, grants, rollback | Tasks 3, 4 |
| 6 API: queue, create, reverse, proof, detail block, report filter | Tasks 4, 6, 7, 8 |
| 7 Screens: dashboard, Ready to pay, dialog, receipt card, list chip, approver dashboard, reports, settings, phone | Tasks 9, 10, 11, 12 |
| 8 Notifications and editable emails | Tasks 5, 6, 7, 13 |
| 9 Audit and security | Tasks 6, 7, 9 (audit filter) |
| 10 Impact on existing code | Tasks 1, 7, 8, 13 (regression) |
| 11 Testing | every task; Task 13 runs all suites |
| 12 Rollout | Task 3 (backup, tag, rollback check), Task 13 (DEPLOY.md) |
| 13 Out of scope | not built |
