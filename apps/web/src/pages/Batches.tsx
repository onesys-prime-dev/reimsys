import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { RECEIPT_STATUSES, STATUS_LABEL, batchWaitingText, fmtCutoff, type CutoffRule } from '@reimsys/shared';
import { api, errMsg, fmtDateTime, money } from '../api';
import { useAuth } from '../auth';
import { NowPreview, RuleFields, defaultRule, fromZonedInput, ruleWords, toZonedInput, useRuleChoices } from '../components/Cutoffs';
import type { BatchSummary } from '../types';
import { Empty, Field, Icon, Modal, useToast } from '../ui';
import { BatchSchedulesTab } from './BatchSchedules';

/** Asks for an optional name (and, if wanted, a cutoff) and makes a new batch, then opens it. */
export function NewBatchDialog({ onClose, receiptIds }: { onClose: () => void; receiptIds?: number[] }) {
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { can } = useAuth();
  const list = useQuery({ queryKey: ['batches', 'open'], queryFn: () => api<{ timeZone?: string }>('/batches?state=open') });
  const tz = list.data?.timeZone ?? 'Asia/Manila';
  const [name, setName] = useState('');
  const [withCutoff, setWithCutoff] = useState(false);
  const [when, setWhen] = useState('');
  const [rule, setRule] = useState<CutoffRule>(defaultRule());
  const { locations, people } = useRuleChoices();
  const at = withCutoff ? fromZonedInput(when || toZonedInput(new Date(Date.now() + 86_400_000).toISOString(), tz), tz) : null;
  const past = !!at && at.getTime() <= Date.now();
  const make = useMutation({
    mutationFn: () => api<{ batch: { id: number; code: string }; added?: { added: number; skipped: number } }>('/batches', { method: 'POST', body: { name: name.trim() || undefined, receiptIds, ...(at ? { cutoffAt: at.toISOString(), cutoffRule: rule } : {}) } }),
    onSuccess: (d) => {
      toast(`Batch ${d.batch.code} made${d.added ? `, ${d.added.added} receipt${d.added.added === 1 ? '' : 's'} added${d.added.skipped ? `, ${d.added.skipped} skipped` : ''}` : ''}${at ? `. It fills and closes at ${fmtCutoff(at, tz)}` : ''}.`);
      for (const k of ['batches', 'receipts']) qc.invalidateQueries({ queryKey: [k] });
      onClose();
      nav(`/batches/${d.batch.id}`);
    },
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  return (
    <Modal title="New batch" onClose={onClose} className={withCutoff ? 'wide sf' : ''}>
      <div className={withCutoff ? 'sf-body' : ''}>
        <p style={withCutoff ? { margin: 0 } : undefined}>The code is given automatically. A name helps people find it, for example the branch or the week.</p>
        <Field label="Name" hint="Optional"><input type="text" value={name} maxLength={80} autoFocus onChange={(e) => setName(e.target.value)} placeholder="Pasig week 3" /></Field>
        <label className="chk" style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '12px 0' }}><input type="checkbox" checked={withCutoff} onChange={(e) => { setWithCutoff(e.target.checked); if (e.target.checked && !when) setWhen(toZonedInput(new Date(Date.now() + 86_400_000).toISOString(), tz)); }} />Fill and close it automatically at a set time (a cutoff)</label>
        {withCutoff && (
          <>
            <label className="f"><span>Cutoff <span className="hint">{tz}</span></span><input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Cutoff date and time" /></label>
            {at && <small className={past ? 'err' : 'muted'}>{fmtCutoff(at, tz)}{past ? ': this time has passed. Choose a time still to come.' : ''}</small>}
            <RuleFields rule={rule} onChange={setRule} canUseInProgress={can('receipt.view_all')} locations={locations} people={people} />
            <div className="callout" style={{ margin: 0 }}><Icon name="info" /><div><span>{ruleWords(rule, locations, people)}</span><NowPreview rule={rule} endpoint="/batches/cutoff-preview" /></div></div>
          </>
        )}
      </div>
      <div className={withCutoff ? 'sf-foot' : 'btns'}><button className="btn" onClick={onClose}>Cancel</button><button className="btn pri" disabled={make.isPending || (withCutoff && (!at || past))} onClick={() => make.mutate()}>{make.isPending ? 'Making…' : 'Make batch'}</button></div>
    </Modal>
  );
}

/** "Cutoff Fri 20 Nov, 5:00 PM", "Closed at cutoff", or nothing. */
const cutoffLine = (b: BatchSummary) =>
  b.cutoffState === 'pending' && b.cutoffAt ? `Cutoff ${fmtCutoff(b.cutoffAt, b.timeZone)}` : b.cutoffState === 'ran' ? 'Closed at cutoff' : b.schedule && !b.schedule.isOn && !b.closed && !b.cutoffAt && b.cutoffState === 'none' ? 'Schedule paused' : '';

export function BatchesPage() {
  const nav = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') === 'schedules' && can('batch.schedule') ? 'schedules' : 'batches';
  const [state, setState] = useState<'open' | 'closed' | 'all'>('open');
  const [q, setQ] = useState('');
  const [code, setCode] = useState('');
  const [making, setMaking] = useState(false);
  const params = new URLSearchParams({ state, ...(q.trim() ? { q: q.trim() } : {}) });
  const list = useQuery({ queryKey: ['batches', params.toString()], queryFn: () => api<{ canManage: boolean; batches: BatchSummary[] }>(`/batches?${params}`), placeholderData: (p) => p, enabled: tab === 'batches' });
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
        {tab === 'batches' && list.data?.canManage && <button className="btn pri" onClick={() => setMaking(true)}><Icon name="plus" size={18} />New batch</button>}
      </div>
      {can('batch.schedule') && (
        <div className="tabs" role="tablist" aria-label="Batches or cutoff schedules">
          <button role="tab" aria-selected={tab === 'batches'} className={tab === 'batches' ? 'on' : ''} onClick={() => setSp({}, { replace: true })}>Batches</button>
          <button role="tab" aria-selected={tab === 'schedules'} className={tab === 'schedules' ? 'on' : ''} onClick={() => setSp({ tab: 'schedules' }, { replace: true })}>Cutoff schedules</button>
        </div>
      )}
      {tab === 'schedules' ? <section className="card tcard"><BatchSchedulesTab /></section> : (
        <>
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
                const cut = cutoffLine(b);
                return (
                  <Link key={b.id} className="rep-row" to={`/batches/${b.id}`} style={{ color: 'inherit', textDecoration: 'none' }} data-testid="batch-row">
                    <div style={{ minWidth: 0 }}>
                      <b>{b.code}</b>{b.name && <span> · {b.name}</span>}{b.closed && <span className="pill s-draft" style={{ marginLeft: 8 }}>Closed</span>}
                      {cut && <span className={`pill ${b.cutoffState === 'pending' ? 's-chk' : 's-draft'}`} style={{ marginLeft: 8 }} data-testid="cutoff-pill">{cut}</span>}
                      <small className="muted" style={{ display: 'block' }}>
                        {b.count} receipt{b.count === 1 ? '' : 's'}{b.count ? ` · ${RECEIPT_STATUSES.filter((s) => b.counts[s]).map((s) => `${b.counts[s]} ${STATUS_LABEL[s].toLowerCase()}`).join(', ')}` : ''} · {b.schedule ? `cutoff schedule “${b.schedule.name}”` : `made by ${b.createdBy.name}`}, {fmtDateTime(b.createdAt)}
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
        </>
      )}
      {making && <NewBatchDialog onClose={() => setMaking(false)} />}
    </>
  );
}
