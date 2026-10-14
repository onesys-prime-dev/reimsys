import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BULK_MAX, RECEIPT_STATUSES, STATUS_LABEL, TRANSACTION_LABEL, TRANSACTION_TYPES, type ReceiptStatus } from '@reimsys/shared';
import { ago, api, errMsg, fmtDate, money } from '../api';
import { useAuth } from '../auth';
import type { ReceiptBrief } from '../types';
import { Empty, Icon, Modal, StatusPill, useToast } from '../ui';

interface ListData { total: number; page: number; pageSize: number; counts: Record<string, number>; items: ReceiptBrief[] }

/** More than two days waiting for the next person. */
const late = (iso: string) => Date.now() - new Date(iso).getTime() > 2 * 86_400_000;

export function ReceiptRow({ r, showEncoder, pick }: { r: ReceiptBrief; showEncoder: boolean; pick?: { on: boolean; toggle: () => void } }) {
  return (
    <Link className={`row ${pick?.on ? 'picked' : ''}`} to={`/receipts/${r.id}`}>
      <span className={`c-main ${pick ? 'withbox' : ''}`}>
        {pick && <input type="checkbox" checked={pick.on} aria-label={`Select ${r.refNo}`} onClick={(e) => { e.stopPropagation(); }} onChange={pick.toggle} />}
        <span><b>{r.payee}</b><small>{r.refNo}{showEncoder ? ` · ${r.encoder.name}` : ''}</small></span>
      </span>
      <span className="c-cat">{r.transactionType ? TRANSACTION_LABEL[r.transactionType] : r.category?.name ?? '-'}{r.invoiceNo ? ` · ${r.invoiceNo}` : ''}<span className="mdate"> · {fmtDate(r.receiptDate)}</span></span>
      <span className="c-date">{fmtDate(r.receiptDate)}</span>
      <span className="c-amt">{money(r.amount)}</span>
      <span className="c-st"><StatusPill status={r.status} />{r.status === 'submitted' && r.submittedAt && <span className={`age ${late(r.submittedAt) ? 'late' : ''}`} style={{ display: 'block', marginTop: 2 }}>{late(r.submittedAt) ? 'Waiting ' : ''}{ago(r.submittedAt)}</span>}{r.status === 'checked' && r.checkedAt && <span className={`age ${late(r.checkedAt) ? 'late' : ''}`} style={{ display: 'block', marginTop: 2 }}>{late(r.checkedAt) ? 'Waiting, checked ' : 'checked '}{ago(r.checkedAt)}</span>}</span>
    </Link>
  );
}

