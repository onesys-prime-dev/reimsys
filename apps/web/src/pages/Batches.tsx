import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { RECEIPT_STATUSES, STATUS_LABEL, batchWaitingText } from '@reimsys/shared';
import { api, errMsg, fmtDateTime, money } from '../api';
import type { BatchSummary } from '../types';
import { Empty, Field, Icon, Modal, useToast } from '../ui';

/** Asks for an optional name and makes a new batch, then opens it. */
export function NewBatchDialog({ onClose, receiptIds }: { onClose: () => void; receiptIds?: number[] }) {
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const make = useMutation({
    mutationFn: () => api<{ batch: { id: number; code: string }; added?: { added: number; skipped: number } }>('/batches', { method: 'POST', body: { name: name.trim() || undefined, receiptIds } }),
    onSuccess: (d) => {
      toast(`Batch ${d.batch.code} made${d.added ? `, ${d.added.added} receipt${d.added.added === 1 ? '' : 's'} added${d.added.skipped ? `, ${d.added.skipped} skipped` : ''}` : ''}.`);
      for (const k of ['batches', 'receipts']) qc.invalidateQueries({ queryKey: [k] });
      onClose();
      nav(`/batches/${d.batch.id}`);
    },
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  return (
    <Modal title="New batch" onClose={onClose}>
      <p>The code is given automatically. A name helps people find it, for example the branch or the week.</p>
      <Field label="Name" hint="Optional"><input type="text" value={name} maxLength={80} autoFocus onChange={(e) => setName(e.target.value)} placeholder="Pasig week 3" /></Field>
      <div className="btns"><button className="btn" onClick={onClose}>Cancel</button><button className="btn pri" disabled={make.isPending} onClick={() => make.mutate()}>{make.isPending ? 'Making…' : 'Make batch'}</button></div>
    </Modal>
  );
}

export function BatchesPage() {
  const nav = useNavigate();
  const toast = useToast();
  const [state, setState] = useState<'open' | 'closed' | 'all'>('open');
  const [q, setQ] = useState('');
  const [code, setCode] = useState('');
  const [making, setMaking] = useState(false);
  const params = new URLSearchParams({ state, ...(q.trim() ? { q: q.trim() } : {}) });
  const list = useQuery({ queryKey: ['batches', params.toString()], queryFn: () => api<{ canManage: boolean; batches: BatchSummary[] }>(`/batches?${params}`), placeholderData: (p) => p });
  const find = useMutation({
    mutationFn: () => api<{ id: number }>(`/batches/lookup?code=${encodeURIComponent(code.trim())}`),
    onSuccess: (d) => nav(`/batches/${d.id}`),
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); if (code.trim()) find.mutate(); };
  const batches = list.data?.batches ?? [];

  return (
    <>
      <div className="ph">
        <div><h1>Batches</h1><p>Receipts grouped under one code, to check, approve or pay together.</p></div>
        {list.data?.canManage && <button className="btn pri" onClick={() => setMaking(true)}><Icon name="plus" size={18} />New batch</button>}
      </div>
      <form className="card" style={{ marginBottom: 16 }} onSubmit={submit}>
        <div className="card-b" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="Open a batch by its code" className="full"><input type="text" value={code} onChange={(e) => setCode(e.target.value)} placeholder="B-2026-000004" aria-label="Batch code" style={{ maxWidth: 260 }} /></Field>
          <button className="btn" type="submit" disabled={!code.trim() || find.isPending}><Icon name="search" size={18} />Open</button>
        </div>
      </form>
      <section className="card tcard">
        <div className="panel-bar">
          <div className="tools">
            <div className="search"><Icon name="search" size={18} /><input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code or name" aria-label="Search batches" /></div>
            <div className="seg" role="group" aria-label="Which batches">
              {(['open', 'closed', 'all'] as const).map((s) => <button key={s} type="button" className={state === s ? 'on' : ''} onClick={() => setState(s)}>{s === 'open' ? 'Open' : s === 'closed' ? 'Closed' : 'All'}</button>)}
            </div>
          </div>
        </div>
        <div className="panel-body">
          {batches.map((b) => {
            const waiting = batchWaitingText(b.waiting);
            return (
              <Link key={b.id} className="rep-row" to={`/batches/${b.id}`} style={{ color: 'inherit', textDecoration: 'none' }} data-testid="batch-row">
                <div style={{ minWidth: 0 }}>
                  <b>{b.code}</b>{b.name && <span> · {b.name}</span>}{b.closed && <span className="pill s-draft" style={{ marginLeft: 8 }}>Closed</span>}
                  <small className="muted" style={{ display: 'block' }}>
                    {b.count} receipt{b.count === 1 ? '' : 's'}{b.count ? ` · ${RECEIPT_STATUSES.filter((s) => b.counts[s]).map((s) => `${b.counts[s]} ${STATUS_LABEL[s].toLowerCase()}`).join(', ')}` : ''} · made by {b.createdBy.name}, {fmtDateTime(b.createdAt)}
                  </small>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <b>{money(b.total)}</b>
                  {waiting && <span className="pill s-chk" style={{ display: 'flex', marginTop: 4 }}>{waiting}</span>}
                </div>
              </Link>
            );
          })}
          {list.data && !batches.length && <Empty title={q ? 'No batch matches' : state === 'closed' ? 'No closed batches' : 'No batches yet'}>{list.data.canManage ? 'Make one with New batch, then add receipts to it.' : 'Accounting or an administrator makes batches.'}</Empty>}
          {!list.data && <div className="empty">Loading…</div>}
        </div>
      </section>
      {making && <NewBatchDialog onClose={() => setMaking(false)} />}
    </>
  );
}
