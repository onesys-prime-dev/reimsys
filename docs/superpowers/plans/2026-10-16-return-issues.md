# Return Reasons with Quick Picks and Fix Shortcuts: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a Checker returns a receipt (or an Approver asks for more proof), they tick the problems from a short list instead of typing; the Med Ref sees each problem with a **Fix** button that opens the receipt form on the right step.

**Architecture:** One shared list of problems (code, plain-words label, form step to fix it) lives in `packages/shared`. The API accepts the ticked codes next to the optional note, stores them in one new nullable column on `receipt`, and returns them with the receipt. The Return dialog shows the list as tappable chips; the "Returned for correction" box shows each problem with a Fix link to `/receipts/:id/edit?step=<step>`, and the form jumps to that step.

**Tech Stack:** TypeScript monorepo (pnpm): zod + shared rules (`packages/shared`), Express 5 + Prisma 6 + MySQL (`apps/api`), React 18 + react-router 6 (`apps/web`), vitest, plain Node e2e scripts and Playwright (installed Chrome).

**Spec:** this document's "Design" section (a bounded change to an existing flow, so no separate spec file). Related existing behaviour: `docs/PLAN.md` (status rules), `packages/shared/src/receipts.ts` (`TRANSITIONS`, `actionBodySchema`).

## Is it good to have? (an honest view)

**Yes, for this system, with limits.** Returning a receipt and fixing it is the busiest loop in the whole workflow, and many Med Refs and Checkers use phones, where typing is slow and tapping is quick.

What it gives you
- **Faster for the Checker:** one or two taps instead of typing a sentence on a phone.
- **Clearer for the Med Ref:** they see exactly which problem, in the same words every time, and one tap takes them to the right step. Fewer back-and-forth returns for "what do you mean?".
- **Consistent data:** because the problems are saved as codes, you can later count the most common mistakes (for example "blurry photos are 40% of returns") and train people on them.

What to watch out for
- **A fixed list never covers everything.** So "Something else" stays, and the note box always stays. A tick alone can be vague ("Amount wrong": which amount?), so the box says "Add details (optional)".
- **Fix opens a step, not a field.** It lands on the right screen of the form, not on the exact box.
- **The wording must match how your Checkers really talk.** I have written a first list (below); the Checkers should look at it before it goes live. It is one list in one file, so changing it later is easy.
- **Cost:** one small additive database column, about a day of work including tests. Low risk, because everything still works if nobody ticks anything.

**Recommendation:** build it. Keep the list short (nine items), keep the free-text box, and do **not** add quick phrases for Disapprove and Hold yet (they need company-policy wording that nobody has asked for). They can follow later if wanted.

## Design

**The list of problems** (shared, one place; the label is what people read, the step is where Fix goes):

| Code | Label | Fix goes to |
|---|---|---|
| `photo_unclear` | Photo is blurry, cut off or hard to read | Proof and review |
| `photo_wrong` | Receipt photo is missing or is the wrong file | Proof and review |
| `amount_wrong` | Amount does not match the receipt | Invoice details |
| `date_wrong` | Date does not match the receipt | Invoice details |
| `vendor_wrong` | Vendor name, address or TIN is missing or wrong | Invoice details |
| `invoice_no_wrong` | Invoice number is missing or wrong | Invoice details |
| `vat_wrong` | VAT or withholding details do not add up | VAT details |
| `reason_unclear` | Reason for spending is unclear or the classification is wrong | Reason for spending |
| `other` | Something else (write it below) | no Fix button, the note says it |

**Rules**
- Applies to **Return** (Checker) and **Ask for more proof** (Approver): both send the receipt back to the Med Ref.
- The Return dialog: tick any number of problems; the note is **optional** when at least one real problem (not only "Something else") is ticked; the note is **required** when nothing is ticked or when "Something else" is ticked. "Return record" stays disabled until one of these is met.
- Stored: `receipt.returnIssues` = the ticked codes joined by commas (max 300 characters), `receipt.lastNote` = only what was typed.
- Cleared whenever the receipt leaves "Returned" (submit, withdraw, release, undo, and every other action) and **overwritten** on every new return, so old problems never linger.
- Where the text appears (notice, email, history): the ticked labels joined with "; " and the note after them, for example "Photo is blurry, cut off or hard to read; Amount does not match the receipt. The total on the photo is 1,284.50." ("Something else" itself is not printed; the note carries it.)
- The Med Ref's email button opens the form on the first problem's step: `/receipts/<id>/edit?step=<step>`.
- Fix links appear only for the person who owns the receipt while it can be edited (`canEdit`). Checkers and Approvers see the problems as plain text.
- The form skips steps the answers make unnecessary (VAT, withholding, reason for spending). A Fix step that does not exist for this receipt falls back to Invoice details; an unknown `?step=` is ignored.
- Receipts returned before this feature have no problems saved: they show the note exactly as before, with no Fix buttons.

## Global Constraints

- Package scope `@reimsys/*`, database `reimsys`, tables lowercase (`@@map`).
- Database change is **additive only**: one nullable column. A rollback script is added in the style of `docs/rollback-payment-step.sql`.
- Plain words on screen. Buttons: "Fix" and "Start fixing". Dialog text: "What is the problem?" and "Pick all that apply".
- Existing behaviour must not change when no problems are ticked: returning with only a note works exactly as today, and returning with neither is still refused with code `NOTE_REQUIRED`.
- Tests never email real inboxes (demo users are `@example.com`; the reserved-address guard stays on).
- Every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (as a second `-m`). After every commit run `git push origin myBranch`. Do not mention pushing in messages to the user unless a push fails.
- Match the surrounding code style. Source files use CRLF line endings: edit with a tool that keeps them (the Edit tool does), not blind string replacement.

## Review Focus

1. **Return with ticks only (no typing).** The notice, the email and the history must read as sensible sentences, never blank or "undefined". (Task 3.)
2. **Receipts returned before this change.** They have a note and no problems saved: the banner and the form callout must still show the note and not crash or show empty Fix buttons. (Tasks 3, 5.)
3. **Fix pointing at a step the receipt does not have, and garbage in the address.** A VAT problem on a receipt without a BIR invoice, `?step=nonsense`, `?step=` on a new receipt: each must land on a sensible step or be ignored, never a blank page. (Tasks 1, 5.)
4. **Second return with fewer or no ticks.** Old problems must be replaced, not merged or left behind. (Task 3.)
5. **Who sees Fix.** Only the owner, only while editable; a Checker, an Approver and another Med Ref never get a link that would be refused. (Tasks 3, 5.)

---

## File Structure

**Create**
- `packages/shared/src/returnIssues.ts`: the list, helpers, text builder, step fallback.
- `packages/shared/test/returnIssues.test.ts`
- `apps/api/prisma/migrations/20261016010000_return_issues/migration.sql`
- `docs/rollback-return-issues.sql`
- `e2e/return-issues-flow.mjs`: API checks.
- `e2e/return-ui.mjs`: browser checks.

**Modify**
- `packages/shared/src/index.ts` (export), `packages/shared/src/receipts.ts` (`actionBodySchema`).
- `apps/api/prisma/schema.prisma`, `apps/api/src/routes/receipts.ts` (`runAction`), `apps/api/src/lib/receipts.ts` (`receiptDetail`).
- `apps/web/src/types.ts`, `apps/web/src/pages/ReceiptDetail.tsx`, `apps/web/src/pages/ReceiptForm.tsx`, `apps/web/src/styles.css`.
- `docs/PLAN.md`, `docs/EMAIL.md`, `docs/DEPLOY.md`.