export function ReceiptsPage() {
  const { can, me } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [picked, setPicked] = useState<number[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkNote, setBulkNote] = useState('');
  const [bulkResult, setBulkResult] = useState<{ done: number; results: { id: number; refNo: string | null; ok: boolean; message: string }[] } | null>(null);
  const [status, setStatus] = useState<ReceiptStatus | ''>('');
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState('updated');
  const [page, setPage] = useState(1);
  const own = can('receipt.create') && !can('receipt.view_all');

  const params = new URLSearchParams({ page: String(page), pageSize: '20' });
  if (status) params.set('status', status);
  if (q) params.set('q', q);
  if (type) params.set('transactionType', type);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (sort !== 'updated') params.set('sort', sort);
  const filtered = !!(status || q || type || from || to);
  const data = useQuery({ queryKey: ['receipts', params.toString()], queryFn: () => api<ListData>(`/receipts?${params}`), placeholderData: (p) => p, refetchInterval: 30_000 });
  const pages = data.data ? Math.max(1, Math.ceil(data.data.total / data.data.pageSize)) : 1;
  const counts = data.data?.counts ?? {};
  const all = Object.values(counts).reduce((s, n) => s + n, 0);
  const reset = () => { setPage(1); setPicked([]); };

  // Check or approve many at once. The server applies the same rules as one at a time, so anything not ready is skipped and explained.
  const bulkKind: 'check' | 'approve' | null = can('review.check') ? 'check' : can('review.decide') ? 'approve' : null;
  const readyStatus = bulkKind === 'check' ? 'submitted' : 'checked';
  const canPick = (r: ReceiptBrief) => !!bulkKind && r.status === readyStatus && r.encoder.id !== me?.id;
  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= BULK_MAX ? (toast(`Select up to ${BULK_MAX} at a time.`, 'bad'), p) : [...p, id]));
  const pickable = data.data?.items.filter(canPick) ?? [];
  const bulk = useMutation({
    mutationFn: () => api<{ done: number; skipped: number; results: { id: number; refNo: string | null; ok: boolean; message: string }[] }>('/receipts/bulk', { method: 'POST', body: { action: bulkKind, ids: picked, note: bulkNote || undefined } }),
    onSuccess: (d) => {
      setBulkOpen(false); setBulkNote(''); setPicked([]); setBulkResult(d);
      qc.invalidateQueries({ queryKey: ['receipts'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); qc.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  const exportQs = new URLSearchParams(params); exportQs.delete('page'); exportQs.delete('pageSize');

  return (
    <>
      <div className="ph">
        <div><h1>{own ? 'My receipts' : 'Receipts'}</h1><p>{own ? 'Everything you have encoded.' : 'Open a record to review its evidence.'}</p></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {can('receipt.import') && <Link className="btn" to="/receipts/import"><Icon name="upload" size={18} />Import</Link>}
          <a className="btn" href={`/api/receipts/export?format=xlsx&${exportQs}`}><Icon name="download" size={18} />Export</a>
          {can('receipt.create') && <Link className="btn pri" to="/receipts/new"><Icon name="plus" size={18} />New receipt</Link>}
        </div>
      </div>

      <div className="tools">
        <div className="search"><Icon name="search" size={18} /><input type="text" value={q} onChange={(e) => { setQ(e.target.value); reset(); }} placeholder="Search vendor, invoice no., TIN, reference, name" aria-label="Search receipts" /></div>
        <select style={{ width: 'auto' }} value={type} aria-label="Product or service" onChange={(e) => { setType(e.target.value); reset(); }}>
          <option value="">Product and service</option>{TRANSACTION_TYPES.map((t) => <option key={t} value={t}>{TRANSACTION_LABEL[t]}</option>)}
        </select>
        <input type="date" style={{ width: 'auto' }} value={from} aria-label="From date" onChange={(e) => { setFrom(e.target.value); reset(); }} />
        <input type="date" style={{ width: 'auto' }} value={to} aria-label="To date" onChange={(e) => { setTo(e.target.value); reset(); }} />
        <select style={{ width: 'auto' }} value={sort} aria-label="Sort by" onChange={(e) => { setSort(e.target.value); reset(); }}>
          <option value="updated">Recently changed</option><option value="newest">Newest receipt date</option><option value="oldest">Oldest receipt date</option>
          <option value="amount_high">Amount, high to low</option><option value="amount_low">Amount, low to high</option>
        </select>
        {filtered && <button className="btn sm ghost" onClick={() => { setStatus(''); setQ(''); setType(''); setFrom(''); setTo(''); setPage(1); }}><Icon name="x" size={16} />Clear filters</button>}
      </div>
      <div className="chips" style={{ marginBottom: 14 }}>
        <button className={`chip ${status === '' ? 'on' : ''}`} onClick={() => { setStatus(''); reset(); }}>All<span className="n">{all}</span></button>
        {RECEIPT_STATUSES.filter((s) => counts[s]).map((s) => (
          <button key={s} className={`chip ${status === s ? 'on' : ''}`} onClick={() => { setStatus(s); reset(); }}>{STATUS_LABEL[s]}<span className="n">{counts[s]}</span></button>
        ))}
      </div>

      <section className="card">
        <div className="thead"><span>Vendor</span><span>Type · invoice</span><span>Date</span><span className="c-amt">Amount</span><span>Status</span></div>
        {pickable.length > 1 && (
          <label className="selall"><input type="checkbox" checked={pickable.every((r) => picked.includes(r.id))} onChange={(e) => setPicked(e.target.checked ? pickable.slice(0, BULK_MAX).map((r) => r.id) : [])} />Select all {pickable.length} ready to {bulkKind === 'check' ? 'check' : 'decide'}</label>
        )}
        {data.data?.items.map((r) => <ReceiptRow key={r.id} r={r} showEncoder={!own} pick={canPick(r) ? { on: picked.includes(r.id), toggle: () => toggle(r.id) } : undefined} />)}
        {data.data && !data.data.items.length && <Empty title="No receipts here">{own ? 'Create your first receipt to get started.' : 'Try another filter or search.'}</Empty>}
        {!data.data && <div className="empty">Loading…</div>}
      </section>
      {picked.length > 0 && (
        <div className="savebar" role="region" aria-label="Selected receipts">
          <span>{picked.length} selected</span>
          <span style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => setPicked([])}>Clear</button>
            <button className="btn pri" onClick={() => setBulkOpen(true)}>{bulkKind === 'check' ? `Mark ${picked.length} checked` : `Approve ${picked.length}`}</button>
          </span>
        </div>
      )}
      {bulkOpen && (
        <Modal title={bulkKind === 'check' ? `Mark ${picked.length} receipts checked` : `Approve ${picked.length} receipts`} onClose={() => setBulkOpen(false)}>
          <p>Each receipt follows the usual rules. You must already have opened its evidence. Any that are not ready are skipped, and you will see which and why.</p>
          <label className="f"><span>Remark for all <span className="hint">Optional</span></span><textarea value={bulkNote} onChange={(e) => setBulkNote(e.target.value)} maxLength={1000} /></label>
          <div className="btns"><button className="btn" onClick={() => setBulkOpen(false)}>Cancel</button><button className="btn pri" disabled={bulk.isPending} onClick={() => bulk.mutate()}>{bulk.isPending ? 'Working…' : bulkKind === 'check' ? 'Mark checked' : 'Approve'}</button></div>
        </Modal>
      )}
      {bulkResult && (
        <Modal title={`${bulkResult.done} of ${bulkResult.results.length} done`} onClose={() => setBulkResult(null)}>
          {bulkResult.results.some((x) => !x.ok) && <p>These were skipped. Open each one, view its evidence, then try again.</p>}
          {bulkResult.results.filter((x) => !x.ok).map((x) => <div key={x.id} className="pref" style={{ padding: '8px 0' }}><div><b>{x.refNo ?? `#${x.id}`}</b><br /><small className="muted">{x.message}</small></div></div>)}
          <div className="btns"><button className="btn pri" onClick={() => setBulkResult(null)}>Close</button></div>
        </Modal>
      )}
      <div className="pager">
        <span className="muted">{data.data ? `${data.data.total} receipt${data.data.total === 1 ? '' : 's'}` : ''}</span>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span>Page {page} of {pages}</span>
          <button className="btn sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
        </span>
      </div>
    </>
  );
}
