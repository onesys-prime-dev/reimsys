import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PAYMENT_FILTERS, PAYMENT_FILTER_LABEL } from '@reimsys/shared';
import { Link, useNavigate } from 'react-router-dom';
import { api, errMsg, fmtDate, fmtDateTime, money, printUrl } from '../api';
import { useAuth } from '../auth';
import { Empty, Field, Icon, useToast } from '../ui';

interface Report { id: number; person: string | null; category: string | null; format: string; status: string; from: string; to: string; rowCount: number | null; total: number | null; error: string | null; createdAt: string; requestedBy: string }
const firstOfMonth = () => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1)).toISOString().slice(0, 10); };
const endOfMonth = () => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth() + 1, 0)).toISOString().slice(0, 10); };

export function ReportsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(endOfMonth());
  const [type, setType] = useState('');
  const [personId, setPersonId] = useState('');
  const [format, setFormat] = useState<'pdf' | 'xlsx' | 'csv'>('pdf');

  const people = useQuery({ queryKey: ['encoders'], queryFn: () => api<{ people: { id: number; name: string }[] }>('/receipts/encoders') });
  const [payment, setPayment] = useState<'all' | 'paid' | 'unpaid'>('all');
  const qs = new URLSearchParams({ from, to, ...(type ? { transactionType: type } : {}), ...(personId ? { encoderId: personId } : {}), ...(payment !== 'all' ? { payment } : {}) }).toString();
  const preview = useQuery({ queryKey: ['report-preview', qs], enabled: !!from && !!to && from <= to, queryFn: () => api<{ count: number; total: number; paid: number; unpaid: number }>(`/reports/preview?${qs}`) });
  const list = useQuery({
    queryKey: ['reports'], queryFn: () => api<{ reports: Report[] }>('/reports'),
    refetchInterval: (q) => (q.state.data?.reports.some((r) => r.status === 'pending') ? 1500 : false),
  });
  const gen = useMutation({
    mutationFn: () => api<{ report: { id: number } }>('/reports', { method: 'POST', body: { from, to, format, transactionType: type || null, encoderId: personId ? Number(personId) : null, payment } }),
    onSuccess: (d) => { toast('Report created.'); qc.invalidateQueries({ queryKey: ['reports'] }); nav(`/reports/${d.report.id}`); },
    onError: (e) => toast(errMsg(e), 'bad'),
  });

  const [showAll, setShowAll] = useState(false);
  const reports = list.data?.reports ?? [];
  const shown = showAll ? reports : reports.slice(0, 6);
  const bad = !from || !to || from > to;
  return (
    <>
      <div className="ph"><div><h1>Liquidation reports</h1><p>Approved records only, paid or not yet paid. Pending, returned and disapproved records are never included.</p></div></div>
      <div className="grid2">
        <section className="card">
          <div className="card-h"><h2>Build a report</h2></div>
          <div className="card-b">
            <div className="form">
              <Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
              <Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
              {(people.data?.people.length ?? 0) > 1 && (
                <Field label="Person" className="full"><select value={personId} onChange={(e) => setPersonId(e.target.value)}><option value="">Everyone</option>{people.data!.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
              )}
              <Field label="Product or service"><select value={type} onChange={(e) => setType(e.target.value)}><option value="">Product and service</option><option value="product">Product</option><option value="service">Service</option></select></Field>
              <Field label="Payment"><select aria-label="Payment" value={payment} onChange={(e) => setPayment(e.target.value as typeof payment)}>{PAYMENT_FILTERS.map((k) => <option key={k} value={k}>{PAYMENT_FILTER_LABEL[k]}</option>)}</select></Field>
              <div className="f"><span>Format</span><div className="seg">{(['pdf', 'xlsx', 'csv'] as const).map((k) => <button key={k} type="button" className={format === k ? 'on' : ''} onClick={() => setFormat(k)}>{k.toUpperCase()}</button>)}</div></div>
            </div>
            <div className="callout ok" style={{ margin: '18px 0 0' }}>
              <Icon name="info" />
              <div>{bad ? <b>Choose a valid date range</b> : preview.data ? <><b>{preview.data.count} {payment === 'paid' ? 'paid' : payment === 'unpaid' ? 'not yet paid' : 'approved'} record{preview.data.count === 1 ? '' : 's'} match</b><span>Total {money(preview.data.total)} · paid {money(preview.data.paid)} · not yet paid {money(preview.data.unpaid)}</span></> : <b>Checking…</b>}</div>
            </div>
            <div className="formbar"><button className="btn pri" disabled={bad || !preview.data?.count || gen.isPending || !can('report.generate')} onClick={() => gen.mutate()}><Icon name="chart" size={18} />Generate {format.toUpperCase()}</button></div>
          </div>
        </section>
        <section className="card">
          <div className="card-h"><h2>Past reports</h2></div>
          {shown.map((r) => (
            <div className="rep-row" key={r.id}>
              <div style={{ minWidth: 0 }}>
                <b>{r.format.toUpperCase()} · {fmtDate(r.from)} to {fmtDate(r.to)}</b>{(r.person || r.category) && <span className="pill s-chk" style={{ marginLeft: 8 }}>{[r.person, r.category].filter(Boolean).join(' · ')}</span>}<br />
                <small className="muted">
                  {r.status === 'ready' ? `${r.rowCount} record${r.rowCount === 1 ? '' : 's'} · ${money(r.total ?? 0)} · ` : r.status === 'failed' ? 'Failed · ' : 'Building… · '}
                  {fmtDateTime(r.createdAt)}{r.requestedBy ? ` · ${r.requestedBy}` : ''}
                </small>
              </div>
              {r.status === 'ready' && (
                <div className="acts">
                  <Link className="btn sm" to={`/reports/${r.id}`}><Icon name="eye" size={16} />View</Link>
                  <a className="btn sm" href={`/api/reports/${r.id}/file`} aria-label={`Download report ${r.id}`}><Icon name="download" size={16} /></a>
                  {r.format === 'pdf' && <button className="btn sm" aria-label={`Print report ${r.id}`} onClick={() => printUrl(`/api/reports/${r.id}/file?mode=print`)}><Icon name="print" size={16} /></button>}
                </div>
              )}
            </div>
          ))}
          {list.data && !reports.length && <Empty title="No reports yet">Generate one to see it here.</Empty>}
          {reports.length > 6 && <div style={{ padding: 12, textAlign: 'center', borderTop: '1px solid var(--line)' }}><button className="btn sm ghost" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer' : `Show all ${reports.length}`}</button></div>}
        </section>
      </div>
    </>
  );
}
