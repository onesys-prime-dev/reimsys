/**
 * The reimbursement form keeps what has been typed in this browser, so closing the tab or losing the page by mistake does not lose the answers.
 * Kept per signed-in person and per receipt, for a week, and cleared when the receipt is saved or the person signs out. Files cannot be kept here.
 */
const PREFIX = 'reimsys:form:';
const WEEK = 7 * 24 * 3600 * 1000;

export interface FormDraft<T> { f: T; stepIx: number; savedAt: number }

const keyOf = (userId: number | null | undefined, receiptId: number | null) => `${PREFIX}${userId ?? 0}:${receiptId ?? 'new'}`;

export function readDraft<T>(userId: number | null | undefined, receiptId: number | null): FormDraft<T> | null {
  try {
    const raw = localStorage.getItem(keyOf(userId, receiptId));
    if (!raw) return null;
    const d = JSON.parse(raw) as FormDraft<T>;
    if (!d || typeof d.savedAt !== 'number' || Date.now() - d.savedAt > WEEK || typeof d.f !== 'object' || d.f === null) { clearDraft(userId, receiptId); return null; }
    return d;
  } catch { return null; }
}

export function writeDraft<T>(userId: number | null | undefined, receiptId: number | null, f: T, stepIx: number) {
  try { localStorage.setItem(keyOf(userId, receiptId), JSON.stringify({ f, stepIx, savedAt: Date.now() } satisfies FormDraft<T>)); } catch { /* storage full or blocked: the form still works */ }
}

export function clearDraft(userId: number | null | undefined, receiptId: number | null) {
  try { localStorage.removeItem(keyOf(userId, receiptId)); } catch { /* nothing to clear */ }
}

/** Every saved form on this browser goes, for example when the person signs out on a shared computer. */
export function clearAllDrafts() {
  try { Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => localStorage.removeItem(k)); } catch { /* nothing to clear */ }
}
