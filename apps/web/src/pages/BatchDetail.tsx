import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BATCHABLE_STATUSES, BATCH_MAX, BATCH_STEP_LABEL, RECEIPT_STATUSES, STATUS_LABEL, batchLabel, type ReceiptStatus } from '@reimsys/shared';
import { api, errMsg, fmtDateTime, money } from '../api';
import { PayDialog } from '../components/PayDialog';
import type { BatchDetail, BatchStep, ReceiptBrief } from '../types';
import { Empty, Field, Icon, Modal, useToast } from '../ui';
import { ReceiptRow } from './Receipts';

interface Outcome { id: number; refNo: string | null; ok: boolean; message: string }
const STEP_BUTTON: Record<BatchStep, string> = { check: 'Check', approve: 'Approve', pay: 'Pay' };

/** Lists the receipts that were skipped, each with its reason. */
function Results({ title, results, hint, onClose }: { title: string; results: Outcome[]; hint: string; onClose: () => void }) {
  const skipped = results.filter((x) => !x.ok);
  return (
    <Modal title={title} onClose={onClose}>
      {skipped.length > 0 && <p>{hint}</p>}
      {skipped.map((x) => <div key={x.id} className="pref" style={{ padding: '8px 0' }}><div><b>{x.refNo ?? `#${x.id}`}</b><br /><small className="muted">{x.message}</small></div></div>)}
      <div className="btns"><button className="btn pri" onClick={onClose}>Close</button></div>
    </Modal>
  );
}

