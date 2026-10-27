import type { AppSettings } from './settings';
import { DEFAULT_SETTINGS } from './settings';

/** Money is always rounded to the centavo the same way, so the form, the server and the dashboard agree. */
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/* ---------- vendor TIN: 000-000-000-00000 ---------- */
export const TIN_DIGITS = 14;
export const TIN_FORMAT = '000-000-000-00000';
const TIN_GROUPS = [3, 3, 3, 5];

/** Digits only, at most 14, with the hyphens put in: "123456789" becomes "123-456-789". Safe to run on every keystroke and on pasted text. */
export function formatTin(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, TIN_DIGITS);
  const parts: string[] = [];
  let at = 0;
  for (const g of TIN_GROUPS) {
    if (at >= digits.length) break;
    parts.push(digits.slice(at, at + g));
    at += g;
  }
  return parts.join('-');
}

/**
 * Formats what was typed and says where the caret goes. The caret stays after the same number of digits it was after before,
 * so typing in the middle, deleting a digit or pasting does not throw it to the end.
 */
export function formatTinAt(input: string, caret: number): { value: string; caret: number } {
  const before = input.slice(0, Math.max(0, caret)).replace(/\D/g, '').length;
  const value = formatTin(input);
  const digits = Math.min(before, TIN_DIGITS);
  if (digits === 0) return { value, caret: 0 };
  let seen = 0;
  for (let i = 0; i < value.length; i++) {
    if (/\d/.test(value[i]!)) seen++;
    if (seen === digits) return { value, caret: i + 1 };
  }
  return { value, caret: value.length };
}

export const isCompleteTin = (s: string | null | undefined) => /^\d{3}-\d{3}-\d{3}-\d{5}$/.test((s ?? '').trim());

/* ---------- what the "Tax withheld?" answer costs ---------- */
export interface ImpactInput {
  birInvoice?: boolean | null; amount: number; vatableAmount?: number | null; vatAmount?: number | null; vatExemptAmount?: number | null;
  withheld?: boolean | null; whtRate?: number | null;
}

export interface TaxImpact {
  /** False when the receipt has no BIR invoice, the question is switched off, or the figures needed are missing. Nothing is invented then. */
  computable: boolean;
  rate: number;
  rateSource: 'entered' | 'default';
  net: number;
  gross: number;
  /** Tax withheld if the answer is Yes: the rate on the net (vatable) amount. */
  ifYes: number;
  /** Tax withheld if the answer is No: the rate on the gross amount. */
  ifNo: number;
  /** The difference between the two. Money that could be lost by answering No, or saved by answering Yes. */
  difference: number;
  /** What answering No may cost. Zero unless the answer is No. */
  potentialLoss: number;
  /** What answering Yes may save compared with No. Zero unless the answer is Yes. */
  potentialSavings: number;
}

const none = (rate: number, source: 'entered' | 'default', gross: number): TaxImpact =>
  ({ computable: false, rate, rateSource: source, net: 0, gross, ifYes: 0, ifNo: 0, difference: 0, potentialLoss: 0, potentialSavings: 0 });

/**
 * Yes: the withholding tax is worked out on the net amount (the vatable and VAT-exempt amounts, without VAT). No: on the gross amount.
 * The difference is the rate times the VAT. Every figure here is a potential one, not a verified one.
 * The rate is the one typed on the form when there is one, otherwise the administrator's default.
 */
export function taxImpact(f: ImpactInput, rules: AppSettings = DEFAULT_SETTINGS): TaxImpact {
  const entered = f.whtRate !== null && f.whtRate !== undefined && Number(f.whtRate) > 0;
  const rate = entered ? Number(f.whtRate) : rules.defaultWhtRate;
  const source = entered ? 'entered' : 'default';
  const gross = f.amount;
  if (f.birInvoice !== true || !rules.askWithholding || f.vatableAmount === null || f.vatableAmount === undefined) return none(rate, source, gross);
  // The net amount is what is left of the gross once the VAT is taken out: the vatable sales and any VAT-exempt sales.
  const net = round2(Number(f.vatableAmount) + Number(f.vatExemptAmount ?? 0));
  const ifYes = round2(net * rate / 100);
  const ifNo = round2(gross * rate / 100);
  const difference = Math.max(0, round2(ifNo - ifYes));
  return {
    computable: true, rate, rateSource: source, net, gross, ifYes, ifNo, difference,
    potentialLoss: f.withheld === false ? difference : 0,
    potentialSavings: f.withheld === true ? difference : 0,
  };
}