**Running things.** API on 4000, web on 5173 (`pnpm dev`). After a schema change: `pnpm --filter @reimsys/api db:generate` (stop the API first on Windows, or the engine file is locked) and restart. One unit file: `pnpm exec vitest run <path>`. Browser scripts sign in several times: wait a minute between runs (the sign-in limit is 20 a minute).

---

## Task 1: Shared list, helpers and request rule

**Files:**
- Create: `packages/shared/src/returnIssues.ts`
- Modify: `packages/shared/src/index.ts`, `packages/shared/src/receipts.ts:178-183`
- Test: `packages/shared/test/returnIssues.test.ts`

**Interfaces:**
- Produces (all exported from `@reimsys/shared`):
  - `FIX_STEPS`, `type FixStep` (`'bir' | 'underco' | 'company' | 'invoice' | 'vat' | 'wht' | 'spend' | 'evidence'`).
  - `RETURN_ISSUES: readonly { code; label; step: FixStep | null }[]`, `RETURN_ISSUE_CODES`, `type ReturnIssueCode`.
  - `issueLabel(code): string`, `fixStepFor(code): FixStep | null`.
  - `parseIssues(csv: string | null | undefined): ReturnIssueCode[]` (drops unknown codes and repeats, keeps order).
  - `joinIssues(codes: readonly ReturnIssueCode[]): string | null` (comma list, `null` when empty).
  - `issuesText(codes: readonly ReturnIssueCode[], note?: string | null): string`.
  - `resolveFixStep(want: FixStep | null | undefined, available: readonly string[]): string | null`.
  - `actionBodySchema` gains `issues?: ReturnIssueCode[]` (at most 10).

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/test/returnIssues.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FIX_STEPS, RETURN_ISSUES, RETURN_ISSUE_CODES, actionBodySchema, fixStepFor, issueLabel, issuesText, joinIssues, parseIssues, resolveFixStep } from '../src/index';

describe('the list of problems', () => {
  it('has unique codes, plain labels and real form steps', () => {
    const codes = RETURN_ISSUES.map((i) => i.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const i of RETURN_ISSUES) {
      expect(i.label.length, i.code).toBeGreaterThan(8);
      expect(i.step === null || (FIX_STEPS as readonly string[]).includes(i.step), i.code).toBe(true);
    }
  });
  it('ends with "Something else", which has no step to fix', () => {
    const last = RETURN_ISSUES[RETURN_ISSUES.length - 1]!;
    expect(last.code).toBe('other');
    expect(last.step).toBeNull();
    expect(fixStepFor('other')).toBeNull();
  });
  it('sends photo problems to the proof step and amount problems to the invoice step', () => {
    expect(fixStepFor('photo_unclear')).toBe('evidence');
    expect(fixStepFor('photo_wrong')).toBe('evidence');
    expect(fixStepFor('amount_wrong')).toBe('invoice');
    expect(fixStepFor('vat_wrong')).toBe('vat');
    expect(fixStepFor('reason_unclear')).toBe('spend');
  });
});

describe('saving and reading the problems', () => {
  it('round-trips, in order, without repeats', () => {
    expect(joinIssues(['photo_unclear', 'amount_wrong'])).toBe('photo_unclear,amount_wrong');
    expect(joinIssues([])).toBeNull();
    expect(parseIssues('photo_unclear,amount_wrong')).toEqual(['photo_unclear', 'amount_wrong']);
    expect(parseIssues('amount_wrong,amount_wrong,photo_unclear')).toEqual(['amount_wrong', 'photo_unclear']);
  });
  it('ignores empty, missing and unknown values, so an old or damaged value never breaks a screen', () => {
    expect(parseIssues(null)).toEqual([]);
    expect(parseIssues(undefined)).toEqual([]);
    expect(parseIssues('')).toEqual([]);
    expect(parseIssues('nonsense,photo_unclear, ,<script>')).toEqual(['photo_unclear']);
  });
  it('fits in the database column even when every problem is ticked', () => {
    expect((joinIssues(RETURN_ISSUE_CODES as unknown as typeof RETURN_ISSUE_CODES) ?? '').length).toBeLessThanOrEqual(300);
  });
});

describe('the sentence people read', () => {
  it('lists the ticked labels, then the note', () => {
    expect(issuesText(['photo_unclear', 'amount_wrong'], 'The total on the photo is 1,284.50.'))
      .toBe(`${issueLabel('photo_unclear')}; ${issueLabel('amount_wrong')}. The total on the photo is 1,284.50.`);
  });
  it('works with ticks only, and with a note only', () => {
    expect(issuesText(['date_wrong'])).toBe(issueLabel('date_wrong'));
    expect(issuesText([], 'Please retake the photo.')).toBe('Please retake the photo.');
    expect(issuesText([], '')).toBe('');
  });
  it('does not print "Something else": the note carries it', () => {
    expect(issuesText(['other'], 'The vendor is not on the approved list.')).toBe('The vendor is not on the approved list.');
    expect(issuesText(['photo_unclear', 'other'], 'Also the date.')).toBe(`${issueLabel('photo_unclear')}. Also the date.`);
  });
});

describe('where Fix goes when the form has skipped steps', () => {
  const noBir = ['bir', 'invoice', 'spend', 'evidence'];
  const withBir = ['bir', 'underco', 'invoice', 'vat', 'spend', 'evidence'];
  it('uses the step when the form has it', () => {
    expect(resolveFixStep('vat', withBir)).toBe('vat');
    expect(resolveFixStep('evidence', noBir)).toBe('evidence');
  });
  it('falls back to the invoice step when the form skipped it (a VAT problem on a receipt with no BIR invoice)', () => {
    expect(resolveFixStep('vat', noBir)).toBe('invoice');
    expect(resolveFixStep('spend', ['bir', 'underco', 'invoice', 'vat', 'wht', 'evidence'])).toBe('invoice');
  });
  it('gives nothing for "no step", and the first step if even the invoice step is missing', () => {
    expect(resolveFixStep(null, withBir)).toBeNull();
    expect(resolveFixStep(undefined, withBir)).toBeNull();
    expect(resolveFixStep('vat', ['bir', 'evidence'])).toBe('bir');
    expect(resolveFixStep('vat', [])).toBeNull();
  });
});