/** Finds receipts that can go into a batch (submitted and not yet paid or disapproved, in no other batch) and adds the ticked ones. */
function AddReceipts({ batch, onClose }: { batch: BatchDetail; onClose: (results?: Outcome[]) => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<ReceiptStatus | ''>('');
  const [picked, setPicked] = useState<number[]>([]);
  const params = new URLSearchParams({ pageSize: '100', sort: 'oldest', ...(q.trim() ? { q: q.trim() } : {}), ...(status ? { status } : {}) });
  const list = useQuery({ queryKey: ['receipts', 'for-batch', params.toString()], queryFn: () => api<{ items: ReceiptBrief[]; total: number }>(`/receipts?${params}`), placeholderData: (p) => p });
  const room = BATCH_MAX - batch.count - batch.hidden;
  const items = (list.data?.items ?? []).filter((r) => !r.batch && (BATCHABLE_STATUSES as readonly string[]).includes(r.status));
  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= room ? (toast(`The batch has room for ${room} more.`, 'bad'), p) : [...p, id]));
  const add = useMutation({
    mutationFn: () => api<{ added: number; skipped: number; results: Outcome[] }>(`/batches/${batch.id}/receipts`, { method: 'POST', body: { receiptIds: picked } }),
    onSuccess: (d) => {
      toast(`${d.added} added${d.skipped ? `, ${d.skipped} skipped` : ''}.`);
      for (const k of ['batch', 'batches', 'receipts']) qc.invalidateQueries({ queryKey: [k] });
      onClose(d.skipped ? d.results : undefined);
    },
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  return (
    <Modal title={`Add receipts to ${batch.code}`} onClose={() => onClose()} className="wide">
      <p className="muted">Only receipts that were submitted and are not yet paid or disapproved, and are in no other batch, are listed.</p>
      <div className="tools">
        <div className="search"><Icon name="search" size={18} /><input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Vendor, reference, name, invoice no." aria-label="Search receipts to add" /></div>
        <select style={{ width: 'auto' }} value={status} aria-label="Status" onChange={(e) => setStatus(e.target.value as ReceiptStatus | '')}>
          <option value="">Any status</option>{BATCHABLE_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </div>
      <div style={{ maxHeight: '50vh', overflow: 'auto', border: '1px solid var(--line)', borderRadius: 10 }}>
        {items.length > 1 && <label className="selall"><input type="checkbox" checked={items.slice(0, room).every((r) => picked.includes(r.id))} onChange={(e) => setPicked(e.target.checked ? items.slice(0, room).map((r) => r.id) : [])} />Select all {Math.min(items.length, room)} shown</label>}
        {items.map((r) => <ReceiptRow key={r.id} r={r} showEncoder pick={{ on: picked.includes(r.id), toggle: () => toggle(r.id) }} />)}
        {list.data && !items.length && <Empty title="Nothing to add">No receipt here can go into a batch. Try another search.</Empty>}
        {!list.data && <div className="empty">Loading…</div>}
      </div>
      <div className="btns"><button className="btn" onClick={() => onClose()}>Cancel</button><button className="btn pri" disabled={!picked.length || add.isPending} onClick={() => add.mutate()}>{add.isPending ? 'Adding…' : `Add ${picked.length || ''}`.trim()}</button></div>
    </Modal>
  );
}

export function BatchDetailPage() {
  const id = Number(useParams().id);
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['batch', id], queryFn: () => api<{ batch: BatchDetail }>(`/batches/${id}`), retry: false });
  const [step, setStep] = useState<'check' | 'approve' | null>(null);
  const [note, setNote] = useState('');
  const [paying, setPaying] = useState(false);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [results, setResults] = useState<{ title: string; hint: string; list: Outcome[] } | null>(null);
  const refresh = () => { for (const k of ['batch', 'batches', 'receipts', 'dashboard', 'payments-queue', 'notifications']) qc.invalidateQueries({ queryKey: [k] }); };

  const process = useMutation({
    mutationFn: (action: 'check' | 'approve') => api<{ done: number; skipped: number; results: Outcome[] }>(`/batches/${id}/process`, { method: 'POST', body: { action, note: note.trim() || undefined } }),
    onSuccess: (d, action) => {
      setStep(null); setNote(''); refresh();
      if (d.skipped) setResults({ title: `${d.done} of ${d.results.length} done`, hint: 'These were skipped. Each one follows the usual rules: open it, view its evidence (and confirm the company details when asked), then try again.', list: d.results });
      else toast(`${d.done} receipt${d.done === 1 ? '' : 's'} ${action === 'check' ? 'checked' : 'approved'}.`);
    },
    onError: (e) => { toast(errMsg(e), 'bad'); refresh(); },
  });
  const update = useMutation({
    mutationFn: (body: { name?: string; closed?: boolean }) => api(`/batches/${id}`, { method: 'PATCH', body }),
    onSuccess: () => { setRenaming(null); refresh(); },
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  const remove = useMutation({
    mutationFn: (rid: number) => api(`/batches/${id}/receipts/${rid}`, { method: 'DELETE' }),
    onSuccess: () => { toast('Removed from the batch.'); refresh(); },
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  const del = useMutation({
    mutationFn: () => api(`/batches/${id}`, { method: 'DELETE' }),
    onSuccess: () => { toast('Batch deleted.'); qc.invalidateQueries({ queryKey: ['batches'] }); nav('/batches'); },
    onError: (e) => toast(errMsg(e), 'bad'),
  });

  if (q.isError) return <><Link className="back" to="/batches"><Icon name="back" size={18} />Back to batches</Link><Empty title="Batch not found">It may have been deleted. {errMsg(q.error)}</Empty></>;
  if (!q.data) return <div className="empty">Loading…</div>;
  const b = q.data.batch;
  const people = [...new Map(b.receipts.map((r) => [r.encoder.id, r.encoder.name])).entries()];
  const empty = b.count === 0 && b.hidden === 0;

  return (
    <>
      <Link className="back" to="/batches"><Icon name="back" size={18} />Back to batches</Link>
      <div className="dh">
        <div className="ttl">
          <h1>{b.code}{b.name && <span className="muted" style={{ fontWeight: 500 }}> · {b.name}</span>}</h1>
          <div className="meta">
            {b.closed ? <span className="pill s-draft">Closed</span> : <span className="pill s-app">Open</span>}
            <span className="muted">{b.count} receipt{b.count === 1 ? '' : 's'} · made by {b.createdBy.name}, {fmtDateTime(b.createdAt)}</span>
            <span className="amt-big">{money(b.total)}</span>
          </div>
        </div>
        <div className="actionbar">
          {b.steps.filter((s) => s !== 'pay').map((s) => (b.ready[s] ?? 0) > 0 && <button key={s} className="btn pri" onClick={() => setStep(s as 'check' | 'approve')}><Icon name="check" size={18} />{STEP_BUTTON[s]} {b.ready[s]}</button>)}
          {b.steps.includes('pay') && b.payable.length > 0 && <button className="btn ok" onClick={() => setPaying(true)}><Icon name="wallet" size={18} />Pay {b.payable.length}</button>}
          {b.canManage && !b.closed && <button className="btn" onClick={() => setAdding(true)}><Icon name="plus" size={18} />Add receipts</button>}
          <a className="btn" href={`/api/receipts/export?format=xlsx&batchId=${b.id}`}><Icon name="download" size={18} />Export</a>
        </div>
      </div>

      {b.hidden > 0 && <div className="callout ok"><Icon name="info" /><div><b>{b.hidden} more receipt{b.hidden === 1 ? ' is' : 's are'} in this batch</b><span>at a step you do not see. They appear here when they reach you.</span></div></div>}
      {b.steps.length > 0 && !b.steps.some((s) => (b.ready[s] ?? 0) > 0) && b.count > 0 && <div className="callout ok"><Icon name="check" /><div><b>Nothing in this batch is waiting for you</b></div></div>}

      <section className="card tcard">
        <div className="panel-bar">
          <div className="chips">
            {RECEIPT_STATUSES.filter((s) => b.counts[s]).map((s) => <span key={s} className="chip">{STATUS_LABEL[s]}<span className="n">{b.counts[s]}</span></span>)}
          </div>
        </div>
        <div className="panel-body">
          {people.map(([pid, name]) => {
            const mine = b.receipts.filter((r) => r.encoder.id === pid);
            return (
              <div key={pid} className="paygrp">
                <div className="card-h"><h2>{name}</h2><small>{mine.length} receipt{mine.length === 1 ? '' : 's'} · {money(mine.reduce((s, r) => s + Math.round(r.amount * 100), 0) / 100)}</small></div>
                {mine.map((r) => (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center' }}>
                    <div style={{ flex: 1, minWidth: 0 }}><ReceiptRow r={r} showEncoder={false} hideBatch /></div>
                    {r.readyFor && <span className="pill s-chk" style={{ margin: '0 8px' }} title="Waiting for you">{BATCH_STEP_LABEL[r.readyFor]}</span>}
                    {b.canManage && r.canRemove && <button className="btn sm ghost" style={{ marginRight: 8 }} aria-label={`Remove ${r.refNo} from the batch`} title="Remove from the batch" disabled={remove.isPending} onClick={() => remove.mutate(r.id)}><Icon name="x" size={16} /></button>}
                  </div>
                ))}
              </div>
            );
          })}
          {!b.receipts.length && <Empty title="No receipts here yet">{b.canManage ? 'Use Add receipts to put receipts in this batch.' : 'None of its receipts are at a step you see.'}</Empty>}
        </div>
        {b.canManage && (
          <div className="panel-foot" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn sm" onClick={() => setRenaming(b.name ?? '')}><Icon name="edit" size={16} />Rename</button>
            <button className="btn sm" disabled={update.isPending} onClick={() => update.mutate({ closed: !b.closed })}>{b.closed ? 'Reopen' : 'Close'}</button>
            {empty && <button className="btn sm bad" onClick={() => setConfirmDelete(true)}><Icon name="x" size={16} />Delete batch</button>}
            <span className="muted" style={{ alignSelf: 'center', fontSize: '.84rem' }}>{b.closed ? 'Closed: nothing more can be added. Its receipts carry on as usual.' : 'Closing stops more receipts being added.'}</span>
          </div>
        )}
      </section>

      {step && (
        <Modal title={`${STEP_BUTTON[step]} ${b.ready[step]} receipt${b.ready[step] === 1 ? '' : 's'} in ${b.code}`} onClose={() => setStep(null)}>
          <p>Each receipt follows the usual rules. You must already have opened its evidence{step === 'check' ? ', and receipts with a BIR invoice need the company details confirmed on their own page' : ''}. Any that are not ready are skipped, and you will see which and why.</p>
          <label className="f"><span>Remark for all <span className="hint">Optional</span></span><textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></label>
          <div className="btns"><button className="btn" onClick={() => setStep(null)}>Cancel</button><button className="btn pri" disabled={process.isPending} onClick={() => process.mutate(step)}>{process.isPending ? 'Working…' : STEP_BUTTON[step]}</button></div>
        </Modal>
      )}
      {paying && (
        <PayDialog
          payee={batchLabel(b)}
          endpoint={`/batches/${b.id}/pay`}
          lines={[...b.payable].sort((x, y) => x.person.localeCompare(y.person) || x.id - y.id).map((p) => ({ id: p.id, refNo: p.refNo, vendor: p.vendor, amount: p.amount, version: p.version, person: p.person }))}
          onClose={() => setPaying(false)}
          onDone={() => { setPaying(false); refresh(); }}
        />
      )}
      {adding && <AddReceipts batch={b} onClose={(list) => { setAdding(false); if (list) setResults({ title: 'Some receipts were not added', hint: 'These could not go into the batch:', list }); }} />}
      {renaming !== null && (
        <Modal title={`Rename ${b.code}`} onClose={() => setRenaming(null)}>
          <Field label="Name" hint="Leave empty for no name"><input type="text" value={renaming} maxLength={80} autoFocus onChange={(e) => setRenaming(e.target.value)} /></Field>
          <div className="btns"><button className="btn" onClick={() => setRenaming(null)}>Cancel</button><button className="btn pri" disabled={update.isPending} onClick={() => update.mutate({ name: renaming.trim() })}>Save</button></div>
        </Modal>
      )}
      {confirmDelete && (
        <Modal title={`Delete ${b.code}?`} onClose={() => setConfirmDelete(false)}>
          <p>The batch is empty, so nothing else changes. Its code is not used again.</p>
          <div className="btns"><button className="btn" onClick={() => setConfirmDelete(false)}>Cancel</button><button className="btn bad" disabled={del.isPending} onClick={() => del.mutate()}>Delete</button></div>
        </Modal>
      )}
      {results && <Results title={results.title} hint={results.hint} results={results.list} onClose={() => setResults(null)} />}
    </>
  );
}

