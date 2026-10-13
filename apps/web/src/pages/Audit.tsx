import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, fmtDateTime } from '../api';
import { Empty, Icon } from '../ui';

interface Item {
  id: number; actorName: string; action: string; entityType: string; entityId: string | null; summary: string | null;
  before: unknown; after: unknown; ip: string | null; createdAt: string;
}
interface Result { total: number; page: number; pageSize: number; items: Item[] }

const lc = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const GROUPS = [['', 'All activity'], ['auth.', 'Sign in and security'], ['user.', 'Users'], ['role.', 'Roles and permissions'], ['profile.', 'Profiles']];

export function AuditPage() {
  const [q, setQ] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(null);
  const params = new URLSearchParams({ page: String(page), pageSize: '25' });
  if (q) params.set('q', q);
  if (action) params.set('action', action);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const data = useQuery({ queryKey: ['audit', params.toString()], queryFn: () => api<Result>(`/audit?${params}`), placeholderData: (p) => p });
  const pages = data.data ? Math.max(1, Math.ceil(data.data.total / data.data.pageSize)) : 1;
  const reset = () => setPage(1);

  return (
    <>
      <div className="ph"><div><h1>Audit log</h1><p>Every movement in the system. Entries cannot be edited or deleted.</p></div></div>
      <div className="tools">
        <div className="search"><Icon name="search" size={18} /><input type="text" value={q} placeholder="Search person, action, record" aria-label="Search audit log" onChange={(e) => { setQ(e.target.value); reset(); }} /></div>
        <select style={{ width: 'auto' }} value={action} aria-label="Activity type" onChange={(e) => { setAction(e.target.value); reset(); }}>{GROUPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <input type="date" style={{ width: 'auto' }} value={from} aria-label="From date" onChange={(e) => { setFrom(e.target.value); reset(); }} />
        <input type="date" style={{ width: 'auto' }} value={to} aria-label="To date" onChange={(e) => { setTo(e.target.value); reset(); }} />
      </div>
      <section className="card">
        {data.data?.items.map((a) => (
          <div key={a.id} className="aud">
            <button className="aud-h" onClick={() => setOpen(open === a.id ? null : a.id)} aria-expanded={open === a.id}>
              <span className="aud-t"><b>{a.actorName}</b> {lc(a.summary ?? a.action)}</span>
              <small>{fmtDateTime(a.createdAt)}</small>
            </button>
            {open === a.id && (
              <div className="aud-d">
                <div><small>Action</small><code>{a.action}</code></div>
                <div><small>Record</small><code>{a.entityType}{a.entityId ? ` #${a.entityId}` : ''}</code></div>
                <div><small>From</small><code>{a.ip ?? 'unknown'}</code></div>
                {a.before != null && <div className="wide"><small>Before</small><pre>{JSON.stringify(a.before, null, 2)}</pre></div>}
                {a.after != null && <div className="wide"><small>After</small><pre>{JSON.stringify(a.after, null, 2)}</pre></div>}
              </div>
            )}
          </div>
        ))}
        {data.data && !data.data.items.length && <Empty title="No matching entries">Try clearing a filter.</Empty>}
        {!data.data && <div className="empty">Loading…</div>}
      </section>
      <div className="pager">
        <span className="muted">{data.data ? `${data.data.total} entr${data.data.total === 1 ? 'y' : 'ies'}` : ''}</span>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span>Page {page} of {pages}</span>
          <button className="btn sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
        </span>
      </div>
    </>
  );
}