describe('the return request', () => {
  const base = { version: 3 };
  it('accepts known problems and refuses unknown ones or more than ten', () => {
    expect(actionBodySchema.safeParse({ ...base, issues: ['photo_unclear', 'other'] }).success).toBe(true);
    expect(actionBodySchema.safeParse({ ...base, issues: ['made_up'] }).success).toBe(false);
    expect(actionBodySchema.safeParse({ ...base, issues: Array(11).fill('other') }).success).toBe(false);
    expect(actionBodySchema.safeParse(base).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `pnpm exec vitest run packages/shared/test/returnIssues.test.ts`
Expected: FAIL (exports do not exist).

- [ ] **Step 3: Implement**

Create `packages/shared/src/returnIssues.ts`:

```ts
/** Why a receipt is sent back to the Med Ref, as a short list people tap instead of type, and where in the form each one is fixed. */

/** The steps of the receipt form. The form skips the ones the answers make unnecessary, so a receipt may not have all of them. */
export const FIX_STEPS = ['bir', 'underco', 'company', 'invoice', 'vat', 'wht', 'spend', 'evidence'] as const;
export type FixStep = (typeof FIX_STEPS)[number];

export const RETURN_ISSUES = [
  { code: 'photo_unclear', label: 'Photo is blurry, cut off or hard to read', step: 'evidence' },
  { code: 'photo_wrong', label: 'Receipt photo is missing or is the wrong file', step: 'evidence' },
  { code: 'amount_wrong', label: 'Amount does not match the receipt', step: 'invoice' },
  { code: 'date_wrong', label: 'Date does not match the receipt', step: 'invoice' },
  { code: 'vendor_wrong', label: 'Vendor name, address or TIN is missing or wrong', step: 'invoice' },
  { code: 'invoice_no_wrong', label: 'Invoice number is missing or wrong', step: 'invoice' },
  { code: 'vat_wrong', label: 'VAT or withholding details do not add up', step: 'vat' },
  { code: 'reason_unclear', label: 'Reason for spending is unclear or the classification is wrong', step: 'spend' },
  { code: 'other', label: 'Something else (write it below)', step: null },
] as const satisfies readonly { code: string; label: string; step: FixStep | null }[];

export type ReturnIssueCode = (typeof RETURN_ISSUES)[number]['code'];
export const RETURN_ISSUE_CODES = RETURN_ISSUES.map((i) => i.code) as [ReturnIssueCode, ...ReturnIssueCode[]];

const byCode = new Map<string, (typeof RETURN_ISSUES)[number]>(RETURN_ISSUES.map((i) => [i.code, i]));
export const issueLabel = (code: ReturnIssueCode) => byCode.get(code)!.label;
export const fixStepFor = (code: ReturnIssueCode): FixStep | null => byCode.get(code)!.step;

/** The saved comma list as codes. Unknown, empty and repeated values are dropped, so a damaged or older value never breaks a screen. */
export function parseIssues(csv: string | null | undefined): ReturnIssueCode[] {
  const out: ReturnIssueCode[] = [];
  for (const part of (csv ?? '').split(',')) {
    const c = part.trim();
    if (byCode.has(c) && !out.includes(c as ReturnIssueCode)) out.push(c as ReturnIssueCode);
  }
  return out;
}

/** What is saved in the database column: the codes joined by commas, or null when nothing was ticked. */
export const joinIssues = (codes: readonly ReturnIssueCode[]): string | null => (codes.length ? codes.join(',') : null);

/** The sentence used in notices, emails and the history: the ticked problems, then the note. "Something else" is not printed (the note carries it). */
export function issuesText(codes: readonly ReturnIssueCode[], note?: string | null): string {
  const list = codes.filter((c) => c !== 'other').map(issueLabel).join('; ');
  const extra = (note ?? '').trim();
  return list && extra ? `${list}. ${extra}` : list || extra;
}

/**
 * Where "Fix" should go on this receipt. \`available\` is the steps its form really has: a VAT problem on a receipt with no BIR
 * invoice has no VAT step, so it goes to the invoice details instead.
 */
export function resolveFixStep(want: FixStep | null | undefined, available: readonly string[]): string | null {
  if (!want) return null;
  if (available.includes(want)) return want;
  if (available.includes('invoice')) return 'invoice';
  return available[0] ?? null;
}
```

In `packages/shared/src/index.ts`, after `export * from './payments';` add `export * from './returnIssues';`.

In `packages/shared/src/receipts.ts` add the import `import { RETURN_ISSUE_CODES } from './returnIssues';` at the top (below the existing imports) and change `actionBodySchema` to:
```ts
export const actionBodySchema = z.object({
  note: z.string().trim().max(1000).optional(),
  /** The problems the Checker or Approver ticked when sending a receipt back to the Med Ref. */
  issues: z.array(z.enum(RETURN_ISSUE_CODES)).max(10).optional(),
  /** The Checker's answer to "can it be seen completely on the invoice?" for the company name, TIN and address. */
  seen: z.object({ company: z.boolean(), tin: z.boolean(), address: z.boolean() }).optional(),
  version: z.number().int().min(0),
});
```

- [ ] **Step 4: Run to see it pass**

Run: `pnpm exec vitest run packages/shared` then `pnpm typecheck`
Expected: all shared tests pass; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/returnIssues.ts packages/shared/src/index.ts packages/shared/src/receipts.ts packages/shared/test/returnIssues.test.ts
git commit -m "Return reasons: shared list of problems with where each is fixed, and the request rule" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin myBranch
```

---

## Task 2: Database column and rollback

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (model `Receipt`, after `lastNote`)
- Create: `apps/api/prisma/migrations/20261016010000_return_issues/migration.sql`, `docs/rollback-return-issues.sql`

**Interfaces:**
- Produces: Prisma `Receipt.returnIssues: string | null`.

- [ ] **Step 1: Back up the database**

```bash
/c/xampp/mysql/bin/mysqldump.exe -u root --single-transaction --routines reimsys > ../reimsys-backups/before-return-issues-$(date +%Y%m%d-%H%M).sql
ls -la ../reimsys-backups | tail -2
```
Expected: a new `.sql` file of several MB.

- [ ] **Step 2: Edit the schema**

In `model Receipt`, directly after the `lastNote String? @db.VarChar(1000)` line add:
```prisma
  // The problems ticked when the receipt was sent back (codes joined by commas, see packages/shared/src/returnIssues.ts). Cleared when it leaves "Returned".
  returnIssues String?                  @db.VarChar(300)
```

- [ ] **Step 3: Create the migration from the live database and apply it**

`prisma migrate dev` asks for a database reset here because of old index differences, so build the SQL by diffing against the live database instead (it must contain only the new column):

```bash
cd apps/api
U=$(grep -E "^DATABASE_URL" .env | cut -d= -f2- | tr -d '"')
mkdir -p prisma/migrations/20261016010000_return_issues
pnpm exec prisma migrate diff --from-url "$U" --to-schema-datamodel prisma/schema.prisma --script 2>/dev/null | grep -v "^Loaded Prisma config" > prisma/migrations/20261016010000_return_issues/migration.sql
cat prisma/migrations/20261016010000_return_issues/migration.sql
```
Expected exactly:
```sql
-- AlterTable
ALTER TABLE `receipt` ADD COLUMN `returnIssues` VARCHAR(300) NULL;
```
If it contains anything else, stop and fix the schema edit. Then stop the API (and the web dev server) so the Prisma engine file is not locked, and:
```bash
pnpm exec prisma migrate deploy
pnpm db:generate
```
Expected: "1 migration applied", client regenerated. Restart the dev servers.

- [ ] **Step 4: Rollback script, tested on a scratch copy**

Create `docs/rollback-return-issues.sql`:
```sql
-- Undoes the 20261016010000_return_issues migration. Run ONLY if you are going back to the version before "return reasons".
-- It removes the column (the ticked problems on receipts that are still "Returned" are lost; their notes stay).
-- Safer alternative: restore the full backup from reimsys-backups/before-return-issues-*.sql (this loses anything done since).
ALTER TABLE `receipt` DROP COLUMN returnIssues;
DELETE FROM `_prisma_migrations` WHERE migration_name = '20261016010000_return_issues';
```
Verify:
```bash
M=/c/xampp/mysql/bin/mysql.exe
$M -u root -e "DROP DATABASE IF EXISTS reimsys_rbtest; CREATE DATABASE reimsys_rbtest;"
/c/xampp/mysql/bin/mysqldump.exe -u root reimsys | $M -u root reimsys_rbtest
$M -u root reimsys_rbtest < docs/rollback-return-issues.sql && echo ROLLBACK_OK
$M -u root reimsys_rbtest -e "SHOW COLUMNS FROM receipt LIKE 'returnIssues';"
$M -u root -e "DROP DATABASE reimsys_rbtest;"
```
Expected: `ROLLBACK_OK` and no column listed.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20261016010000_return_issues docs/rollback-return-issues.sql
git commit -m "Return reasons: returnIssues column on receipt, with rollback script" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin myBranch
```

---

## Task 3: API: accept, store, clear, show and announce the problems

**Files:**
- Modify: `apps/api/src/routes/receipts.ts` (`runAction`), `apps/api/src/lib/receipts.ts` (`receiptDetail`)
- Create: `e2e/return-issues-flow.mjs`

**Interfaces:**
- Consumes: Task 1 helpers, Task 2 column.
- Produces:
  - `POST /api/receipts/:id/return` and `/request` accept `{ version, note?, issues? }`.
  - `GET /api/receipts/:id` returns `returnIssues: ReturnIssueCode[]` (empty array when none).
  - Error codes: `NOTE_REQUIRED` (nothing ticked and no note; or "Something else" without a note), `ISSUES_NOT_ALLOWED` (problems sent with any other action).
  - The notice and email text use `issuesText(issues, note)`; the Med Ref's email button opens `/receipts/<id>/edit?step=<first step>` when a problem has a step.

- [ ] **Step 1: Write the failing e2e checks**

Create `e2e/return-issues-flow.mjs` (uses the helpers from the payment scripts):

```js
// Checks sending a receipt back with ticked problems, through the API. Needs the API (4000) and the seed applied.
// Usage: node e2e/return-issues-flow.mjs
import { B, H, call, checker, loginAll, makeDraft } from './payment-helpers.mjs';

const { ok, done } = checker();
const U = await loginAll();
const code = (r) => r.d?.error?.code;
const view = (c, r) => call(c, 'GET', `/receipts/${r.id}`);
/** Opens the receipt's evidence as this person: reviewers must do this before they can check, return or decide. */
const look = (c, r) => fetch(`${B}/receipts/${r.id}/evidence/${r.evidence[0].id}/file?mode=view`, { headers: H(c, false) });
/** A receipt Ana has submitted (a draft with a photo, then submitted). */
const submitted = async (name) => {
  const r = await makeDraft(U, 'ana', name, 410);
  return (await call(U.ana, 'POST', `/receipts/${r.id}/submit`, { version: r.version })).d.receipt;
};
/** A submitted receipt whose evidence the Checker has opened, ready to be sent back. */
const ready = async (name) => { const r = await submitted(name); await look(U.liza, r); return r; };

console.log('Returning with ticks');
const a = await ready('Return A');
ok('returning with nothing ticked and no note is still refused', code(await call(U.liza, 'POST', `/receipts/${a.id}/return`, { version: a.version })) === 'NOTE_REQUIRED');
ok('"Something else" alone needs a note', code(await call(U.liza, 'POST', `/receipts/${a.id}/return`, { version: a.version, issues: ['other'] })) === 'NOTE_REQUIRED');
ok('"Something else" with another tick still needs a note', code(await call(U.liza, 'POST', `/receipts/${a.id}/return`, { version: a.version, issues: ['photo_unclear', 'other'] })) === 'NOTE_REQUIRED');
ok('an unknown problem is refused', (await call(U.liza, 'POST', `/receipts/${a.id}/return`, { version: a.version, issues: ['made_up'] })).s === 400);
const sent = await call(U.liza, 'POST', `/receipts/${a.id}/return`, { version: a.version, issues: ['photo_unclear', 'amount_wrong'] });
ok('ticks alone are enough to return a receipt', sent.s === 200 && sent.d.receipt.status === 'returned');
const mine = (await view(U.ana, a)).d.receipt;
ok('the Med Ref gets the ticked problems, in order', JSON.stringify(mine.returnIssues) === JSON.stringify(['photo_unclear', 'amount_wrong']));
ok('there is no typed note, so no stray text', mine.lastNote === null);
const notes = (await call(U.ana, 'GET', '/notifications')).d.items;
ok('the notice reads as a sentence with the ticked problems', notes.some((n) => n.text.includes('was returned') && n.text.includes('Photo is blurry, cut off or hard to read; Amount does not match the receipt') && !n.text.includes('undefined')));
const hist = (await call(U.liza, 'GET', `/receipts/${a.id}/history`)).d.items.find((h) => h.action === 'receipt.return');
ok('the history shows the problems', !!hist && !!hist.note && hist.note.includes('Amount does not match the receipt'));
const mails = (await call(U.admin, 'GET', '/email-log')).d.items;
ok('the Med Ref was emailed', mails.some((e) => e.template === 'returned' && e.to === 'ana.reyes@example.com' && e.subject.includes(a.refNo)));

console.log('Returning with ticks and a note');
const b = await ready('Return B');
const withNote = await call(U.liza, 'POST', `/receipts/${b.id}/return`, { version: b.version, issues: ['vendor_wrong', 'other'], note: 'The TIN is cut off.' });
ok('ticks plus a note work, with "Something else" carried by the note', withNote.s === 200);
const bd = (await view(U.ana, b)).d.receipt;
ok('both are kept: problems and note', bd.returnIssues.includes('vendor_wrong') && bd.lastNote === 'The TIN is cut off.');
const bn = (await call(U.ana, 'GET', '/notifications')).d.items;
ok('"Something else" is not printed, the note is', bn.some((n) => n.text.includes('Vendor name, address or TIN is missing or wrong. The TIN is cut off.') && !n.text.includes('Something else')));

console.log('Only a note, as before');
const c = await ready('Return C');
ok('a note alone still works', (await call(U.liza, 'POST', `/receipts/${c.id}/return`, { version: c.version, note: 'Please retake the photo.' })).s === 200);
const cd = (await view(U.ana, c)).d.receipt;
ok('and no problems are saved', cd.returnIssues.length === 0 && cd.lastNote === 'Please retake the photo.');

console.log('Starting again clears the old problems');
const resub = await call(U.ana, 'POST', `/receipts/${a.id}/submit`, { version: mine.version });
ok('resubmitting clears the problems and the note', resub.s === 200 && resub.d.receipt.returnIssues.length === 0 && resub.d.receipt.lastNote === null);
await look(U.liza, resub.d.receipt);
const second = await call(U.liza, 'POST', `/receipts/${a.id}/return`, { version: resub.d.receipt.version, note: 'Still not right.' });
ok('a second return with only a note replaces the old problems instead of keeping them', second.s === 200 && (await view(U.ana, a)).d.receipt.returnIssues.length === 0);
const resub2 = await call(U.ana, 'POST', `/receipts/${a.id}/submit`, { version: (await view(U.ana, a)).d.receipt.version });
await look(U.liza, resub2.d.receipt);
const fourth = await call(U.liza, 'POST', `/receipts/${a.id}/return`, { version: resub2.d.receipt.version, issues: ['date_wrong'] });
ok('and a later return with a different tick shows only that one', fourth.s === 200 && JSON.stringify((await view(U.ana, a)).d.receipt.returnIssues) === JSON.stringify(['date_wrong']));
const resub3 = await call(U.ana, 'POST', `/receipts/${a.id}/submit`, { version: (await view(U.ana, a)).d.receipt.version });
const withdrawn = await call(U.ana, 'POST', `/receipts/${a.id}/withdraw`, { version: resub3.d.receipt.version });
ok('withdrawing leaves no problems behind', withdrawn.s === 200 && withdrawn.d.receipt.returnIssues.length === 0);

console.log('The approver asking for more proof');
const e = await submitted('Return E');
await look(U.liza, e);
const checked = await call(U.liza, 'POST', `/receipts/${e.id}/check`, { version: e.version });
await look(U.paolo, e);
const asked = await call(U.paolo, 'POST', `/receipts/${e.id}/request`, { version: checked.d.receipt.version, issues: ['photo_wrong'] });
ok('"ask for more proof" accepts ticks too', asked.s === 200 && JSON.stringify((await view(U.ana, e)).d.receipt.returnIssues) === JSON.stringify(['photo_wrong']));
const f = await submitted('Return F');
await look(U.liza, f);
ok('problems are only accepted when sending a receipt back', code(await call(U.liza, 'POST', `/receipts/${f.id}/check`, { version: f.version, issues: ['photo_unclear'] })) === 'ISSUES_NOT_ALLOWED');

console.log('Who can see what');
ok('another Med Ref cannot see the receipt at all', (await view(U.mark, b)).s === 404);
const asChecker = (await view(U.liza, b)).d.receipt;
ok('the Checker sees the problems (as text, no edit rights)', asChecker.returnIssues.includes('vendor_wrong') && asChecker.canEdit === false);

// END OF CHECKS
done();
```

- [ ] **Step 2: Run to see it fail**

Run: `node e2e/return-issues-flow.mjs`
Expected: FAIL (the API ignores `issues`, nothing is stored).

- [ ] **Step 3: Implement**

`apps/api/src/routes/receipts.ts`:
- imports: add `issuesText, joinIssues, fixStepFor, type ReturnIssueCode` to the `@reimsys/shared` import; import `receiptUrl` from `'../lib/notify.js'` (it is exported there; add it to the existing notify import).
- In `runAction`, right after `const note = body.note?.trim() || null;` add:
```ts
  const issues: ReturnIssueCode[] = action === 'return' || action === 'request' ? [...new Set(body.issues ?? [])] : [];
  if (body.issues?.length && issues.length === 0) throw badRequest('Problems can only be listed when sending a receipt back.', 'ISSUES_NOT_ALLOWED');
  // What people read in notices, emails and the history: the ticked problems, then the note.
  const reason = issues.length ? issuesText(issues, note) : note;
```
- Replace the existing line
  `if (t.note === 'required' && !note) throw badRequest(…);`
  with
```ts
  const hasReason = !!note || issues.some((c) => c !== 'other');
  if (t.note === 'required' && !hasReason) throw badRequest(action === 'return' ? 'Tell the Med Ref what to fix.' : action === 'disapprove' ? 'A reason is required.' : 'A note is required.', 'NOTE_REQUIRED');
  if (issues.includes('other') && !note) throw badRequest('Say what the other problem is.', 'NOTE_REQUIRED');
```
  (keep the exact message strings the line already had for the other actions: copy them from the current line when editing, do not change them.)
- With the other `data` assignments (near `if (action === 'return' || action === 'reserve' || action === 'request') data.lastNote = note;`) add:
```ts
  // The ticked problems belong to one return: replaced on every return, cleared by every other action.
  data.returnIssues = action === 'return' || action === 'request' ? joinIssues(issues) : null;
```
- In the `audit` call change `...(note ? { note } : {})` to `...(reason ? { note: reason } : {}), ...(issues.length ? { issues } : {})`.
- Where `mail` is built, change `{ actorName: who, note, docNo }` to `{ actorName: who, note: reason, docNo }`.
- The return/request notices become:
```ts
  const fix = issues.map(fixStepFor).find((s) => s);
  const fixLink = issues.length ? `${receiptUrl(r.id)}/edit${fix ? `?step=${fix}` : ''}` : undefined;
  if (action === 'return') await notify({ userIds: [r.encoderId], type: 'receipt.returned', receiptId: r.id, text: `${ref} was returned. ${reason}`, email: { template: 'returned', data: mail, link: fixLink } });
  if (action === 'request') await notify({ userIds: [r.encoderId], type: 'receipt.returned', receiptId: r.id, text: `${ref}: ${who} needs more proof. ${reason}`, email: { template: 'returned', data: mail, link: fixLink } });
```
  (replacing the two existing lines; the third line about informing the checker stays as it is, using `${note}` → change it to `${reason}` too if it prints the note).

`apps/api/src/lib/receipts.ts`: add `parseIssues` to the shared import and, in the returned object after `lastNote: r.lastNote,` add `returnIssues: parseIssues(r.returnIssues),`.

- [ ] **Step 4: Run to see it pass**

Run: `pnpm --filter @reimsys/api typecheck` (clean), then `node e2e/return-issues-flow.mjs`
Expected: `All checks passed`. Then `node e2e/api-flow.mjs`: expected `128 passed, 0 failed` (its "return needs a note" and "asking for proof needs a note" checks still hold).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/receipts.ts apps/api/src/lib/receipts.ts e2e/return-issues-flow.mjs
git commit -m "Return reasons: API accepts ticked problems, stores them per return, shows them to the Med Ref and puts them in the notice, email and history" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin myBranch
```

---

## Task 4: The Return dialog: tappable problems

**Files:**
- Modify: `apps/web/src/types.ts`, `apps/web/src/pages/ReceiptDetail.tsx` (`act`, `NoteModal`), `apps/web/src/styles.css`
- Create: `e2e/return-ui.mjs`

**Interfaces:**
- Consumes: `RETURN_ISSUES`, `ReturnIssueCode` (shared); API `issues` in the action body.
- Produces: `ReceiptDetail.returnIssues: ReturnIssueCode[]` (type); chips with `aria-pressed` and the visible text of each label.

- [ ] **Step 1: Write the failing browser checks**

Create `e2e/return-ui.mjs`:

```js
// Drives sending a receipt back with ticked problems and the Med Ref's Fix shortcuts, in Chrome.
// Needs the API (4000) and web app (5173), and the seed applied. Usage: node e2e/return-ui.mjs [screenshot-dir]
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { B, H, call, loginAll, makeDraft } from './payment-helpers.mjs';

const OUT = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'reimsys-return-shots'));
fs.mkdirSync(OUT, { recursive: true });
const U = await loginAll();
const submitted = async (name) => {
  const r = await makeDraft(U, 'ana', name, 275);
  return (await call(U.ana, 'POST', `/receipts/${r.id}/submit`, { version: r.version })).d.receipt;
};
const r1 = await submitted('Return UI one');
const r2 = await submitted('Return UI two');

const browser = await chromium.launch({ channel: 'chrome' });
let failed = 0;
const ok = (n, c, x = '') => { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : x); if (!c) failed++; };
const sessions = [];
async function open(email, size = { width: 1280, height: 860 }) {
  const ctx = await browser.newContext({ viewport: size, baseURL: process.env.WEB ?? 'http://localhost:5173' });
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  p.on('console', (m) => m.type() === 'error' && !/40[0-9]/.test(m.text()) && p.errors.push(m.text()));
  await p.goto('/'); await p.fill('input[type=email]', email); await p.fill('input[type=password]', 'Reimsys#2026'); await p.click('button[type=submit]');
  await p.waitForSelector('.shell');
  sessions.push({ email, p });
  return p;
}
const shot = (p, n) => p.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true });

