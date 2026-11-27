import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BATCHABLE_STATUSES, BATCH_MAX, BATCH_STEP_LABEL, CUTOFF_STATUSES, LATE_NOTE_MAX, RECEIPT_STATUSES, STATUS_LABEL, batchLabel, fmtCutoff, type ReceiptStatus } from '@reimsys/shared';
import { api, errMsg, fmtDateTime, money } from '../api';
import { CutoffDialog, runText, type RunResult } from '../components/Cutoffs';
import { PayDialog } from '../components/PayDialog';
import { useAuth } from '../auth';
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

/** Could a late addition move this receipt out of its batch? Only out of one that is still open and not yet cut off. */
const movable = (r: ReceiptBrief, here: number) => !!r.batch && r.batch.id !== here && !r.batch.closedAt && !(r.batch.cutoffAt && r.batch.cutoffDoneAt);

/**
 * Finds receipts that can go into a batch (submitted and not yet paid or disapproved, in no other batch) and adds the ticked ones.
 * Late (the batch is closed or cut off): a reason is required, and receipts in another open batch can be moved over.
 */
function AddReceipts({ batch, late, onClose }: { batch: BatchDetail; late: boolean; onClose: (results?: Outcome[]) => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<ReceiptStatus | ''>('');
  const [picked, setPicked] = useState<number[]>([]);
  const [reason, setReason] = useState('');
  const params = new URLSearchParams({ pageSize: '100', sort: 'oldest', ...(q.trim() ? { q: q.trim() } : {}), ...(status ? { status } : {}) });
  const list = useQuery({ queryKey: ['receipts', 'for-batch', params.toString()], queryFn: () => api<{ items: ReceiptBrief[]; total: number }>(`/receipts?${params}`), placeholderData: (p) => p });
  const room = BATCH_MAX - batch.count - batch.hidden;
  const items = (list.data?.items ?? []).filter((r) => (!r.batch || (late && movable(r, batch.id))) && (BATCHABLE_STATUSES as readonly string[]).includes(r.status));
  const ruleStatuses = batch.cutoff?.rule ? (CUTOFF_STATUSES[batch.cutoff.rule.statuses] as readonly string[]) : null;
  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= room ? (toast(`The batch has room for ${room} more.`, 'bad'), p) : [...p, id]));
  const add = useMutation({
    mutationFn: () => api<{ added: number; skipped: number; results: Outcome[] }>(`/batches/${batch.id}/receipts`, { method: 'POST', body: { receiptIds: picked, ...(late ? { lateReason: reason.trim(), move: true } : {}) } }),
    onSuccess: (d) => {
      toast(`${d.added} added${late ? ' late' : ''}${d.skipped ? `, ${d.skipped} skipped` : ''}.`);
      for (const k of ['batch', 'batches', 'receipts']) qc.invalidateQueries({ queryKey: [k] });
      onClose(d.skipped ? d.results : undefined);
    },
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  return (
    <Modal title={late ? `Add receipts late to ${batch.code}` : `Add receipts to ${batch.code}`} onClose={() => onClose()} className="wide">
      {late
        ? <p className="muted">{batch.closed ? 'This batch is closed' : 'This batch’s cutoff has run'}, so what you add now is marked <b>Late</b> with your reason. Receipts in another open batch are moved here.</p>
        : <p className="muted">Only receipts that were submitted and are not yet paid or disapproved, and are in no other batch, are listed.</p>}
      {late && <label className="f" style={{ marginBottom: 12 }}><span>Why late <span className="hint">Required</span></span><textarea value={reason} maxLength={LATE_NOTE_MAX} onChange={(e) => setReason(e.target.value)} placeholder="For example: approved 20 minutes after the cutoff" aria-label="Why late" style={{ minHeight: 60 }} /></label>}
      <div className="tools">
        <div className="search"><Icon name="search" size={18} /><input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Vendor, reference, name, invoice no." aria-label="Search receipts to add" /></div>
        <select style={{ width: 'auto' }} value={status} aria-label="Status" onChange={(e) => setStatus(e.target.value as ReceiptStatus | '')}>
          <option value="">Any status</option>{BATCHABLE_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </div>
      <div style={{ maxHeight: '50vh', overflow: 'auto', border: '1px solid var(--line)', borderRadius: 10 }}>
        {items.length > 1 && <label className="selall"><input type="checkbox" checked={items.slice(0, room).every((r) => picked.includes(r.id))} onChange={(e) => setPicked(e.target.checked ? items.slice(0, room).map((r) => r.id) : [])} />Select all {Math.min(items.length, room)} shown</label>}
        {items.map((r) => {
          const notes = [r.batch ? `In ${r.batch.code}, will be moved here` : '', ruleStatuses && !ruleStatuses.includes(r.status) ? `${STATUS_LABEL[r.status]}, unlike the rest of this run` : ''].filter(Boolean);
          return <div key={r.id}><ReceiptRow r={r} showEncoder pick={{ on: picked.includes(r.id), toggle: () => toggle(r.id) }} />{notes.length > 0 && <small className="muted" style={{ display: 'block', padding: '0 16px 8px 52px' }}>{notes.join(' · ')}</small>}</div>;
        })}
        {list.data && !items.length && <Empty title="Nothing to add">No receipt here can go into a batch. Try another search.</Empty>}
        {!list.data && <div className="empty">Loading…</div>}
      </div>
      <div className="btns"><button className="btn" onClick={() => onClose()}>Cancel</button><button className="btn pri" disabled={!picked.length || add.isPending || (late && !reason.trim())} onClick={() => add.mutate()}>{add.isPending ? 'Adding…' : `${late ? 'Add late' : 'Add'} ${picked.length || ''}`.trim()}</button></div>
    </Modal>
  );
}

/** "in 3 days", "in 4 hours", "in 12 minutes", "any moment now". */
function timeLeft(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 60_000) return 'any moment now';
  const m = Math.round(ms / 60_000), h = Math.round(ms / 3_600_000), d = Math.round(ms / 86_400_000);
  return m < 60 ? `in ${m} minute${m === 1 ? '' : 's'}` : h < 36 ? `in ${h} hour${h === 1 ? '' : 's'}` : `in ${d} day${d === 1 ? '' : 's'}`;
}

/** Where the batch's cutoff stands, what it would take now, and the buttons to run, move, set or remove it. */
function CutoffPanel({ b, canSchedule, onRun, onChange, onRemove, busy }: { b: BatchDetail; canSchedule: boolean; onRun: () => void; onChange: () => void; onRemove: () => void; busy: boolean }) {
  const c = b.cutoff;
  if (!c && !b.canSetCutoff && !b.schedule && !b.parts.length && !b.partOf) return null;
  const sched = b.schedule && (canSchedule ? <Link to="/batches?tab=schedules">“{b.schedule.name}”</Link> : <>“{b.schedule.name}”</>);
  return (
    <section className="card" style={{ marginBottom: 16 }} data-testid="cutoff-panel">
      <div className="card-b cut-panel">
        <div className="cut-when">
          {c?.state === 'pending' && c.at && <b>Cutoff {fmtCutoff(c.at, c.timeZone)} <span className="muted" style={{ fontWeight: 500 }}>({c.running ? 'running now' : timeLeft(c.at)})</span></b>}
          {c?.state === 'ran' && c.at && <b>Closed at its cutoff, {fmtCutoff(c.at, c.timeZone)}</b>}
          {c?.state === 'cancelled' && <b>Its cutoff was cancelled: the batch was closed by hand first</b>}
          {!c && b.schedule && !b.schedule.isOn && <b>The schedule is paused, so this batch has no cutoff for now</b>}
          {!c && b.canSetCutoff && <b>No cutoff</b>}
          {c?.ruleText && c.state !== 'cancelled' && <span>{c.ruleText}</span>}
          {!c && b.canSetCutoff && <span className="muted">Give it one to fill it with the matching receipts and close it at a set time.</span>}
          {c?.state === 'pending' && b.wouldAdd && <span data-testid="would-add">{b.wouldAdd.count} receipt{b.wouldAdd.count === 1 ? '' : 's'} ({money(b.wouldAdd.total)}) would be added now{b.wouldAdd.hidden ? ` (${b.wouldAdd.hidden} at steps you do not see)` : ''}.</span>}
          {b.schedule && <small className="muted">From the cutoff schedule {sched}.</small>}
          {b.partOf && <small className="muted">Part {b.part} of the run that filled <Link to={`/batches/${b.partOf.id}`}>{b.partOf.code}</Link> (a batch holds {BATCH_MAX}).</small>}
          {b.parts.length > 0 && <small className="muted">The rest of this run is in {b.parts.map((p, i) => <span key={p.id}>{i ? ', ' : ''}<Link to={`/batches/${p.id}`}>{p.code}</Link></span>)}.</small>}
        </div>
        <div className="btns">
          {c?.canRun && <button className="btn pri" disabled={busy} onClick={onRun}>Run cutoff now</button>}
          {c?.canChange && <button className="btn" disabled={busy} onClick={onChange}><Icon name="edit" size={16} />Change this cutoff</button>}
          {c?.canRemove && <button className="btn ghost" disabled={busy} onClick={onRemove}>Remove cutoff</button>}
          {b.canSetCutoff && <button className="btn" disabled={busy} onClick={onChange}>Set a cutoff</button>}
        </div>
      </div>
    </section>
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
  const [adding, setAdding] = useState<false | 'plain' | 'late'>(false);
  const [cutting, setCutting] = useState(false);
  const [confirmRun, setConfirmRun] = useState(false);
  const { can } = useAuth();
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
  const runNow = useMutation({
    mutationFn: () => api<{ ran: RunResult }>(`/batches/${id}/cutoff/run`, { method: 'POST', body: {} }),
    onSuccess: (d) => { setConfirmRun(false); refresh(); toast(runText(d.ran, q.data?.batch.cutoff?.timeZone ?? 'Asia/Manila')); },
    onError: (e) => { setConfirmRun(false); toast(errMsg(e), 'bad'); refresh(); },
  });
  const dropCutoff = useMutation({
    mutationFn: () => api(`/batches/${id}/cutoff`, { method: 'PUT', body: { cutoffAt: null } }),
    onSuccess: () => { toast('Cutoff removed. The batch stays open as it is.'); refresh(); },
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
  // A switched-on schedule's open batch stays: the schedule is paused or deleted instead.
  const empty = b.count === 0 && b.hidden === 0 && !(b.schedule?.isOn && b.part === 1 && (b.cutoffState === 'pending' || b.cutoffState === 'none'));

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
          {b.canManage && !b.closed && !b.late && <button className="btn" onClick={() => setAdding('plain')}><Icon name="plus" size={18} />Add receipts</button>}
          {b.canAddLate && <button className="btn" onClick={() => setAdding('late')}><Icon name="plus" size={18} />Add late</button>}
          <a className="btn" href={`/api/receipts/export?format=xlsx&batchId=${b.id}`}><Icon name="download" size={18} />Export</a>
        </div>
      </div>

      <CutoffPanel b={b} canSchedule={can('batch.schedule')} onRun={() => setConfirmRun(true)} onChange={() => setCutting(true)} onRemove={() => dropCutoff.mutate()} busy={runNow.isPending || dropCutoff.isPending} />
      {b.canManage && b.waitingDrafts > 0 && <div className="callout" data-testid="waiting-drafts"><Icon name="info" /><div><b>{b.waitingDrafts} draft{b.waitingDrafts === 1 ? ' is' : 's are'} waiting to join</b><span>Their Med Refs chose this batch. Each joins when it is submitted.</span></div></div>}
      {b.hidden > 0 && <div className="callout ok"><Icon name="info" /><div><b>{b.hidden} more receipt{b.hidden === 1 ? ' is' : 's are'} in this batch</b><span>at a step you do not see. They appear here when they reach you.</span></div></div>}
      {b.steps.length > 0 && !b.steps.some((s) => (b.ready[s] ?? 0) > 0) && b.count > 0 && <div className="callout ok"><Icon name="check" /><div><b>Nothing in this batch is waiting for you</b></div></div>}

      <section className="card tcard">
        <div className="panel-bar">
          <div className="chips">
            {RECEIPT_STATUSES.filter((s) => b.counts[s]).map((s) => <span key={s} className="chip">{STATUS_LABEL[s]}<span className="n">{b.counts[s]}</span></span>)}
            {b.lateCount > 0 && <span className="chip" data-testid="late-count">Added late<span className="n">{b.lateCount}</span></span>}
          </div>
        </div>
        <div className="panel-body">
          {people.map(([pid, name]) => {
            const mine = b.receipts.filter((r) => r.encoder.id === pid);
            return (
              <div key={pid} className="paygrp">
                <div className="card-h"><h2>{name}</h2><small>{mine.length} receipt{mine.length === 1 ? '' : 's'} · {money(mine.reduce((s, r) => s + Math.round(r.amount * 100), 0) / 100)}</small></div>
                {mine.map((r) => (
                  <div key={r.id} className="bat-line">
                    <div className="bat-main"><ReceiptRow r={r} showEncoder={false} hideBatch /></div>
                    <div className="bat-tags">
                      {r.batchLateAt && <button type="button" className="pill late" title={`Added late, ${fmtDateTime(r.batchLateAt)}: ${r.batchLateNote ?? ''}`} aria-label={`${r.refNo} was added late: ${r.batchLateNote ?? ''}`} onClick={() => toast(`Added late, ${fmtDateTime(r.batchLateAt)}: ${r.batchLateNote ?? ''}`)}>Late</button>}
                      {r.readyFor && <span className="pill s-chk" title="Waiting for you">{BATCH_STEP_LABEL[r.readyFor]}</span>}
                      {b.canManage && r.canRemove && <button className="btn sm ghost" aria-label={`Remove ${r.refNo} from the batch`} title="Remove from the batch" disabled={remove.isPending} onClick={() => remove.mutate(r.id)}><Icon name="x" size={16} /></button>}
                    </div>
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
            <span className="muted" style={{ alignSelf: 'center', fontSize: '.84rem' }}>{b.closed ? 'Closed: receipts can only be added late, with a reason. Its receipts carry on as usual.' : b.cutoff?.state === 'pending' ? 'Closing now cancels its cutoff: nothing more is added.' : 'Closing stops more receipts being added.'}</span>
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
      {adding && <AddReceipts batch={b} late={adding === 'late'} onClose={(list) => { setAdding(false); if (list) setResults({ title: 'Some receipts were not added', hint: 'These could not go into the batch:', list }); }} />}
      {cutting && <CutoffDialog batch={b} onClose={() => setCutting(false)} onRan={(r) => { refresh(); toast(runText(r, b.cutoff?.timeZone ?? b.timeZone)); }} />}
      {confirmRun && b.cutoff?.at && (
        <Modal title={`Run the cutoff of ${b.code} now?`} onClose={() => setConfirmRun(false)}>
          <p style={{ marginTop: 0 }}>It takes {b.wouldAdd ? `the ${b.wouldAdd.count} matching receipt${b.wouldAdd.count === 1 ? '' : 's'} (${money(b.wouldAdd.total)})` : 'the matching receipts'} now and closes the batch, instead of waiting for {fmtCutoff(b.cutoff.at, b.cutoff.timeZone)}.{b.schedule ? ' This uses up that cutoff: the schedule’s next batch gets the one after it.' : ''}</p>
          <div className="btns"><button className="btn" onClick={() => setConfirmRun(false)}>Cancel</button><button className="btn pri" disabled={runNow.isPending} onClick={() => runNow.mutate()}>{runNow.isPending ? 'Running…' : 'Run cutoff now'}</button></div>
        </Modal>
      )}
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

