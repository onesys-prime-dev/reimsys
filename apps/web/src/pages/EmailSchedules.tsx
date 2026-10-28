import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { INTERVAL_CHOICES, REMINDER_LABEL, SCHEDULE_STEPS, WEEKDAYS, describeEmailSchedule, emailScheduleSchema } from '@reimsys/shared';
import { api, errMsg, fmtDateTime } from '../api';
import { EmailTimingCard } from '../components/EmailTiming';
import { Icon, Modal, Switch, useToast } from '../ui';

interface Schedule {
  id: number; name: string; isOn: boolean; steps: string[]; minDays: number; roleIds: number[]; userIds: number[]; intervalMinutes: number;
  startTime: string; endTime: string; days: number[]; timeZone: string; lastSentAt: string | null; lastCount: number; recipientCount: number;
}
interface Choices { roles: { id: number; name: string }[]; people: { id: number; name: string; role: string }[] }
interface Preview { recipients: number; wouldSend: { id: number; name: string; role: string; receipts: number; first: string[] }[]; nothingWaiting: string[] }

const BLANK = { name: '', isOn: true, steps: ['check', 'decide', 'pay'] as string[], minDays: 0, roleIds: [] as number[], userIds: [] as number[], intervalMinutes: 60, startTime: '08:00', endTime: '18:00', days: [1, 2, 3, 4, 5, 6], timeZone: 'Asia/Manila' };
type Draft = typeof BLANK;
const toggle = <T,>(a: T[], v: T) => (a.includes(v) ? a.filter((x) => x !== v) : [...a, v]);