console.log('The Checker sends it back');
const liza = await open('liza.santos@example.com');
await liza.goto(`/receipts/${r1.id}`);
await liza.waitForSelector('.dh');
await liza.click('button:has-text("Open evidence")');
await liza.waitForFunction(() => [...document.querySelectorAll('.tl li')].some((l) => l.textContent.includes('viewed evidence')));
await liza.click('.actionbar button:has-text("Return")');
const dlg = liza.locator('.modal');
await dlg.waitFor();
const send = dlg.locator('button:has-text("Return record")');
ok('the Return window offers the problems as buttons', (await dlg.locator('.issue').count()) === 9 && await dlg.getByRole('button', { name: 'Photo is blurry, cut off or hard to read' }).isVisible());
ok('it cannot be sent with nothing picked and nothing written', await send.isDisabled());
await dlg.getByRole('button', { name: 'Photo is blurry, cut off or hard to read' }).click();
ok('picking a problem turns it on and lets it be sent without typing', (await dlg.getByRole('button', { name: 'Photo is blurry, cut off or hard to read' }).getAttribute('aria-pressed')) === 'true' && await send.isEnabled());
await dlg.getByRole('button', { name: 'Photo is blurry, cut off or hard to read' }).click();
ok('picking it again turns it off', await send.isDisabled());
await dlg.getByRole('button', { name: 'Something else (write it below)' }).click();
ok('"Something else" needs words', await send.isDisabled());
await dlg.locator('textarea').fill('The vendor is not on the list.');
ok('and then it can be sent', await send.isEnabled());
await dlg.getByRole('button', { name: 'Something else (write it below)' }).click();
await dlg.locator('textarea').fill('');
await dlg.getByRole('button', { name: 'Photo is blurry, cut off or hard to read' }).click();
await dlg.getByRole('button', { name: 'Amount does not match the receipt' }).click();
await dlg.locator('textarea').fill('The total on the photo is 275.00.');
await shot(liza, 'return-1-dialog');
await send.click();
await liza.waitForSelector('.toast');
ok('it is sent with two problems and a note', /returned/i.test(await liza.locator('.toast').last().innerText()));

