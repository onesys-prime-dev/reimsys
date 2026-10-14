import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MeResponse, SessionInfo } from '@reimsys/shared';
import { api } from '../api';
import { isActive, rememberEnd, startActivityTracking } from '../activity';
import { useAuth } from '../auth';
import { Icon, Modal } from '../ui';

const WARN_MS = 120_000;
const MAX_WARN_MS = 5 * 60_000;
const mmss = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/**
 * Looks after the sign-in session:
 *  - someone who is working is kept signed in without noticing;
 *  - someone who has walked away is warned two minutes before, then signed out;
 *  - nobody stays signed in past the overall limit.
 */
export function SessionGuard() {
  const { session, signOut } = useAuth();
  const qc = useQueryClient();
  const [now, setNow] = useState(Date.now());
  const [maxAck, setMaxAck] = useState(false);
  const checked = useRef(false);
  const ended = useRef(false);

  // How far this device's clock is from the server's, so a wrong clock cannot sign anyone out early or late.
  const offset = useMemo(() => (session ? Date.parse(session.serverNow) - Date.now() : 0), [session]);
  const clock = now + offset;

  useEffect(() => startActivityTracking(), []);
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, []);

  const keepAlive = async () => {
    try {
      const r = await api<{ session: SessionInfo }>('/auth/keepalive', { method: 'POST' });
      qc.setQueryData<MeResponse | null>(['me'], (old) => (old ? { ...old, session: r.session } : old));
      checked.current = false;
    } catch { /* if this fails the session has already ended and the next check will say so */ }
  };

  // Working people stay signed in: a quiet request every so often while there is real activity.
  useEffect(() => {
    const t = window.setInterval(() => {
      if (!session) return;
      const left = Date.parse(session.expiresAt) - (Date.now() + offset);
      if (isActive(60_000) && left < session.idleMinutes * 60_000 - 60_000) void keepAlive();
    }, 20_000);
    return () => window.clearInterval(t);
  }, [session, offset]); // eslint-disable-line react-hooks/exhaustive-deps

  const left = session ? Date.parse(session.expiresAt) - clock : Infinity;
  const maxLeft = session ? Date.parse(session.maxAt) - clock : Infinity;

  // Another tab may have kept us alive, so look again before showing a warning.
  useEffect(() => {
    if (session && left <= WARN_MS + 10_000 && !checked.current) { checked.current = true; void qc.invalidateQueries({ queryKey: ['me'] }); }
  }, [left, session, qc]);

  // Time is up.
  useEffect(() => {
    if (!session || ended.current) return;
    if (left <= 0 || maxLeft <= 0) {
      ended.current = true;
      rememberEnd(maxLeft <= 0 ? 'max' : 'idle');
      void signOut();
    }
  }, [left, maxLeft, session, signOut]);

  if (!session || ended.current) return null;

  if (maxLeft <= MAX_WARN_MS && left > 0 && !maxAck) {
    const at = new Date(Date.parse(session.maxAt)).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
    return (
      <Modal title="Your session is about to end" onClose={() => setMaxAck(true)}>
        <p>For security, a sign-in cannot last past its limit, however busy you are. Yours ends at <b>{at}</b> (in {mmss(maxLeft)}). Finish what you are doing and save it, then sign in again.</p>
        <div className="btns"><button className="btn pri" onClick={() => setMaxAck(true)}>I understand</button></div>
      </Modal>
    );
  }

  if (left <= WARN_MS && left > 0 && !isActive(3000)) {
    return (
      <Modal title="Are you still there?" onClose={() => void keepAlive()}>
        <p>You have not done anything for a while. For security you will be signed out in <b style={{ fontVariantNumeric: 'tabular-nums' }} data-testid="countdown">{mmss(left)}</b>.</p>
        <div className="btns">
          <button className="btn" onClick={() => { rememberEnd('ended'); void signOut(); }}><Icon name="logout" size={18} />Sign out now</button>
          <button className="btn pri" autoFocus onClick={() => void keepAlive()}>Stay signed in</button>
        </div>
      </Modal>
    );
  }
  return null;
}