/** Your own reminder emails: a list of the receipts waiting, sent to chosen roles and people, how often you say, inside the hours you say. */
export function EmailSchedulesTab() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['email-schedules'], queryFn: () => api<{ schedules: Schedule[] }>('/email-schedules') });
  const choices = useQuery({ queryKey: ['email-schedules', 'choices'], queryFn: () => api<Choices>('/email-schedules/choices') });
  const [editing, setEditing] = useState<{ id: number | null; draft: Draft } | null>(null);
  const [preview, setPreview] = useState<{ name: string; data: Preview } | null>(null);
  const [removing, setRemoving] = useState<Schedule | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['email-schedules'] });

  const save = useMutation({
    mutationFn: (v: { id: number | null; draft: Draft }) => api(v.id ? `/email-schedules/${v.id}` : '/email-schedules', { method: v.id ? 'PATCH' : 'POST', body: v.draft }),
    onSuccess: () => { setEditing(null); refresh(); toast('Saved.'); },
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  const flip = useMutation({
    mutationFn: (v: { id: number; isOn: boolean }) => api(`/email-schedules/${v.id}`, { method: 'PATCH', body: { isOn: v.isOn } }),
    onSuccess: refresh,
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  const del = useMutation({
    mutationFn: (id: number) => api(`/email-schedules/${id}`, { method: 'DELETE' }),
    onSuccess: () => { setRemoving(null); refresh(); toast('Deleted.'); },
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  const now = useMutation({
    mutationFn: (id: number) => api<{ sent: number }>(`/email-schedules/${id}/send-now`, { method: 'POST', body: {} }),
    onSuccess: (d) => { refresh(); toast(d.sent ? `Sent to ${d.sent} ${d.sent === 1 ? 'person' : 'people'}.` : 'Nothing is waiting for anyone on the list, so nothing was sent.'); },
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  const look = useMutation({
    mutationFn: (s: Schedule) => api<Preview>(`/email-schedules/${s.id}/preview`, { method: 'POST', body: {} }).then((data) => ({ name: s.name, data })),
    onSuccess: setPreview,
    onError: (e) => toast(errMsg(e), 'bad'),
  });

  const list = q.data?.schedules ?? [];
  return (
    <>
      <EmailTimingCard />
      <div className="callout"><Icon name="info" /><div><b>Your own reminder emails</b><span>Each schedule emails a list of the receipts that are waiting to the roles and people you choose, as often as you set (at least every 30 minutes), only inside the hours and days you set. Nobody is told about a receipt they encoded themselves, and nothing is sent when nothing is waiting.</span></div></div>
      {list.map((s) => (
        <section className="card" key={s.id} style={{ marginBottom: 12 }} data-testid="schedule-card">
          <div className="card-h" style={{ gap: 10, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>{s.name}</h3>
            <small>{s.recipientCount} {s.recipientCount === 1 ? 'person' : 'people'} · {s.lastSentAt ? `last sent ${fmtDateTime(s.lastSentAt)} to ${s.lastCount}` : 'not sent yet'}</small>
            <Switch checked={s.isOn} label={`${s.name} is on`} onChange={(v) => flip.mutate({ id: s.id, isOn: v })} />
          </div>
          <div className="card-b" style={{ display: 'grid', gap: 10 }}>
            <span>{describeEmailSchedule({ ...s, steps: s.steps.join(','), days: s.days.join(',') })}</span>
            <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn sm" type="button" onClick={() => setEditing({ id: s.id, draft: { name: s.name, isOn: s.isOn, steps: s.steps, minDays: s.minDays, roleIds: s.roleIds, userIds: s.userIds, intervalMinutes: s.intervalMinutes, startTime: s.startTime, endTime: s.endTime, days: s.days, timeZone: s.timeZone } })}>Edit</button>
              <button className="btn sm" type="button" disabled={look.isPending} onClick={() => look.mutate(s)}>Preview</button>
              <button className="btn sm" type="button" disabled={now.isPending} onClick={() => now.mutate(s.id)}>Send now</button>
              <button className="btn sm ghost" type="button" onClick={() => setRemoving(s)}>Delete</button>
            </span>
          </div>
        </section>
      ))}
      {q.data && !list.length && <div className="empty" style={{ marginBottom: 12 }}><b>No schedules yet</b>Press New schedule, for example an hourly reminder to your boss.</div>}
      <button className="btn pri" type="button" onClick={() => setEditing({ id: null, draft: { ...BLANK } })}><Icon name="plus" size={18} />New schedule</button>

      {editing && <ScheduleForm choices={choices.data} initial={editing.draft} id={editing.id} busy={save.isPending} onClose={() => setEditing(null)} onSave={(draft) => save.mutate({ id: editing.id, draft })} />}
      {preview && (
        <Modal title={`Preview: ${preview.name}`} onClose={() => setPreview(null)}>
          <p style={{ marginTop: 0 }}>{preview.data.wouldSend.length ? `${preview.data.wouldSend.length} of ${preview.data.recipients} people would get an email now:` : 'Nobody would get an email now: nothing is waiting for the people on the list.'}</p>
          {preview.data.wouldSend.map((w) => (
            <div key={w.id} style={{ marginBottom: 8 }}><b>{w.name}</b> <small className="muted">{w.role} · {w.receipts} receipt{w.receipts === 1 ? '' : 's'}</small>{w.first.map((l) => <div key={l} className="muted" style={{ fontSize: '.86rem' }}>{l}</div>)}</div>
          ))}
          {preview.data.nothingWaiting.length > 0 && <p className="muted">Nothing waiting for: {preview.data.nothingWaiting.join(', ')}.</p>}
          <div className="formbar"><button className="btn" type="button" onClick={() => setPreview(null)}>Close</button></div>
        </Modal>
      )}
      {removing && (
        <Modal title="Delete this schedule?" onClose={() => setRemoving(null)}>
          <p style={{ marginTop: 0 }}>“{removing.name}” will stop sending. Emails already sent stay in the email log.</p>
          <div className="formbar"><button className="btn" type="button" onClick={() => setRemoving(null)}>Keep it</button><button className="btn pri" type="button" disabled={del.isPending} onClick={() => del.mutate(removing.id)}>Delete</button></div>
        </Modal>
      )}
    </>
  );
}

function Chip({ on, children, onChange, label }: { on: boolean; children: ReactNode; onChange: () => void; label?: string }) {
  return <label className={`sf-chip ${on ? 'on' : ''}`}><input type="checkbox" checked={on} aria-label={label} onChange={onChange} /><span>{children}</span></label>;
}

function ScheduleForm({ choices, initial, id, busy, onClose, onSave }: { choices: Choices | undefined; initial: Draft; id: number | null; busy: boolean; onClose: () => void; onSave: (d: Draft) => void }) {
  const [d, setD] = useState<Draft>(initial);
  const [find, setFind] = useState('');
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const parsed = emailScheduleSchema.safeParse(d);
  const errs: Record<string, string> = {};
  if (!parsed.success) for (const i of parsed.error.issues) errs[String(i.path[0])] ||= i.message;
  const everyone = choices?.people ?? [];
  const people = everyone.filter((p) => !find.trim() || `${p.name} ${p.role}`.toLowerCase().includes(find.trim().toLowerCase()));
  const chosen = d.userIds.map((uid) => everyone.find((p) => p.id === uid)).filter((p): p is Choices['people'][number] => !!p);
  return (
    <Modal title={id ? 'Edit schedule' : 'New schedule'} onClose={onClose} className="wide sf">
      <div className="sf-body">
        <label className="field"><span>Name</span><input type="text" value={d.name} maxLength={80} placeholder="For example: Hourly reminder to the boss" onChange={(e) => set('name', e.target.value)} />{errs.name && <span className="err">{errs.name}</span>}</label>

        <section className="sf-sec">
          <h3><b>1</b> What to list</h3>
          <p className="sf-hint">The email lists the receipts that are waiting at these steps.</p>
          <div className="sf-chips" role="group" aria-label="Steps">
            {SCHEDULE_STEPS.map((x) => <Chip key={x} on={d.steps.includes(x)} onChange={() => set('steps', toggle(d.steps, x))}>{REMINDER_LABEL[x]}</Chip>)}
          </div>
          {errs.steps && <span className="err">{errs.steps}</span>}
          <label className="sf-inline">Only receipts that have waited at least
            <input type="number" min={0} max={60} step={0.5} value={d.minDays} aria-label="Minimum days waited" onChange={(e) => set('minDays', e.target.value === '' ? 0 : Number(e.target.value))} />
            days <small className="muted">(0 = all of them)</small></label>
          {errs.minDays && <span className="err">{errs.minDays}</span>}
        </section>

        <section className="sf-sec">
          <h3><b>2</b> Who gets it</h3>
          <p className="sf-hint">Tick whole roles, or pick people one by one. Nobody is told about a receipt they encoded themselves.</p>
          <div className="sf-chips" role="group" aria-label="Roles">
            {(choices?.roles ?? []).map((r) => <Chip key={r.id} on={d.roleIds.includes(r.id)} onChange={() => set('roleIds', toggle(d.roleIds, r.id))} label={`All ${r.name}`}>All {r.name}</Chip>)}
          </div>
          {chosen.length > 0 && (
            <div className="sf-picked" aria-label="Chosen people">
              {chosen.map((p) => <span key={p.id} className="sf-pick">{p.name}<button type="button" aria-label={`Remove ${p.name}`} onClick={() => set('userIds', d.userIds.filter((x) => x !== p.id))}>×</button></span>)}
            </div>
          )}
          <input type="search" className="sf-find" placeholder="Search for a person to add" aria-label="Find a person" value={find} onChange={(e) => setFind(e.target.value)} />
          <div role="group" aria-label="People" className="sf-people">
            {people.map((p) => (
              <label key={p.id} className={d.userIds.includes(p.id) ? 'on' : ''}><input type="checkbox" checked={d.userIds.includes(p.id)} onChange={() => set('userIds', toggle(d.userIds, p.id))} /><span>{p.name}</span><small className="muted">{p.role}</small></label>
            ))}
            {choices && !people.length && <span className="muted" style={{ padding: 10 }}>Nobody matches.</span>}
          </div>
          {errs.userIds && <span className="err">{errs.userIds}</span>}
        </section>

        <section className="sf-sec">
          <h3><b>3</b> When to send</h3>
          <div className="sf-grid">
            <label className="field"><span>How often</span>
              <select value={d.intervalMinutes} onChange={(e) => set('intervalMinutes', Number(e.target.value))}>{INTERVAL_CHOICES.map((c) => <option key={c.minutes} value={c.minutes}>{c.label}</option>)}</select>
              {errs.intervalMinutes && <span className="err">{errs.intervalMinutes}</span>}</label>
            <label className="field"><span>Only from</span><input type="time" value={d.startTime} onChange={(e) => set('startTime', e.target.value)} />{errs.startTime && <span className="err">{errs.startTime}</span>}</label>
            <label className="field"><span>Until</span><input type="time" value={d.endTime} onChange={(e) => set('endTime', e.target.value)} />{errs.endTime && <span className="err">{errs.endTime}</span>}</label>
            <label className="field"><span>Time zone</span><input type="text" value={d.timeZone} onChange={(e) => set('timeZone', e.target.value)} />{errs.timeZone && <span className="err">{errs.timeZone}</span>}</label>
          </div>
          <div role="group" aria-label="Days" className="sf-chips" style={{ marginTop: 12 }}>
            {[1, 2, 3, 4, 5, 6, 0].map((x) => <button key={x} type="button" className={`btn sm ${d.days.includes(x) ? 'pri' : ''}`} aria-pressed={d.days.includes(x)} onClick={() => set('days', toggle(d.days, x))}>{WEEKDAYS[x]}</button>)}
          </div>
          {errs.days && <span className="err">{errs.days}</span>}
        </section>

        {parsed.success && <div className="callout" style={{ margin: 0 }} data-testid="schedule-sentence"><Icon name="info" /><div>{describeEmailSchedule({ ...parsed.data, minDays: parsed.data.minDays })}</div></div>}
      </div>
      <div className="sf-foot">
        <button className="btn" type="button" onClick={onClose}>Cancel</button>
        <button className="btn pri" type="button" disabled={!parsed.success || busy} onClick={() => onSave(d)}>Save schedule</button>
      </div>
    </Modal>
  );
}
