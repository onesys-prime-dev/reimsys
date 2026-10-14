/**
 * Knows whether a real person is at the screen. Clicks, typing, touching and scrolling count. The page quietly asking the
 * server for news does not. The time is shared between browser tabs, so working in one tab keeps the others from timing out.
 */
const KEY = 'reimsys.lastInput';
let last = Date.now();
let lastWritten = 0;

const read = () => { try { return Number(localStorage.getItem(KEY) || 0); } catch { return 0; } };

export const lastActivity = () => Math.max(last, read());

/** True if the person did something within the last `ms` milliseconds. */
export const isActive = (ms = 60_000) => Date.now() - lastActivity() < ms;

export function startActivityTracking() {
  let moveGate = 0;
  const mark = () => {
    const now = Date.now();
    last = now;
    if (now - lastWritten > 5000) { lastWritten = now; try { localStorage.setItem(KEY, String(now)); } catch { /* private mode */ } }
  };
  const move = () => { const now = Date.now(); if (now - moveGate > 2000) { moveGate = now; mark(); } };
  const strong: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'touchstart', 'wheel'];
  strong.forEach((e) => window.addEventListener(e, mark, { passive: true }));
  window.addEventListener('mousemove', move, { passive: true });
  window.addEventListener('scroll', move, { passive: true, capture: true });
  mark();
  return () => {
    strong.forEach((e) => window.removeEventListener(e, mark));
    window.removeEventListener('mousemove', move);
    window.removeEventListener('scroll', move, true);
  };
}

/** Why the last session ended, remembered across the move back to the sign-in page. */
const REASON = 'reimsys.endedReason';
export type EndReason = 'idle' | 'max' | 'ended';
export const rememberEnd = (r: EndReason, overwrite = true) => {
  try { if (overwrite || !sessionStorage.getItem(REASON)) sessionStorage.setItem(REASON, r); } catch { /* ignore */ }
};
export const takeEndReason = (): EndReason | null => {
  try { const r = sessionStorage.getItem(REASON) as EndReason | null; sessionStorage.removeItem(REASON); return r; } catch { return null; }
};
