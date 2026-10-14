import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

export type LiveState = 'connecting' | 'live' | 'offline';

/** Which screens' data to refresh when the server says an area changed. */
const REFRESH: Record<string, string[]> = {
  receipts: ['receipts', 'receipt', 'dashboard', 'history', 'comments', 'encoders', 'report-preview', 'report-data'],
  notifications: ['notifications'],
  reports: ['reports', 'report-data'],
  access: ['users', 'roles', 'permissions', 'user-sessions', 'dashboard'],
  me: ['me', 'my-sessions'],
  categories: ['categories'],
  emails: ['email-log', 'email-status'],
  audit: ['audit', 'my-activity', 'dashboard'],
  settings: ['mail-settings', 'email-templates', 'email-status', 'app-settings', 'company'],
};
const EVERYTHING = [...new Set(Object.values(REFRESH).flat())];

/**
 * Keeps the screen up to date by itself. The server sends a small "this area changed" signal and only the screens that are
 * open and show that area ask for fresh data. If the connection drops (Wi-Fi blip, laptop asleep) it reconnects and
 * refreshes everything once, so nothing is missed.
 */
export function useLive(enabled: boolean): LiveState {
  const qc = useQueryClient();
  const [state, setState] = useState<LiveState>('connecting');
  const queued = useRef(new Set<string>());
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    let es: EventSource | null = null;
    let everOpened = false;
    let closed = false;

    // Refreshes are collected for a moment (with a little random spread so a hundred people do not all ask at once).
    const refresh = (keys: string[]) => {
      keys.forEach((k) => queued.current.add(k));
      if (timer.current) return;
      timer.current = window.setTimeout(() => {
        timer.current = null;
        const now = [...queued.current];
        queued.current.clear();
        now.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      }, 80 + Math.random() * 450);
    };

    const open = () => {
      if (closed) return;
      es = new EventSource('/api/events');
      es.addEventListener('hello', () => {
        setState('live');
        // After a reconnect, something may have changed while we were away.
        if (everOpened) refresh(EVERYTHING);
        everOpened = true;
      });
      es.addEventListener('change', (e) => {
        try {
          const { scopes } = JSON.parse((e as MessageEvent).data) as { scopes: string[] };
          refresh(scopes.flatMap((s) => REFRESH[s] ?? []));
        } catch { /* ignore a malformed signal */ }
      });
      es.onerror = () => {
        setState('offline');
        // The browser retries on its own. If the server refused us outright (signed out), stop and let the app notice.
        if (es && es.readyState === EventSource.CLOSED) {
          // Refused outright usually means we were signed out or switched off, so check straight away.
          es = null; refresh(['me']); window.setTimeout(open, 5000);
        }
      };
    };
    open();

    // A phone that slept, or a tab that was in the background, catches up the moment it is looked at again.
    const wake = () => { if (document.visibilityState === 'visible') refresh(EVERYTHING); };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    return () => {
      closed = true;
      es?.close();
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
      if (timer.current) window.clearTimeout(timer.current);
      queued.current.clear();
    };
  }, [enabled, qc]);

  return enabled ? state : 'connecting';
}

/** A small light beside the bell: green when updates arrive on their own. */
export function LiveLight({ state }: { state: LiveState }) {
  const text = state === 'live' ? 'Live: updates appear by themselves' : state === 'offline' ? 'Reconnecting… changes may be delayed' : 'Connecting…';
  return (
    <span className={`live ${state}`} role="status" aria-label={text} title={text}>
      <i aria-hidden="true" />
      <span className="live-t">{state === 'live' ? 'Live' : state === 'offline' ? 'Offline' : '…'}</span>
    </span>
  );
}