/* ---------- incomplete receipts ---------- */
export interface CompletenessInput {
  birInvoice?: boolean | null; invoiceNo?: string | null; vendorAddress?: string | null; vendorTin?: string | null;
  vatType?: string | null; vatableAmount?: number | null; vatAmount?: number | null; withheld?: boolean | null;
}

/** Why a receipt counts as incomplete. Answering No to "Tax withheld?" counts, and so does a missing invoice detail. Empty when it is complete. */
export function incompleteReasons(f: CompletenessInput, rules: AppSettings = DEFAULT_SETTINGS): string[] {
  if (f.birInvoice !== true) return [];
  const out: string[] = [];
  if (rules.askWithholding && f.withheld === false) out.push('Tax withheld answered No');
  if (!f.invoiceNo) out.push('Invoice no. missing');
  if (!f.vendorAddress) out.push('Vendor address missing');
  if (!f.vendorTin) out.push('Vendor TIN missing');
  else if (!isCompleteTin(f.vendorTin)) out.push('Vendor TIN incomplete');
  if (!f.vatType || f.vatableAmount === null || f.vatableAmount === undefined || f.vatAmount === null || f.vatAmount === undefined) out.push('VAT details missing');
  return out;
}

/* ---------- the VAT checks ---------- */
/**
 * error: stops the person going to the next step (red).
 * warn: shown in yellow; the person may carry on.
 * blockSubmit: shown in red; the person may carry on but the form cannot be submitted until it is fixed.
 */
export type CheckLevel = 'error' | 'warn' | 'blockSubmit';
export interface FormCheck { field: string; level: CheckLevel; message: string; total?: boolean }

export interface VatCheckInput {
  birInvoice?: boolean | null; amount: number; vatType?: string | null;
  vatableAmount?: number | null; vatAmount?: number | null; vatExemptAmount?: number | null; withheld?: boolean | null; whtRate?: number | null; whtAmount?: number | null;
}

/**
 * The VAT details checked against each other, each with a level that depends on the "Tax withheld?" answer.
 * Yes: any amount that does not match is red and blocks the step. No: an ordinary mismatch is yellow and the person may carry on.
 * A total that does not match (vatable amount plus VAT against the gross amount) is red and blocks submitting, whatever the answer.
 */
