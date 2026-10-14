import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RECEIPT_STATUSES, STATUS_LABEL, type ReceiptStatus } from '@reimsis/shared';
import { ago, api, fmtDate, money } from '../api';
import { useAuth } from '../auth';
import type { Category, ReceiptBrief } from '../types';
import { Empty, Icon, StatusPill } from '../ui';

interface ListData { total: number; page: number; pageSize: number; counts: Record<string, number>; items: ReceiptBrief[] }

/** More than two days waiting for the next person. */
const late = (iso: string) => Date.now() - new Date(iso).getTime() > 2 * 86_400_000;

export function ReceiptRow({ r, showEncoder }: { r: ReceiptBrief; showEncoder: boolean }) {
  return (
    <Link className="row" to={`/receipts/${r.id}`}>
      <span className="c-main"><b>{r.payee}</b><small>{r.refNo}{showEncoder ? ` · ${r.encoder.name}` : ''}</small></span>
      <span className="c-cat">{r.category.name}<span className="mdate"> · {fmtDate(r.receiptDate)}</span></span>
      <span className="c-date">{fmtDate(r.receiptDate)}</span>
      <span className="c-amt">{money(r.amount)}</span>
      <span className="c-st"><StatusPill status={r.status} />{r.status === 'submitted' && r.submittedAt && <span className={`age ${late(r.submittedAt) ? 'late' : ''}`} style={{ display: 'block', marginTop: 2 }}>{late(r.submittedAt) ? 'Waiting ' : ''}{ago(r.submittedAt)}</span>}{r.status === 'checked' && r.checkedAt && <span className={`age ${late(r.checkedAt) ? 'late' : ''}`} style={{ display: 'block', marginTop: 2 }}>{late(r.checkedAt) ? 'Waiting, checked ' : 'checked '}{ago(r.checkedAt)}</span>}</span>
    </Link>
  );
}

export function ReceiptsPage() {
  const { can } = useAuth();
  const [status, setStatus] = useState<ReceiptStatus | ''>('');
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState('updated');
  const [page, setPage] = useState(1);
  const own = can('receipt.create') && !can('receipt.view_all');

  const params = new URLSearchParams({ page: String(page), pageSize: '20' });
  if (status) params.set('status', status);
  if (q) params.set('q', q);
  if (categoryId) params.set('categoryId', categoryId);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (sort !== 'updated') params.set('sort', sort);
  const filtered = !!(status || q || categoryId || from || to);
  const data = useQuery({ queryKey: ['receipts', params.toString()], queryFn: () => api<ListData>(`/receipts?${params}`), placeholderData: (p) => p, refetchInterval: 30_000 });
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api<{ categories: Category[] }>('/categories') });
  const pages = data.data ? Math.max(1, Math.ceil(data.data.total / data.data.pageSize)) : 1;
  const counts = data.data?.counts ?? {};
  const all = Object.values(counts).reduce((s, n) => s + n, 0);
  const reset = () => setPage(1);
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
        <div className="search"><Icon name="search" size={18} /><input type="text" value={q} onChange={(e) => { setQ(e.target.value); reset(); }} placeholder="Search payee, reference, name" aria-label="Search receipts" /></div>
        <select style={{ width: 'auto' }} value={categoryId} aria-label="Category" onChange={(e) => { setCategoryId(e.target.value); reset(); }}>
          <option value="">All categories</option>{cats.data?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input type="date" style={{ width: 'auto' }} value={from} aria-label="From date" onChange={(e) => { setFrom(e.target.value); reset(); }} />
        <input type="date" style={{ width: 'auto' }} value={to} aria-label="To date" onChange={(e) => { setTo(e.target.value); reset(); }} />
        <select style={{ width: 'auto' }} value={sort} aria-label="Sort by" onChange={(e) => { setSort(e.target.value); reset(); }}>
          <option value="updated">Recently changed</option><option value="newest">Newest receipt date</option><option value="oldest">Oldest receipt date</option>
          <option value="amount_high">Amount, high to low</option><option value="amount_low">Amount, low to high</option>
        </select>
        {filtered && <button className="btn sm ghost" onClick={() => { setStatus(''); setQ(''); setCategoryId(''); setFrom(''); setTo(''); setPage(1); }}><Icon name="x" size={16} />Clear filters</button>}
      </div>
      <div className="chips" style={{ marginBottom: 14 }}>
        <button className={`chip ${status === '' ? 'on' : ''}`} onClick={() => { setStatus(''); reset(); }}>All<span className="n">{all}</span></button>
        {RECEIPT_STATUSES.filter((s) => counts[s]).map((s) => (
          <button key={s} className={`chip ${status === s ? 'on' : ''}`} onClick={() => { setStatus(s); reset(); }}>{STATUS_LABEL[s]}<span className="n">{counts[s]}</span></button>
        ))}
      </div>

      <section className="card">
        <div className="thead"><span>Receipt</span><span>Category</span><span>Date</span><span className="c-amt">Amount</span><span>Status</span></div>
        {data.data?.items.map((r) => <ReceiptRow key={r.id} r={r} showEncoder={!own} />)}
        {data.data && !data.data.items.length && <Empty title="No receipts here">{own ? 'Create your first receipt to get started.' : 'Try another filter or search.'}</Empty>}
        {!data.data && <div className="empty">Loading…</div>}
      </section>
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