// END OF CHECKS
for (const s of sessions) ok(`no errors on the page for ${s.email}`, s.p.errors.length === 0 || (console.log(s.p.errors), false));
await browser.close();
console.log(failed ? `\n${failed} check(s) failed. Screenshots in ${OUT}` : `\nAll checks passed. Screenshots in ${OUT}`);
process.exit(failed ? 1 : 0);
```
(Unused imports `B`, `H`, `r2` are used by Task 5's checks; keep them.)

- [ ] **Step 2: Run to see it fail**

Run: `node e2e/return-ui.mjs`
Expected: FAIL at "offers the problems as buttons".

- [ ] **Step 3: Implement**

`apps/web/src/types.ts`: add `import type { ReturnIssueCode } from '@reimsys/shared';` (extend the existing shared import) and in `ReceiptDetail` after `lastNote: string | null;` add `returnIssues: ReturnIssueCode[];`.

`apps/web/src/pages/ReceiptDetail.tsx`:
- import `RETURN_ISSUES, type ReturnIssueCode` from `@reimsys/shared` (extend the existing import).
- The `act` mutation: change its parameter and body to carry `issues`:
```tsx
    mutationFn: ({ action, note, seen, issues }: { action: ReceiptAction; note?: string; seen?: Seen; issues?: ReturnIssueCode[] }) => api<{ receipt: ReceiptDetail }>(`/receipts/${id}/${action}`, { method: 'POST', body: { note, seen, issues, version: r!.version } }),
