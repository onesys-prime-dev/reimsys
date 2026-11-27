import { CLASSIFICATIONS, CLASSIFICATION_LABEL, RECEIPT_STATUSES, STATUS_LABEL, type ReceiptStatus } from './receipts';

/**
 * Searching receipts with any hint: every word must be found somewhere on the receipt (vendor, reason, address, notes,
 * comments, where to charge, who encoded it, its batch, its REIM- or PAY- number, its status or type, its amount or date).
 * "Quoted words" stay together as one.
 */
export const SEARCH_MAX_TERMS = 8;
export const SEARCH_TERM_MAX = 60;

export function searchTerms(q: string | null | undefined): string[] {
  if (!q) return [];
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q))) {
    // Commas and other marks people type between words are not part of them (but 1,284.50 keeps its comma).
    const t = (m[1] ?? m[2] ?? '').trim().replace(/^[,;:.!?()]+|[,;:!?()]+$/g, '').slice(0, SEARCH_TERM_MAX);
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out.slice(0, SEARCH_MAX_TERMS);
}

/** An amount someone typed: "1,284.50" or "₱1284.5" is that amount; "1284" is anything from 1,284.00 to 1,284.99. Null when it is not an amount. */
export function amountTerm(t: string): { gte: number; lt: number } | null {
  const s = t.replace(/^(₱|php|p)\s*/i, '').replace(/,(?=\d{3}(\D|$))/g, '');
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  if (s.includes('.')) return { gte: Math.round(n * 100) / 100, lt: Math.round(n * 100) / 100 + 0.005 };
  return { gte: n, lt: n + 1 };
}

/** A date typed as 2026-11-20. */
export const dateTerm = (t: string): string | null => (/^\d{4}-\d{2}-\d{2}$/.test(t) && !Number.isNaN(new Date(`${t}T00:00:00Z`).getTime()) ? t : null);

/** Statuses, classifications and types whose names start with (or, for classifications, contain) the word. Short words match nothing here. */
export function labelMatches(t: string) {
  const w = t.toLowerCase();
  if (w.length < 3) return { statuses: [] as ReceiptStatus[], classifications: [] as string[], types: [] as string[] };
  return {
    statuses: RECEIPT_STATUSES.filter((s) => STATUS_LABEL[s].toLowerCase().startsWith(w)),
    classifications: CLASSIFICATIONS.filter((c) => CLASSIFICATION_LABEL[c].toLowerCase().includes(w)) as string[],
    types: ['product', 'service'].filter((x) => x.startsWith(w)),
  };
}

/** The database reads % and _ in a search as "anything"; typed by a person they mean themselves. */
export const likeSafe = (t: string) => t.replace(/[\\%_]/g, (m) => '\\' + m);
