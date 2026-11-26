import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import {
  CUTOFF_DATE_LABEL, CUTOFF_STATUS_LABEL, cutoffRuleSchema, describeCutoffRule, fmtCutoff, zonedDate, zonedTime,
  type CutoffDateChoice, type CutoffRule, type CutoffStatusChoice,
} from '@reimsys/shared';
import { ApiError, api, errMsg, money } from '../api';
import type { BatchDetail } from '../types';
import { Icon, Modal, useToast } from '../ui';

export interface Named { id: number; name: string }
export interface RunResult { kind: 'ran' | 'empty' | 'cancelled'; added?: number; total?: number; parts?: { id: number; code: string; count: number }[]; next?: string | null }

/** "2026-11-20T17:00" as the clock shows it in the time zone (for a date-and-time box). */
export function toZonedInput(iso: string | null | undefined, timeZone: string) {
  if (!iso) return '';
  const t = new Date(iso);
  const z = zonedDate(t, timeZone);
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t);
  return `${z.iso}T${hm}`;
}
/** The instant a date-and-time box means, read in the time zone (not the computer's), or null when it is incomplete. */
export function fromZonedInput(v: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v);
  if (!m) return null;
  return zonedTime(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]) * 60 + Number(m[5]), timeZone);
}

export const runText = (r: RunResult, timeZone: string) => {
  if (r.kind === 'cancelled') return 'The batch was already closed, so its cutoff was cancelled.';
  if (r.kind === 'empty') return `Nothing matched, so nothing was added.${r.next ? ` The batch waits for the next cutoff, ${fmtCutoff(r.next, timeZone)}.` : ' The batch stays open without a cutoff.'}`;
  const parts = r.parts?.length ? ` The rest went into ${r.parts.map((p) => `${p.code} (${p.count})`).join(', ')}.` : '';
  return `${r.added} receipt${r.added === 1 ? '' : 's'} added and the batch is closed.${parts}${r.next ? ` Next cutoff: ${fmtCutoff(r.next, timeZone)}.` : ''}`;
};

function Chip({ on, children, onChange, label }: { on: boolean; children: ReactNode; onChange: () => void; label?: string }) {
  return <label className={`sf-chip ${on ? 'on' : ''}`}><input type="checkbox" checked={on} aria-label={label} onChange={onChange} /><span>{children}</span></label>;
}
const toggle = (a: number[], v: number) => (a.includes(v) ? a.filter((x) => x !== v) : [...a, v]);

/** Which receipts a cutoff takes: status, which date counts, and optionally places and people. */
export function RuleFields({ rule, onChange, canUseInProgress, locations, people }: { rule: CutoffRule; onChange: (r: CutoffRule) => void; canUseInProgress: boolean; locations: Named[]; people: Named[] }) {
  const [find, setFind] = useState('');
  const set = (patch: Partial<CutoffRule>) => onChange({ ...rule, ...patch });
  const setStatuses = (statuses: CutoffStatusChoice) => set({ statuses, date: statuses === 'approved' ? 'approved' : rule.date === 'approved' ? 'submitted' : rule.date });
  const dates: CutoffDateChoice[] = rule.statuses === 'approved' ? ['approved', 'submitted', 'receipt'] : ['submitted', 'receipt'];
  const shownPeople = people.filter((p) => !find.trim() || p.name.toLowerCase().includes(find.trim().toLowerCase()));
  return (
    <div className="cut-rule" data-testid="rule-fields">
      <div className="cut-f"><span>Which receipts</span>
        <div className="seg" role="group" aria-label="Which receipts">
          <button type="button" className={rule.statuses === 'approved' ? 'on' : ''} onClick={() => setStatuses('approved')}>Approved only</button>
          {canUseInProgress && <button type="button" className={rule.statuses === 'in_progress' ? 'on' : ''} onClick={() => setStatuses('in_progress')}>Anything in progress</button>}
        </div>
        <small className="muted">{CUTOFF_STATUS_LABEL[rule.statuses]}. Returned and on-hold receipts are never taken; add those by hand.{!canUseInProgress && ' You can take approved receipts only, because earlier steps are not shown to you.'}</small>
      </div>
      <label className="f"><span>Which date counts</span>
        <select value={rule.date} onChange={(e) => set({ date: e.target.value as CutoffDateChoice })} aria-label="Which date counts">
          {dates.map((d) => <option key={d} value={d}>{CUTOFF_DATE_LABEL[d]}</option>)}
        </select>
      </label>
      <div className="cut-f"><span>Charged to <span className="hint">None ticked = every place</span></span>
        <div className="sf-chips" role="group" aria-label="Places">
          {locations.map((l) => <Chip key={l.id} on={rule.chargeLocationIds.includes(l.id)} onChange={() => set({ chargeLocationIds: toggle(rule.chargeLocationIds, l.id) })}>{l.name}</Chip>)}
          {!locations.length && <small className="muted">No places to choose from.</small>}
        </div>
      </div>
      <div className="cut-f"><span>From <span className="hint">None ticked = everyone</span></span>
        {people.length > 8 && <input type="search" className="sf-find" placeholder="Find a person" aria-label="Find a person" value={find} onChange={(e) => setFind(e.target.value)} />}
        <div className="sf-chips" role="group" aria-label="People">
          {shownPeople.map((p) => <Chip key={p.id} on={rule.encoderIds.includes(p.id)} onChange={() => set({ encoderIds: toggle(rule.encoderIds, p.id) })}>{p.name}</Chip>)}
          {!people.length && <small className="muted">Nobody to choose from.</small>}
        </div>
      </div>
    </div>
  );
}

