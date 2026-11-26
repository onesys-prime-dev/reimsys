import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { WEEKDAYS, batchScheduleSchema, describeScheduleTiming, fmtCutoff, nextCutoff, type CutoffRule, type MonthDay, type ScheduleRepeat } from '@reimsys/shared';
import { ApiError, api, errMsg, fmtDateTime } from '../api';
import { NowPreview, RuleFields, defaultRule, ruleWords, runText, type Named, type RunResult } from '../components/Cutoffs';
import { Icon, Modal, Switch, useToast } from '../ui';

interface Schedule {
  id: number; name: string; isOn: boolean; repeat: ScheduleRepeat; days: MonthDay[]; time: string; timeZone: string; rule: CutoffRule;
  when: string; ruleText: string; current: { id: number; code: string; cutoffAt: string | null } | null;
  lastRunAt: string | null; lastCount: number; lastBatch: { id: number; code: string } | null; overlaps: string[]; createdBy: string;
}
interface Choices { locations: Named[]; people: Named[]; timeZone: string; canUseInProgress: boolean }
interface Draft { name: string; repeat: ScheduleRepeat; days: MonthDay[]; time: string; timeZone: string; rule: CutoffRule }

const blank = (timeZone: string): Draft => ({ name: '', repeat: 'weekly', days: [5], time: '17:00', timeZone, rule: defaultRule() });
const MONTH_DAYS: MonthDay[] = [...Array.from({ length: 31 }, (_, i) => i + 1), 'L'];

