import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { initials } from './api';

/* ---------- icons ---------- */
const PATHS: Record<string, string> = {
  home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6',
  plus: 'M12 5v14M5 12h14',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  shield: 'M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6zM9 12l2 2 4-4',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  search: 'M21 21l-4.3-4.3M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  logout: 'M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5M16 8l4 4-4 4M20 12H9',
  upload: 'M12 16V5M7 9l5-5 5 5M5 20h14',
  lock: 'M8 11V7a4 4 0 0 1 8 0v4M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z',
  user: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 21c0-4 3.6-7 8-7s8 3 8 7',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  key: 'M14 10a4 4 0 1 1-3.5 6L3 20v-3l2-2h2v-2l3.5-.5A4 4 0 0 1 14 10z',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  print: 'M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v7H7z',
  camera: 'M3 8h4l2-3h6l2 3h4v12H3zM12 9a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  pause: 'M9 5v14M15 5v14',
  back: 'M15 5l-7 7 7 7',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5h.01',
  edit: 'M4 20h4l10-10-4-4L4 16zM13 7l4 4',
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10.3 21a2 2 0 0 0 3.4 0',
};
export function Icon({ name, size = 20 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg className="ic" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}

/* ---------- avatar ---------- */
export function Avatar({ name, userId, hasPhoto, size = 34, version }: { name: string; userId: number; hasPhoto?: boolean; size?: number; version?: number }) {
  const style = { width: size, height: size, fontSize: size > 50 ? '1.4rem' : size < 32 ? '.7rem' : '.8rem' };
  if (hasPhoto) return <img className="av" style={{ ...style, objectFit: 'cover' }} src={`/api/users/${userId}/photo?v=${version ?? 0}`} alt="" />;
  return <span className="av" style={style}>{initials(name)}</span>;
}

/* ---------- toast ---------- */
const ToastCtx = createContext<(msg: string, tone?: 'ok' | 'bad') => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string; tone: 'ok' | 'bad' }[]>([]);
  const n = useRef(0);
  const push = useCallback((msg: string, tone: 'ok' | 'bad' = 'ok') => {
    const id = ++n.current;
    setItems((s) => [...s, { id, msg, tone }]);
    setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), 3600);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div id="toast" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="toast" role="status">
            <Icon name={t.tone === 'ok' ? 'check' : 'x'} />
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- modal ---------- */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/* ---------- small pieces ---------- */
export const Field = ({ label, hint, error, children, className = '' }: { label: string; hint?: string; error?: string; children: ReactNode; className?: string }) => (
  <label className={`f ${className}`}>
    <span>{label} {hint && <span className="hint">{hint}</span>}</span>
    {children}
    {error && <span className="err">{error}</span>}
  </label>
);

export const Empty = ({ title, children }: { title: string; children?: ReactNode }) => (
  <div className="empty"><b>{title}</b>{children}</div>
);

export const Switch = ({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) => (
  <label className="switch">
    <input type="checkbox" checked={checked} disabled={disabled} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
    <i />
  </label>
);

export function CopyBox({ value }: { value: string }) {
  const toast = useToast();
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'var(--soft)', borderRadius: 10, padding: '10px 12px' }}>
      <code style={{ flex: 1, fontSize: '1.05rem', letterSpacing: '.04em', background: 'none', wordBreak: 'break-all' }}>{value}</code>
      <button className="btn sm" onClick={() => navigator.clipboard?.writeText(value).then(() => toast('Copied.'), () => toast('Select and copy it manually.', 'bad'))}>
        <Icon name="copy" size={16} />Copy
      </button>
    </div>
  );
}

/* ---------- status pill ---------- */
import { STATUS_LABEL, type ReceiptStatus } from '@reimsys/shared';
const PILL: Record<ReceiptStatus, string> = { draft: 's-draft', submitted: 's-sub', returned: 's-ret', checked: 's-chk', approved: 's-app', disapproved: 's-dis', reserved: 's-res' };
export const StatusPill = ({ status }: { status: ReceiptStatus }) => <span className={`pill ${PILL[status]}`}>{STATUS_LABEL[status]}</span>;