/** The rule in plain words, with the names of the chosen places and people. */
export const ruleWords = (rule: CutoffRule, locations: Named[], people: Named[]) =>
  describeCutoffRule(rule, { locations: locations.filter((l) => rule.chargeLocationIds.includes(l.id)).map((l) => l.name), people: people.filter((p) => rule.encoderIds.includes(p.id)).map((p) => p.name) });

/** "If it ran now: 12 receipts, ₱34,500.00", asked again shortly after the rule stops changing. */
export function NowPreview({ rule, endpoint, timeZone }: { rule: CutoffRule; endpoint: string; timeZone?: string }) {
  const key = JSON.stringify(rule);
  const [settled, setSettled] = useState(key);
  useEffect(() => { const t = setTimeout(() => setSettled(key), 350); return () => clearTimeout(t); }, [key]);
  const q = useQuery({ queryKey: ['cutoff-preview', endpoint, settled, timeZone], queryFn: () => api<{ count: number; total: number }>(endpoint, { method: 'POST', body: { rule: JSON.parse(settled), timeZone } }), placeholderData: (p) => p });
  return <span className="muted" data-testid="now-preview">{q.data && key === settled && !q.isFetching ? `If it ran now: ${q.data.count} receipt${q.data.count === 1 ? '' : 's'}, ${money(q.data.total)}` : 'Counting…'}</span>;
}

export const defaultRule = (): CutoffRule => cutoffRuleSchema.parse({ statuses: 'approved' });
export const useRuleChoices = () => {
  const loc = useQuery({ queryKey: ['charge-locations'], queryFn: () => api<{ locations: Named[] }>('/charge-locations') });
  const ppl = useQuery({ queryKey: ['encoders'], queryFn: () => api<{ people: Named[] }>('/receipts/encoders') });
  return { locations: loc.data?.locations ?? [], people: ppl.data?.people ?? [] };
};

/** Set or change one batch's cutoff: a time (read in the system time zone) and the rule. A time already past asks to run it now. */
export function CutoffDialog({ batch, onClose, onRan }: { batch: BatchDetail; onClose: () => void; onRan: (r: RunResult) => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const tz = batch.cutoff?.timeZone ?? batch.timeZone;
  const { locations, people } = useRuleChoices();
  const [when, setWhen] = useState(() => toZonedInput(batch.cutoffAt ?? new Date(Date.now() + 86_400_000).toISOString(), tz));
  const [rule, setRule] = useState<CutoffRule>(batch.cutoff?.rule ?? defaultRule());
  const [askRun, setAskRun] = useState(false);
  const at = fromZonedInput(when, tz);
  const save = useMutation({
    mutationFn: (runNow: boolean) => api<{ ok?: boolean; ran?: RunResult }>(`/batches/${batch.id}/cutoff`, { method: 'PUT', body: { cutoffAt: at!.toISOString(), cutoffRule: rule, runNow } }),
    onSuccess: (d) => {
      for (const k of ['batch', 'batches', 'receipts']) qc.invalidateQueries({ queryKey: [k] });
      onClose();
      if (d.ran) onRan(d.ran); else toast(`Cutoff set: ${fmtCutoff(at!, tz)}.`);
    },
    onError: (e) => { if (e instanceof ApiError && e.code === 'CUTOFF_PAST') setAskRun(true); else toast(errMsg(e), 'bad'); },
  });
  const past = !!at && at.getTime() <= Date.now();
  return (
    <Modal title={batch.cutoff ? `Change the cutoff of ${batch.code}` : `Give ${batch.code} a cutoff`} onClose={onClose} className="wide sf">
      <div className="sf-body">
        <p style={{ marginTop: 0 }}>At the cutoff the batch takes every matching receipt that is in no other batch, then closes. {batch.schedule ? `This changes this batch only; the schedule “${batch.schedule.name}” carries on as set.` : ''}</p>
        <label className="f"><span>Cutoff <span className="hint">{tz}</span></span><input type="datetime-local" value={when} onChange={(e) => { setWhen(e.target.value); setAskRun(false); }} aria-label="Cutoff date and time" /></label>
        {at && <small className="muted">{fmtCutoff(at, tz)}{past ? ' · this time has passed' : ''}</small>}
        <RuleFields rule={rule} onChange={setRule} canUseInProgress={batch.canUseInProgress} locations={locations} people={people} />
        <div className="callout" style={{ margin: 0 }}><Icon name="info" /><div><span>{ruleWords(rule, locations, people)}</span><NowPreview rule={rule} endpoint="/batches/cutoff-preview" /></div></div>
        {(askRun || past) && <div className="callout bad" style={{ margin: 0 }} role="alert"><Icon name="info" /><div><b>That time has passed</b><span>Run the cutoff now with this rule, or choose a later time.</span></div></div>}
      </div>
      <div className="sf-foot">
        <button className="btn" type="button" onClick={onClose}>Cancel</button>
        {past
          ? <button className="btn pri" type="button" disabled={!at || save.isPending} onClick={() => save.mutate(true)}>{save.isPending ? 'Running…' : 'Run it now'}</button>
          : <button className="btn pri" type="button" disabled={!at || save.isPending} onClick={() => save.mutate(false)}>{save.isPending ? 'Saving…' : 'Save cutoff'}</button>}
      </div>
    </Modal>
  );
}