export function vatChecks(f: VatCheckInput, rules: AppSettings = DEFAULT_SETTINGS): FormCheck[] {
  const out: FormCheck[] = [];
  if (f.birInvoice !== true) return out;
  const close = (a: number, b: number) => Math.abs(a - b) <= rules.tolerance + 1e-9;
  const n = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
  const vatable = n(f.vatableAmount), vat = n(f.vatAmount), exempt = n(f.vatExemptAmount) ?? 0, rate = n(f.whtRate), wht = n(f.whtAmount);
  const strict = rules.askWithholding && f.withheld === true;
  const ordinary: CheckLevel = strict ? 'error' : 'warn';
  const totalLevel: CheckLevel = strict ? 'error' : 'blockSubmit';

  // The invoice gross (Total Sales, VAT inclusive) is the vatable sales, the VAT and the VAT-exempt sales. A discount is a deduction after it, so it is not part of this.
  // The note goes under the amount most likely to be wrong, so the person sees it where they have to fix it.
  let totalOn = '';
  if (vatable !== null && vat !== null && !close(vatable + vat + exempt, f.amount)) {
    const parts = exempt ? `vatable amount ${vatable.toFixed(2)} plus VAT ${vat.toFixed(2)} plus VAT-exempt ${exempt.toFixed(2)}` : `vatable amount ${vatable.toFixed(2)} plus VAT ${vat.toFixed(2)}`;
    const c = totalCulprit(vatable, vat, exempt, f.amount, rules.vatRate / 100, f.vatType === 'non_vatable', close);
    totalOn = c.field;
    out.push({
      field: c.field, level: totalLevel, total: true,
      message: `The total does not match: ${parts} is ${(vatable + vat + exempt).toFixed(2)}, but the invoice gross amount is ${f.amount.toFixed(2)}. ${c.hint}${strict ? '' : ' Correct it before submitting.'}`,
    });
  }
  // When the total note already says what the VAT amount should be, a second note about the same box would only repeat it.
  if (f.vatType === 'vatable' && vatable !== null && vat !== null && totalOn !== 'vatAmount' && !close(vatable * (rules.vatRate / 100), vat)) {
    out.push({ field: 'vatAmount', level: ordinary, message: `VAT is usually ${rules.vatRate}% of the vatable amount (${(vatable * rules.vatRate / 100).toFixed(2)}), but ${vat.toFixed(2)} was entered.` });
  }
  if (f.vatType === 'non_vatable' && vat !== null && vat !== 0) {
    out.push({ field: 'vatAmount', level: ordinary, message: 'The invoice is marked non-vatable, but a VAT amount was entered.' });
  }
  if (f.withheld === true && rules.askWithholding && rate !== null && wht !== null) {
    const base = vatable === null ? f.amount : vatable + exempt;
    if (!close(base * rate / 100, wht)) {
      out.push({ field: 'whtAmount', level: 'error', message: `${rate}% of ${base.toFixed(2)} is ${(base * rate / 100).toFixed(2)}, but a withholding amount of ${wht.toFixed(2)} was entered.` });
    }
  }
  return out;
}

/**
 * Which amount is the likely mistake when vatable + VAT + VAT-exempt does not add up to the gross. Looks at what each amount should be if the other two are right.
 * With a VAT rate, the vatable amount should be (gross - exempt) / (1 + rate) and the VAT the rest.
 */
function totalCulprit(vatable: number, vat: number, exempt: number, gross: number, rate: number, nonVatable: boolean, close: (a: number, b: number) => boolean): { field: string; hint: string } {
  const n2 = (n: number) => n.toFixed(2);
  const rest = round2(gross - exempt);
  // The VAT-exempt sales are part of the gross, so they can never be more than it. Nothing sensible can be said about the other amounts until that is right.
  if (rest <= 0) return { field: 'vatExemptAmount', hint: `The VAT-exempt amount cannot be as much as the gross amount (${n2(gross)}). Check it, or the gross amount on the invoice details.` };
  if (nonVatable) {
    if (vat !== 0) return { field: 'vatAmount', hint: 'The invoice is non-vatable, so the VAT amount should be 0.' };
    return { field: 'vatableAmount', hint: `With no VAT, the vatable amount should be about ${n2(rest)}.` };
  }
  const vNet = rest / (1 + rate);
  if (!close(vatable * rate, vat)) {
    // The VAT is not the right share of the vatable amount: one of the two is wrong. The one further from what the gross implies is the mistake.
    const errV = vNet ? Math.abs(vatable - vNet) / vNet : 1;
    const expectedVat = rest - vNet;
    const errT = expectedVat ? Math.abs(vat - expectedVat) / expectedVat : 1;
    if (errT >= errV) return { field: 'vatAmount', hint: `With a vatable amount of ${n2(vNet)}, the VAT amount should be about ${n2(expectedVat)}.` };
    return { field: 'vatableAmount', hint: `With a VAT of ${n2(vat)}, the vatable amount should be about ${n2(rate ? vat / rate : 0)}.` };
  }
  // The vatable amount and the VAT agree with each other, so what is left over is VAT-exempt sales, or the gross amount is not right.
  const left = round2(gross - vatable - vat);
  if (left > 0) return { field: 'vatExemptAmount', hint: `${n2(left)} of the gross is not accounted for. If the invoice has VAT-exempt sales, enter ${n2(left)} here; if not, check the gross amount on the invoice details.` };
  return { field: 'vatableAmount', hint: 'The amounts add up to more than the gross. Check the vatable amount, or the gross amount on the invoice details.' };
}
