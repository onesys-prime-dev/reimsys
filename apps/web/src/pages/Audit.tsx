import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errMsg, fmtDateTime } from '../api';
import { Empty, Icon, useToast } from '../ui';

interface Item {
  id: number; actorName: string; action: string; entityType: string; entityId: string | null; summary: string | null;
  before: unknown; after: unknown; ip: string | null; createdAt: string;
}
interface Result { total: number; page: number; pageSize: number; items: Item[] }

const lc = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const GROUPS = [['', 'All activity'], ['auth.', 'Sign in and security'], ['receipt.', 'Receipts and decisions'], ['evidence.', 'Evidence access'], ['document.', 'Documents'], ['payment.', 'Payments'], ['report.', 'Reports'], ['import.', 'Imports'], ['user.', 'Users'], ['role.', 'Roles and permissions'], ['profile.', 'Profiles']];

export function AuditPage() {
  const [tab, setTab] = useState<'log' | 'email'>('log');
  return (
    <>
      <div className="ph"><div><h1>Audit log</h1><p>Every movement in the system. Entries cannot be edited or deleted.</p></div></div>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'log'} className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}>Activity</button>
        <button role="tab" aria-selected={tab === 'email'} className={tab === 'email' ? 'on' : ''} onClick={() => setTab('email')}>Emails</button>
      </div>
      {tab === 'log' ? <Activity /> : <Emails />}
    </>
  );
}

function Activity() {
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
  const ex = new URLSearchParams(params); ex.delete('page'); ex.delete('pageSize');
  const data = useQuery({ queryKey: ['audit', params.toString()], queryFn: () => api<Result>(`/audit?${params}`), placeholderData: (p) => p });
  const pages = data.data ? Math.max(1, Math.ceil(data.data.total / data.data.pageSize)) : 1;
  const reset = () => setPage(1);

  return (
    <>
      <div className="tools">
        <div className="search"><Icon name="search" size={18} /><input type="text" value={q} placeholder="Search person, action, record" aria-label="Search audit log" onChange={(e) => { setQ(e.target.value); reset(); }} /></div>
        <select style={{ width: 'auto' }} value={action} aria-label="Activity type" onChange={(e) => { setAction(e.target.value); reset(); }}>{GROUPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <input type="date" style={{ width: 'auto' }} value={from} aria-label="From date" onChange={(e) => { setFrom(e.target.value); reset(); }} />
        <input type="date" style={{ width: 'auto' }} value={to} aria-label="To date" onChange={(e) => { setTo(e.target.value); reset(); }} />
        <a className="btn" style={{ marginLeft: 'auto' }} href={`/api/audit/export?${ex}`}><Icon name="download" size={18} />Export CSV</a>
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

interface EmailRow { id: number; to: string; template: string; subject: string; status: string; attempts: number; error: string | null; response: string | null; createdAt: string }

function Emails() {
  const toast = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const data = useQuery({ queryKey: ['email-log', status, page], queryFn: () => api<{ total: number; items: EmailRow[] }>(`/email-log?page=${page}&status=${status}`), placeholderData: (p) => p, refetchInterval: 10_000 });
  const retry = useMutation({
    mutationFn: (id: number) => api(`/email-log/${id}/retry`, { method: 'POST' }),
    onSuccess: () => { toast('Queued again.'); qc.invalidateQueries({ queryKey: ['email-log'] }); },
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  const status2 = useQuery({ queryKey: ['email-status'], queryFn: () => api<{ configured: boolean; host: string | null; port: number | null; from: string }>('/email-log/status') });
  const [testTo, setTestTo] = useState('');
  const sendTest = useMutation({
    mutationFn: () => api('/email-log/test', { method: 'POST', body: { to: testTo } }),
    onSuccess: () => { toast('Test email queued. It appears below in a moment.'); qc.invalidateQueries({ queryKey: ['email-log'] }); setTimeout(() => qc.invalidateQueries({ queryKey: ['email-log'] }), 2500); },
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  const pages = data.data ? Math.max(1, Math.ceil(data.data.total / 25)) : 1;
  const tone = (s: string) => (s === 'sent' ? 's-app' : s === 'failed' ? 's-dis' : s === 'logged' ? 's-ret' : 's-sub');
  return (
    <>
      {status2.data && (status2.data.configured
        ? <div className="callout ok" style={{ marginTop: 0 }}><Icon name="check" /><div><b>Sending through {status2.data.host}:{status2.data.port}</b><span>Messages go out as {status2.data.from}.</span></div></div>
        : <div className="callout warn" style={{ marginTop: 0 }}><Icon name="info" /><div><b>Emails marked "logged" were not sent</b><span>No SMTP server is configured, so messages are only recorded here. Add the SMTP settings to the server environment to send them.</span></div></div>)}
      <form className="tools" onSubmit={(e) => { e.preventDefault(); if (testTo) sendTest.mutate(); }}>
        <div style={{ flex: '1 1 260px', maxWidth: 380 }}><input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="Send a test email to…" aria-label="Test email address" /></div>
        <button className="btn pri" type="submit" disabled={!testTo || sendTest.isPending}>Send test email</button>
      </form>
      <div className="tools"><select style={{ width: 'auto' }} value={status} aria-label="Status" onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option><option value="sent">Sent</option><option value="logged">Logged only</option><option value="failed">Failed</option><option value="queued">Queued</option></select></div>
      <section className="card">
        {data.data?.items.map((e) => (
          <div className="pref" style={{ padding: '12px 18px' }} key={e.id}>
            <div style={{ minWidth: 0 }}><b>{e.subject}</b><br /><small className="muted">To {e.to} · {e.template} · {fmtDateTime(e.createdAt)}{e.error ? ` · ${e.error}` : ''}</small>{e.response && <small className="muted" style={{ display: 'block' }}>{e.response}</small>}</div>
            <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span className={`pill ${tone(e.status)}`}>{e.status}</span>{(e.status === 'failed' || e.status === 'logged') && <button className="btn sm" onClick={() => retry.mutate(e.id)}>Retry</button>}</span>
          </div>
        ))}
        {data.data && !data.data.items.length && <Empty title="No emails yet" />}
      </section>
      <div className="pager"><span className="muted">{data.data?.total ?? 0} total</span><span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {pages}</span><button className="btn sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></span></div>
    </>
  );
}