```
- The `NoteModal` call: `onSubmit={(note, seen, issues) => act.mutate({ action: modal, note, seen, issues })}`.
- In `NoteModal` change the `onSubmit` prop type to `(note: string, seen?: Seen, issues?: ReturnIssueCode[]) => void`, then add the problems state and rules after the existing `seen` state:
```tsx
  // Sending a receipt back: the problems are ticked from a short list, and the note becomes optional.
  const picking = action === 'return' || action === 'request';
  const [issues, setIssues] = useState<ReturnIssueCode[]>([]);
  const real = issues.some((c) => c !== 'other');
  const needsWords = picking ? (issues.length === 0 || issues.includes('other')) : required;
  const enough = !needsWords || text.trim().length >= 4;
  const ok = answered && (picking ? (real || text.trim().length >= 4) && enough : !required || text.trim().length >= 4);
```
  and remove the existing `const ok = …` line (it is replaced by the one above; `required` stays as it is for the other actions).
- Render the chips above the textarea label:
```tsx
      {picking && (
        <div style={{ margin: '0 0 14px' }}>
          <b style={{ fontSize: '.9rem', display: 'block', marginBottom: 8 }}>What is the problem? <span className="hint muted">Pick all that apply</span></b>
          <div className="issues" role="group" aria-label="Problems">
            {RETURN_ISSUES.map((i) => {
              const on = issues.includes(i.code);
              return <button key={i.code} type="button" className={`issue ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => setIssues((s) => (on ? s.filter((x) => x !== i.code) : [...s, i.code]))}>{i.label}</button>;
            })}
          </div>
        </div>
      )}
```
  Change the textarea label and placeholder for the picking case:
```tsx
        <span>{picking ? (needsWords ? 'Say what is wrong' : 'Add details') : cfg.field}{!needsWords && <span className="hint"> Optional</span>}</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={needsWords ? 'Required' : 'Add details'} autoFocus={!picking} maxLength={1000} />
```
  (for non-picking actions `needsWords` equals `required`, so their wording is unchanged; their label stays `cfg.field`). The submit button handler: `onClick={() => onSubmit(text.trim(), askSeen ? (seen as Seen) : undefined, picking ? issues : undefined)}`.

`apps/web/src/styles.css`: add
```css
.issues{display:flex;flex-wrap:wrap;gap:8px}
.issue{border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:20px;padding:8px 12px;font:inherit;font-size:.9rem;cursor:pointer;text-align:left}
.issue.on{background:var(--accent-soft);border-color:var(--accent);color:var(--accent);font-weight:600}
```

- [ ] **Step 4: Run to see it pass**

Run: `pnpm typecheck` then `node e2e/return-ui.mjs`
Expected: all checks pass. Look at `return-1-dialog.png`: the problems wrap onto several lines without cutting words off, and look right on a phone width too (the phone check is in Task 5).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/types.ts apps/web/src/pages/ReceiptDetail.tsx apps/web/src/styles.css e2e/return-ui.mjs
git commit -m "Return reasons: tappable problems in the Return and Ask for more proof windows" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin myBranch
```

---

## Task 5: The Med Ref's Fix shortcuts

**Files:**
- Modify: `apps/web/src/pages/ReceiptDetail.tsx` (the banner), `apps/web/src/pages/ReceiptForm.tsx` (jump to a step, callout), `apps/web/src/styles.css`
- Test: `e2e/return-ui.mjs`

**Interfaces:**
- Consumes: `ReceiptDetail.returnIssues`, `canEdit`, `issueLabel`, `fixStepFor`, `resolveFixStep`, `FIX_STEPS`.
- Produces: banner rows `.fixrow` (label plus a link named "Fix"), a "Start fixing" link, and `/receipts/:id/edit?step=<step>` support in the form.

- [ ] **Step 1: Add the failing browser checks**

Insert directly above `// END OF CHECKS` in `e2e/return-ui.mjs`:

```js
console.log('The Med Ref fixes it');
const ana = await open('ana.reyes@example.com');
await ana.goto(`/receipts/${r1.id}`);
await ana.waitForSelector('.callout.warn');
const banner = ana.locator('.callout.warn', { hasText: 'Returned for correction' });
ok('the Med Ref sees each problem on its own row, and the note', (await banner.locator('.fixrow').count()) === 2 && (await banner.innerText()).includes('The total on the photo is 275.00.'));
ok('each problem has a Fix button', (await banner.locator('.fixrow a:has-text("Fix")').count()) === 2 && await banner.locator('a:has-text("Start fixing")').isVisible());
await shot(ana, 'return-2-banner');
await banner.locator('.fixrow', { hasText: 'Photo is blurry' }).locator('a:has-text("Fix")').click();
await ana.waitForSelector('.steph');
ok('Fix for a photo problem opens the form on the proof step', (await ana.locator('.steph').innerText()) === 'Proof and review' && ana.url().includes('?step=evidence'));
ok('the form reminds them what was wrong', (await ana.locator('.callout.warn').innerText()).includes('Photo is blurry') && (await ana.locator('.callout.warn').innerText()).includes('The total on the photo is 275.00.'));
await ana.goBack();
await ana.waitForSelector('.callout.warn');
await ana.locator('.callout.warn .fixrow', { hasText: 'Amount does not match' }).locator('a:has-text("Fix")').click();
await ana.waitForSelector('.steph');
ok('Fix for an amount problem opens the invoice details step', (await ana.locator('.steph').innerText()) === 'Invoice details');
await ana.goto(`/receipts/${r1.id}`);
await ana.locator('a:has-text("Start fixing")').click();
await ana.waitForSelector('.steph');
ok('"Start fixing" opens the first problem', (await ana.locator('.steph').innerText()) === 'Proof and review');

console.log('Steps that do not exist for this receipt, and bad addresses');
await ana.goto(`/receipts/${r1.id}/edit?step=vat`);
await ana.waitForSelector('.steph');
ok('a VAT problem on a receipt with no BIR invoice lands on the invoice details', (await ana.locator('.steph').innerText()) === 'Invoice details');
await ana.goto(`/receipts/${r1.id}/edit?step=nonsense`);
await ana.waitForSelector('.steph');
ok('an unknown step is ignored and the form starts at the beginning', (await ana.locator('.steph').innerText()) === 'Reimbursement details');
await ana.goto('/receipts/new?step=evidence');
await ana.waitForSelector('.steph');
ok('a step in the address of a NEW receipt is ignored too', (await ana.locator('.steph').innerText()) === 'Reimbursement details');

console.log('Who sees Fix');
const checker = await open('liza.santos@example.com');
await checker.goto(`/receipts/${r1.id}`);
await checker.waitForSelector('.dh');
ok('the Checker sees the problems but no Fix buttons', (await checker.locator('.callout.warn .fixrow').count()) === 2 && (await checker.locator('.callout.warn a:has-text("Fix")').count()) === 0 && (await checker.locator('a:has-text("Start fixing")').count()) === 0);

console.log('Resubmitting');
await ana.goto(`/receipts/${r1.id}`);
await ana.click('.actionbar button:has-text("Resubmit")');
await ana.waitForSelector('.pill:has-text("Submitted")');
ok('after resubmitting the problems are gone', (await ana.locator('.callout.warn:has-text("Returned for correction")').count()) === 0);

console.log('An old return that only has a note');
const lizaApi = U.liza;
await fetch(`${B}/receipts/${r2.id}/evidence/${r2.evidence[0].id}/file?mode=view`, { headers: H(lizaApi, false) });
await call(lizaApi, 'POST', `/receipts/${r2.id}/return`, { version: r2.version, note: 'Please retake the photo.' });
await ana.goto(`/receipts/${r2.id}`);
await ana.waitForSelector('.callout.warn');
const plain = ana.locator('.callout.warn', { hasText: 'Returned for correction' });
ok('a return with only a note shows the note, with no problem rows and no broken Fix', (await plain.innerText()).includes('Please retake the photo.') && (await plain.locator('.fixrow').count()) === 0);
await ana.goto(`/receipts/${r2.id}/edit`);
await ana.waitForSelector('.steph');
ok('and the form callout shows the note', (await ana.locator('.callout.warn').innerText()).includes('Please retake the photo.'));

console.log('Phone screen');
const phone = await open('ana.reyes@example.com', { width: 390, height: 800 });
const r3 = await submitted('Return UI three');
await fetch(`${B}/receipts/${r3.id}/evidence/${r3.evidence[0].id}/file?mode=view`, { headers: H(U.liza, false) });
await call(U.liza, 'POST', `/receipts/${r3.id}/return`, { version: r3.version, issues: ['photo_unclear', 'vat_wrong', 'reason_unclear'], note: 'See the VAT line.' });
await phone.goto(`/receipts/${r3.id}`);
await phone.waitForSelector('.callout.warn .fixrow');
ok('on a phone nothing scrolls sideways and every Fix is reachable', (await phone.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1 && (await phone.locator('.callout.warn .fixrow a:has-text("Fix")').count()) === 3);
await shot(phone, 'return-3-phone');
```

- [ ] **Step 2: Run to see it fail**

Run: `node e2e/return-ui.mjs`
Expected: FAIL at "the Med Ref sees each problem on its own row".

- [ ] **Step 3: The banner**

In `apps/web/src/pages/ReceiptDetail.tsx`: import `fixStepFor, issueLabel` from `@reimsys/shared`. Remove the `returned` entry from the `note` constant so it only covers hold and disapproved:
```tsx
  const note = r.status === 'reserved' ? { cls: 'hold', icon: 'pause', title: 'On hold', text: r.lastNote }
    : r.status === 'disapproved' ? { cls: 'bad', icon: 'x', title: 'Disapproved', text: r.lastNote } : null;
  const fixUrl = (step: string | null) => `/receipts/${r.id}/edit${step ? `?step=${step}` : ''}`;
  const firstStep = r.returnIssues.map(fixStepFor).find((s) => s) ?? null;
```
Directly above the existing `{note?.text && …}` line add:
```tsx
      {r.status === 'returned' && (r.lastNote || r.returnIssues.length > 0) && (
        <div className="callout warn">
          <Icon name="undo" />
          <div>
            <b>Returned for correction</b>
            {r.returnIssues.length > 0 && (
              <div className="fixlist">
                {r.returnIssues.map((c) => {
                  const step = fixStepFor(c);
                  return (
                    <div key={c} className="fixrow">
                      <span>{c === 'other' ? 'Something else: see the note' : issueLabel(c)}</span>
                      {r.canEdit && step && <Link className="btn sm" to={fixUrl(step)}>Fix</Link>}
                    </div>
                  );
                })}
              </div>
            )}
            {r.lastNote && <span>{r.lastNote}</span>}
            {r.canEdit && <Link className="btn sm pri" style={{ marginTop: 8 }} to={fixUrl(firstStep)}>Start fixing</Link>}
          </div>
        </div>
      )}
```
(`Start fixing` also shows for a note-only return so the Med Ref has one clear button: it opens the form at the beginning, `fixUrl(null)`.)

`apps/web/src/styles.css`: add
```css
.fixlist{display:grid;gap:6px;margin:6px 0 8px}
.fixrow{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.fixrow span{flex:1 1 220px;min-width:0}
```

- [ ] **Step 4: The form jumps to the step and reminds them what was wrong**

`apps/web/src/pages/ReceiptForm.tsx`:
- add `useSearchParams` to the react-router import, `FIX_STEPS, issueLabel, resolveFixStep, type FixStep` to the shared import, and `useRef` is already imported.
- after `const [stepIx, setStepIx] = useState(0);` add:
```tsx
  const [params] = useSearchParams();
  const wantedStep = params.get('step');
  const jumped = useRef(false);
```
- after the `steps` memo and `const step = …` add:
```tsx
  // "Fix" in the returned-receipt box opens the form on the step to fix. Done once, after the saved answers are in (the steps depend on them).
  useEffect(() => {
    if (jumped.current || !ready || !rec || !wantedStep || !(FIX_STEPS as readonly string[]).includes(wantedStep)) return;
    jumped.current = true;
    const target = resolveFixStep(wantedStep as FixStep, steps);
    const at = target ? steps.indexOf(target as StepId) : -1;
    if (at > 0) setStepIx(at);
  }, [ready, rec?.id, steps]); // eslint-disable-line react-hooks/exhaustive-deps
```
- replace the existing returned callout line with:
```tsx
      {rec?.status === 'returned' && (rec.lastNote || rec.returnIssues.length > 0) && (
        <div className="callout warn"><Icon name="undo" /><div><b>Returned for correction</b>{rec.returnIssues.filter((c) => c !== 'other').length > 0 && <span>{rec.returnIssues.filter((c) => c !== 'other').map(issueLabel).join(' · ')}</span>}{rec.lastNote && <span>{rec.lastNote}</span>}</div></div>
      )}
```
(`?step=` on `/receipts/new` is ignored automatically because `rec` is undefined there.)

- [ ] **Step 5: Run to see it pass**

Run: `pnpm typecheck` then `node e2e/return-ui.mjs`
Expected: all checks pass. Look at `return-2-banner.png` and `return-3-phone.png`: each problem sits on its own row with its Fix button, nothing is cut off, "Start fixing" is clear.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/ReceiptDetail.tsx apps/web/src/pages/ReceiptForm.tsx apps/web/src/styles.css e2e/return-ui.mjs
git commit -m "Return reasons: Fix buttons for the Med Ref that open the form on the right step, and a reminder inside the form" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin myBranch
```

---

## Task 6: Email check, documents and full regression

**Files:**
- Modify: `docs/PLAN.md`, `docs/EMAIL.md`, `docs/DEPLOY.md`

- [ ] **Step 1: Look at the real email**

Run `node e2e/return-issues-flow.mjs` once more, then read the newest "returned" row in the email log as the Super Admin (Access, Email log), or:
```bash
/c/xampp/mysql/bin/mysql.exe -u root reimsys -e "SELECT toEmail, subject, LEFT(html, 100) FROM emaillog WHERE template='returned' ORDER BY id DESC LIMIT 2"
```
Check by eye in the Email templates preview that the "Please correct this receipt" email reads well with a long list: the highlighted box shows the problems and note in one block, and the button label is "Open the receipt" (it now opens the form on the first problem's step). The existing "returned" template needs no change: its `{{note}}` already holds the sentence. If the highlighted box looks cramped with three problems, shorten nothing: it wraps.

- [ ] **Step 2: Update the documents**

`docs/PLAN.md`: add a short section "Return reasons (built)": the nine problems and where each Fix goes, the rules (ticks or note, "Something else" needs words, cleared when the receipt leaves Returned, overwritten on each return, Fix only for the owner while editable), and the new column.
`docs/EMAIL.md`: under "Who gets what" note that the returned email now lists the ticked problems before the note and its button opens the form on the first problem's step.
`docs/DEPLOY.md`: add to the upgrade notes: "Run `pnpm --filter @reimsys/api exec prisma migrate deploy` (adds one nullable column, `receipt.returnIssues`). Nothing to seed. To go back: `docs/rollback-return-issues.sql`."

- [ ] **Step 3: Full regression**

With the API and web app running, one script at a time (wait a minute between the browser ones so the sign-in limit is not hit):
```bash
pnpm typecheck
pnpm test
pnpm build
node e2e/return-issues-flow.mjs
node e2e/return-ui.mjs
node e2e/payment-flow.mjs
node e2e/api-flow.mjs
node e2e/ui-flow.mjs
node e2e/security.mjs
node e2e/client-form-ui.mjs
node e2e/gaps-ui.mjs
node e2e/scan-ui.mjs
```
Expected: every command ends without a failure. `ui-flow` line "return needs a note" (the Return button stays disabled with nothing written or ticked) must still hold. If an older script fails because it expected the old wording or layout of the Return window, update that expectation and say which and why in the commit message; any other failure is a bug in this feature: fix the code.

- [ ] **Step 4: Commit**

```bash
git add docs/PLAN.md docs/EMAIL.md docs/DEPLOY.md
git commit -m "Return reasons: documents and rollout notes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin myBranch
```

---

## Self-review against the design

| Design point | Task |
|---|---|
| Nine problems, each with a label and a Fix step | 1 |
| Applies to Return and Ask for more proof | 3 (both routes), 4 (both windows) |
| Ticks make the note optional; nothing ticked or "Something else" needs words | 3 (server rule), 4 (window rule) |
| Stored as codes, note stays separate; one additive column; rollback | 2, 3 |
| Cleared on every other action, overwritten on every return | 3 |
| Sentence in notice, email, history (ticked labels, then note; no "Something else") | 1 (`issuesText`), 3 |
| Email button opens the form on the first problem's step | 3 |
| Fix only for the owner while editable | 5 (banner uses `canEdit`), tested for the Checker |
| Missing step falls back to invoice details; unknown or new-receipt `?step=` ignored | 1 (`resolveFixStep`), 5 |
| Old returns with only a note keep working | 3, 5 |
| Reminder inside the form | 5 |
| Docs and rollout | 6 |
| Out of scope, on purpose | quick phrases for Disapprove and Hold; reports on common problems; Fix to a single field |
