import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

export type DraftStatus = 'idle' | 'saving' | 'saved' | 'failed';
interface Saved { draft: { id: number } }

/**
 * Saves the form on the server a moment after each change, even when it is half filled, so a wrong exit loses nothing. Nothing is saved while the answers
 * still match `untouched` (an empty form, or the receipt as it was saved). Saves run one at a time, so a quick second change cannot start a second draft.
 */
export function useFormDraft<T extends object>({ enabled, receiptId, state, step, untouched }: { enabled: boolean; receiptId: number | null; state: T; step: number; untouched: T }) {
  const [draftId, setDraftIdState] = useState<number | null>(null);
  const [status, setStatus] = useState<DraftStatus>('idle');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const idRef = useRef<number | null>(null);
  const latest = useRef({ state, step });
  latest.current = { state, step };
  const lastSaved = useRef('');
  const untouchedJson = JSON.stringify(untouched);
  const busy = useRef(false);
  const again = useRef(false);
  const timer = useRef<number | null>(null);
  const retry = useRef<number | null>(null);

  const setId = useCallback((id: number | null) => { idRef.current = id; setDraftIdState(id); }, []);
  const clearTimers = () => { if (timer.current) window.clearTimeout(timer.current); if (retry.current) window.clearTimeout(retry.current); timer.current = retry.current = null; };

  /** Treat this draft (just loaded from the server) as already saved with these answers. */
  const adopt = useCallback((id: number | null, s: T, st: number) => { setId(id); lastSaved.current = id === null ? '' : JSON.stringify({ state: s, step: st }); setStatus(id === null ? 'idle' : 'saved'); }, [setId]);

  const persist = useCallback(async () => {
    if (busy.current) { again.current = true; return; }
    busy.current = true;
    try {
      do {
        again.current = false;
        const snap = latest.current;
        const json = JSON.stringify(snap);
        if (json === lastSaved.current) break;
        setStatus('saving');
        const r = await api<Saved>('/form-drafts', { method: 'PUT', body: { id: idRef.current ?? undefined, receiptId, step: snap.step, data: snap.state } });
        setId(r.draft.id);
        lastSaved.current = json;
        setStatus('saved'); setSavedAt(Date.now());
      } while (again.current);
    } catch {
      setStatus('failed');
      retry.current = window.setTimeout(() => void persist(), 6000);
    } finally { busy.current = false; }
  }, [receiptId, setId]);

  /** Forgets the saved copy: the form was saved as a receipt, or the person started over. */
  const discard = useCallback(async () => {
    clearTimers(); again.current = false;
    const id = idRef.current;
    setId(null); lastSaved.current = ''; setStatus('idle');
    if (id !== null) await api(`/form-drafts/${id}`, { method: 'DELETE' }).catch(() => undefined);
  }, [setId]);

  useEffect(() => {
    if (!enabled) return;
    if (retry.current) { window.clearTimeout(retry.current); retry.current = null; }
    if (JSON.stringify(state) === untouchedJson) {
      // Back to how it started: nothing to keep.
      if (idRef.current !== null && !busy.current) void discard();
      return;
    }
    if (JSON.stringify({ state, step }) === lastSaved.current) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { timer.current = null; void persist(); }, 700);
    return () => { if (timer.current) { window.clearTimeout(timer.current); timer.current = null; } };
  }, [enabled, state, step, untouchedJson, persist, discard]);

  // Leaving or hiding the page sends what is waiting, so the last few keystrokes are kept too.
  useEffect(() => {
    if (!enabled) return;
    const flush = () => {
      const snap = latest.current;
      if (JSON.stringify(snap.state) === untouchedJson || JSON.stringify(snap) === lastSaved.current) return;
      try {
        void fetch('/api/form-drafts', { method: 'PUT', keepalive: true, credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-requested-with': 'reimsys' }, body: JSON.stringify({ id: idRef.current ?? undefined, receiptId, step: snap.step, data: snap.state }) });
      } catch { /* the page is going away */ }
    };
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHide);
    return () => { window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', onHide); };
  }, [enabled, receiptId, untouchedJson]);

  useEffect(() => () => clearTimers(), []);

  return { draftId, status, savedAt, adopt, discard };
}
