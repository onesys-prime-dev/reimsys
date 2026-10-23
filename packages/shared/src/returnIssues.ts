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

/** A receipt without a BIR invoice has no invoice number, TIN, VAT or withholding to get wrong, so those problems cannot be picked for it. */
const BIR_ONLY: readonly string[] = ['invoice_no_wrong', 'vat_wrong'];
export const issuesFor = (birInvoice: boolean | null | undefined) => RETURN_ISSUES.filter((i) => birInvoice !== false || !BIR_ONLY.includes(i.code));

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
 * Where "Fix" should go on this receipt. `available` is the steps its form really has: a VAT problem on a receipt with no BIR
 * invoice has no VAT step, so it goes to the invoice details instead.
 */
export function resolveFixStep(want: FixStep | null | undefined, available: readonly string[]): string | null {
  if (!want) return null;
  if (available.includes(want)) return want;
  if (available.includes('invoice')) return 'invoice';
  return available[0] ?? null;
}
