import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ago, api } from '../api';
import { Icon } from '../ui';

interface Data { unread: number; items: { id: number; text: string; receiptId: number | null; read: boolean; createdAt: string }[] }

const BELL = 'M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10.3 21a2 2 0 0 0 3.4 0';

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const nav = useNavigate();
  const box = useRef<HTMLDivElement>(null);
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => api<Data>('/notifications'), refetchInterval: 5_000, refetchOnWindowFocus: true });
  const read = useMutation({
    mutationFn: (ids?: number[]) => api('/notifications/read', { method: 'POST', body: { ids } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [open]);

  const unread = q.data?.unread ?? 0;
  return (
    <div ref={box} className="notif-wrap">
      <button className="iconbtn" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg className="ic" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={BELL} /></svg>
        {unread > 0 && <span className="badge dotn">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="panel" role="dialog" aria-label="Notifications">
          <div className="card-h"><h3>Notifications</h3><button className="btn sm ghost" disabled={!unread} onClick={() => read.mutate(undefined)}><Icon name="check" size={16} />Mark all read</button></div>
          {q.data?.items.length ? q.data.items.map((n) => (
            <button key={n.id} className={`note ${n.read ? 'rd' : 'un'}`} onClick={() => { read.mutate([n.id]); setOpen(false); if (n.receiptId) nav(`/receipts/${n.receiptId}`); }}>
              <span className="dotp" />
              <span style={{ flex: 1, minWidth: 0 }}>{n.text}<br /><small>{ago(n.createdAt)}</small></span>
            </button>
          )) : <div className="empty"><b>Nothing new</b>You are all caught up.</div>}
        </div>
      )}
    </div>
  );
}