/** Repeating cutoffs: each keeps one open batch and fills and closes it at its time, then opens the next. */
export function BatchSchedulesTab() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['batch-schedules'], queryFn: () => api<{ schedules: Schedule[] }>('/batch-schedules') });
  const choices = useQuery({ queryKey: ['batch-schedules', 'choices'], queryFn: () => api<Choices>('/batch-schedules/choices') });
  const [editing, setEditing] = useState<{ id: number | null; draft: Draft } | null>(null);
  const [askPast, setAskPast] = useState<{ message: string; id: number; draft: Draft } | null>(null);
  const [removing, setRemoving] = useState<Schedule | null>(null);
  const refresh = () => { for (const k of ['batch-schedules', 'batches', 'batch']) void qc.invalidateQueries({ queryKey: [k] }); };

  const save = useMutation({
    mutationFn: (v: { id: number | null; draft: Draft; whenPast?: 'run' | 'skip' }) =>
      api<{ ran?: RunResult; batch?: { code: string; cutoffAt: string } | null }>(v.id ? `/batch-schedules/${v.id}` : '/batch-schedules', { method: v.id ? 'PATCH' : 'POST', body: { ...v.draft, ...(v.whenPast ? { whenPast: v.whenPast } : {}) } }),
    onSuccess: (d, v) => {
      setEditing(null); setAskPast(null); refresh();
      if (d.ran) toast(runText(d.ran, v.draft.timeZone));
      else if (d.batch) toast(`Saved. Batch ${d.batch.code} is open until ${fmtCutoff(d.batch.cutoffAt, v.draft.timeZone)}.`);
      else toast('Saved.');
    },
    onError: (e, v) => {
      if (e instanceof ApiError && e.code === 'CUTOFF_PAST' && v.id) setAskPast({ message: e.message, id: v.id, draft: v.draft });
      else toast(errMsg(e), 'bad');
    },
  });
  const flip = useMutation({
    mutationFn: (v: { id: number; isOn: boolean }) => api(`/batch-schedules/${v.id}`, { method: 'PATCH', body: { isOn: v.isOn } }),
    onSuccess: (_d, v) => { refresh(); toast(v.isOn ? 'Switched on. Its batch has its next cutoff again.' : 'Paused. Its open batch keeps its receipts, without a cutoff.'); },
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  const del = useMutation({
    mutationFn: (id: number) => api<{ kept: string | null }>(`/batch-schedules/${id}`, { method: 'DELETE' }),
    onSuccess: (d) => { setRemoving(null); refresh(); toast(d.kept ? `Deleted. Batch ${d.kept} keeps its receipts, without a cutoff.` : 'Deleted.'); },
    onError: (e) => toast(errMsg(e), 'bad'),
  });

  const list = q.data?.schedules ?? [];
  const tz = choices.data?.timeZone ?? 'Asia/Manila';
  return (
    <div className="panel-body" style={{ padding: 16 }}>
      <div className="callout"><Icon name="info" /><div><b>Cutoffs that repeat</b><span>Each schedule keeps one open batch. At its time the batch takes every matching receipt that is in no other batch, closes, and the next batch opens. Receipts that come in later go to the next run, or can be added late with a reason.</span></div></div>
      {list.map((s) => (
        <section className="card" key={s.id} style={{ marginBottom: 12 }} data-testid="cutoff-schedule">
          <div className="card-h" style={{ gap: 10, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>{s.name}</h3>
            <small>{s.lastRunAt ? <>last run {fmtDateTime(s.lastRunAt)}{s.lastBatch ? <>: <Link to={`/batches/${s.lastBatch.id}`}>{s.lastBatch.code}</Link></> : ''}, {s.lastCount} receipt{s.lastCount === 1 ? '' : 's'}</> : 'not run yet'}</small>
            <Switch checked={s.isOn} label={`${s.name} is on`} onChange={(v) => flip.mutate({ id: s.id, isOn: v })} disabled={flip.isPending} />
          </div>
          <div className="card-b" style={{ display: 'grid', gap: 8 }}>
            <span><b>{s.when}.</b> {s.ruleText}</span>
            {s.isOn && s.current?.cutoffAt && <span>Open batch: <Link to={`/batches/${s.current.id}`}>{s.current.code}</Link>, cutoff {fmtCutoff(s.current.cutoffAt, s.timeZone)}</span>}
            {!s.isOn && <span className="muted">Paused: no cutoff runs until it is switched on.</span>}
            {s.overlaps.length > 0 && <div className="callout warn" style={{ margin: 0 }}><Icon name="info" /><div><b>Overlaps with: {s.overlaps.join(', ')}</b><span>Both can take the same receipt. The earlier cutoff takes it; a receipt is never in two batches.</span></div></div>}
            <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn sm" type="button" onClick={() => setEditing({ id: s.id, draft: { name: s.name, repeat: s.repeat, days: s.days, time: s.time, timeZone: s.timeZone, rule: s.rule } })}><Icon name="edit" size={16} />Edit</button>
              <button className="btn sm ghost" type="button" onClick={() => setRemoving(s)}>Delete</button>
            </span>
          </div>
        </section>
      ))}
      {q.data && !list.length && <div className="empty" style={{ marginBottom: 12 }}><b>No cutoff schedules yet</b>For example: every Friday at 5:00 PM, take the approved receipts.</div>}
      <button className="btn pri" type="button" onClick={() => setEditing({ id: null, draft: blank(tz) })}><Icon name="plus" size={18} />New cutoff schedule</button>

      {editing && choices.data && <ScheduleForm choices={choices.data} initial={editing.draft} id={editing.id} busy={save.isPending} onClose={() => setEditing(null)} onSave={(draft) => save.mutate({ id: editing.id, draft })} />}
      {askPast && (
        <Modal title="This run’s cutoff has passed" onClose={() => setAskPast(null)}>
          <p style={{ marginTop: 0 }}>{askPast.message}</p>
          <div className="btns">
            <button className="btn" type="button" onClick={() => setAskPast(null)}>Back</button>
            <button className="btn" type="button" disabled={save.isPending} onClick={() => save.mutate({ id: askPast.id, draft: askPast.draft, whenPast: 'skip' })}>Skip to the next one</button>
            <button className="btn pri" type="button" disabled={save.isPending} onClick={() => save.mutate({ id: askPast.id, draft: askPast.draft, whenPast: 'run' })}>Run it now</button>
          </div>
        </Modal>
      )}
      {removing && (
        <Modal title={`Delete “${removing.name}”?`} onClose={() => setRemoving(null)}>
          <p style={{ marginTop: 0 }}>No more cutoffs run. Its open batch {removing.current ? `(${removing.current.code}) ` : ''}is deleted if empty; otherwise it keeps its receipts, without a cutoff. Batches it already closed stay as they are.</p>
          <div className="btns"><button className="btn" type="button" onClick={() => setRemoving(null)}>Keep it</button><button className="btn bad" type="button" disabled={del.isPending} onClick={() => del.mutate(removing.id)}>Delete</button></div>
        </Modal>
      )}
    </div>
  );
}

function ScheduleForm({ choices, initial, id, busy, onClose, onSave }: { choices: Choices; initial: Draft; id: number | null; busy: boolean; onClose: () => void; onSave: (d: Draft) => void }) {
  const [d, setD] = useState<Draft>(initial);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const parsed = batchScheduleSchema.safeParse(d);
  const errs: Record<string, string> = {};
  if (!parsed.success) for (const i of parsed.error.issues) errs[String(i.path[0])] ||= i.message;
  const first = parsed.success ? nextCutoff(parsed.data, new Date()) : null;
  const toggleDay = (x: MonthDay) => set('days', d.days.includes(x) ? d.days.filter((y) => y !== x) : [...d.days, x]);
  const setRepeat = (r: ScheduleRepeat) => setD((x) => ({ ...x, repeat: r, days: r === x.repeat ? x.days : r === 'weekly' ? [5] : [15, 'L'] }));
  return (
    <Modal title={id ? 'Edit cutoff schedule' : 'New cutoff schedule'} onClose={onClose} className="wide sf">
      <div className="sf-body">
        <label className="f"><span>Name</span><input type="text" value={d.name} maxLength={60} placeholder="For example: Weekly run Pasig" onChange={(e) => set('name', e.target.value)} />{errs.name && <span className="err">{errs.name}</span>}</label>
        <section className="sf-sec">
          <h3><b>1</b> When</h3>
          <div className="seg" role="group" aria-label="Repeat" style={{ width: 'fit-content' }}>
            <button type="button" className={d.repeat === 'weekly' ? 'on' : ''} onClick={() => setRepeat('weekly')}>Weekly</button>
            <button type="button" className={d.repeat === 'monthly' ? 'on' : ''} onClick={() => setRepeat('monthly')}>Monthly</button>
          </div>
          <div className="sched-days" role="group" aria-label="Days">
            {d.repeat === 'weekly'
              ? [1, 2, 3, 4, 5, 6, 0].map((x) => <button key={x} type="button" className={`btn sm ${d.days.includes(x) ? 'pri' : ''}`} aria-pressed={d.days.includes(x)} onClick={() => toggleDay(x)}>{WEEKDAYS[x]}</button>)
              : MONTH_DAYS.map((x) => <button key={x} type="button" className={`btn sm ${d.days.includes(x) ? 'pri' : ''}`} aria-pressed={d.days.includes(x)} onClick={() => toggleDay(x)}>{x === 'L' ? 'Last day' : x}</button>)}
          </div>
          {errs.days && <span className="err">{errs.days}</span>}
          <div className="sf-grid">
            <label className="f"><span>Time</span><input type="time" value={d.time} onChange={(e) => set('time', e.target.value)} />{errs.time && <span className="err">{errs.time}</span>}</label>
            <label className="f"><span>Time zone</span><input type="text" value={d.timeZone} onChange={(e) => set('timeZone', e.target.value)} />{errs.timeZone && <span className="err">{errs.timeZone}</span>}</label>
          </div>
        </section>
        <section className="sf-sec">
          <h3><b>2</b> Which receipts</h3>
          <RuleFields rule={d.rule} onChange={(r) => set('rule', r)} canUseInProgress={choices.canUseInProgress} locations={choices.locations} people={choices.people} />
          {errs.rule && <span className="err">{errs.rule}</span>}
        </section>
        {parsed.success && (
          <div className="callout" style={{ margin: 0 }} data-testid="schedule-words"><Icon name="info" /><div>
            <b>{describeScheduleTiming(parsed.data)}.</b>
            <span>{ruleWords(d.rule, choices.locations, choices.people)}</span>
            {first && id === null && <span>First cutoff: {fmtCutoff(first, parsed.data.timeZone)}.</span>}
            <NowPreview rule={d.rule} endpoint="/batch-schedules/preview" timeZone={parsed.data.timeZone} />
          </div></div>
        )}
        {id !== null && <small className="muted">A change also applies to its open batch. Batches it already closed stay as they are.</small>}
      </div>
      <div className="sf-foot">
        <button className="btn" type="button" onClick={onClose}>Cancel</button>
        <button className="btn pri" type="button" disabled={!parsed.success || busy} onClick={() => onSave(d)}>Save schedule</button>
      </div>
    </Modal>
  );
}
