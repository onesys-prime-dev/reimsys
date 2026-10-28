import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, EMAIL_TIMING_SECTION, WEEKDAYS, appSettingsSchema, describeSchedule, parseDays, type AppSettings } from '@reimsys/shared';
import { api, errMsg } from '../api';
import { Icon, Switch, useToast } from '../ui';

interface Data { settings: AppSettings; defaults: AppSettings }
const KEYS = EMAIL_TIMING_SECTION.items.map((i) => i.key);

/** When the daily summary and the waiting-receipt reminders go out. Saved with the other settings, but changed here, next to the schedules. */
export function EmailTimingCard() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['app-settings'], queryFn: () => api<Data>('/app-settings') });
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  useEffect(() => { if (q.data && draft === null) setDraft(Object.fromEntries(KEYS.map((k) => [k, q.data!.settings[k]]))); }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: (body: unknown) => api<Data>('/app-settings', { method: 'PUT', body }),
    onSuccess: (d) => { qc.setQueryData(['app-settings'], d); setDraft(Object.fromEntries(KEYS.map((k) => [k, d.settings[k]]))); toast('Saved. The new times apply now.'); },
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  if (!q.data || !draft) return null;
  const { settings, defaults } = q.data;
  // The server may be older than this page: then it does not know these settings and they are left out.
  if (!(KEYS[0]! in settings)) return null;
  const merged = { ...settings, ...draft };
  const parsed = appSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...merged });
  const errs: Record<string, string> = {};
  if (!parsed.success) for (const i of parsed.error.issues) if (KEYS.includes(i.path[0] as keyof AppSettings)) errs[String(i.path[0])] ||= i.message;
  const dirty = KEYS.some((k) => draft[k] !== settings[k]);
  const set = (k: string, v: unknown) => setDraft((d) => ({ ...(d ?? {}), [k]: v }));
  const rules = { emailDays: String(draft.emailDays ?? ''), emailTimeZone: String(draft.emailTimeZone ?? ''), emailLateHours: Number(draft.emailLateHours ?? 0) };
  return (
    <section className="card" style={{ marginBottom: 16 }} data-testid="email-timing">
      <div className="card-h"><h3>{EMAIL_TIMING_SECTION.title}</h3><small>{EMAIL_TIMING_SECTION.help}</small></div>
      <div className="card-b" style={{ display: 'grid', gap: 14 }}>
        {EMAIL_TIMING_SECTION.items.map((it) => {
          const same = draft[it.key] === defaults[it.key];
          return (
            <div key={it.key} style={{ display: 'flex', gap: 14, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 280px', minWidth: 0 }}>
                <b>{it.label}</b>
                {it.help && <div className="muted" style={{ fontSize: '.86rem' }}>{it.help}</div>}
                {!same && <small className="muted">Default: {it.kind === 'bool' ? (defaults[it.key] ? 'On' : 'Off') : it.kind === 'days' ? (parseDays(String(defaults[it.key])) ?? []).map((d) => WEEKDAYS[d]).join(', ') : `${defaults[it.key]} ${it.unit ?? ''}`}</small>}
                {errs[it.key] && <span className="err" style={{ display: 'block' }}>{errs[it.key]}</span>}
              </div>
              {it.kind === 'bool' ? (
                <Switch checked={!!draft[it.key]} label={it.label} onChange={(v) => set(it.key, v)} />
              ) : it.kind === 'time' ? (
                <input type="time" style={{ width: 140 }} value={String(draft[it.key] ?? '')} aria-label={it.label} onChange={(e) => set(it.key, e.target.value)} />
              ) : it.kind === 'days' ? (
                <div role="group" aria-label={it.label} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                    const on = (parseDays(String(draft[it.key] ?? '')) ?? []).includes(d);
                    return <button key={d} type="button" className={`btn sm ${on ? 'pri' : ''}`} aria-pressed={on} onClick={() => { const cur = new Set(parseDays(String(draft[it.key] ?? '')) ?? []); if (on) cur.delete(d); else cur.add(d); set(it.key, [...cur].sort((a, b) => a - b).join(',')); }}>{WEEKDAYS[d]}</button>;
                  })}
                </div>
              ) : it.kind === 'text' ? (
                <input type="text" style={{ flex: '1 1 320px', minWidth: 0 }} value={String(draft[it.key] ?? '')} aria-label={it.label} onChange={(e) => set(it.key, e.target.value)} />
              ) : (
                <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="number" style={{ width: 110 }} step={it.step} value={String(draft[it.key] ?? '')} aria-label={it.label} onChange={(e) => set(it.key, e.target.value)} />
                  <span className="muted">{it.unit}</span>
                </label>
              )}
            </div>
          );
        })}
        <div className="callout" data-testid="email-schedule" style={{ margin: 0 }}><Icon name="info" /><div>
          <span style={{ display: 'block' }}>{describeSchedule('The daily summary', { on: !!draft.digestOn, time: String(draft.digestTime ?? ''), ...rules })}</span>
          <span style={{ display: 'block' }}>{describeSchedule('The waiting-receipt reminder', { on: !!draft.reminderOn, time: String(draft.reminderTime ?? ''), ...rules })}</span>
        </div></div>
        <div className="formbar" style={{ justifyContent: 'flex-end', margin: 0 }}>
          <button className="btn" type="button" disabled={!dirty} onClick={() => setDraft(Object.fromEntries(KEYS.map((k) => [k, settings[k]])))}>Undo my edits</button>
          <button className="btn pri" type="button" disabled={!dirty || !parsed.success || save.isPending} onClick={() => parsed.success && save.mutate({ ...settings, ...Object.fromEntries(KEYS.map((k) => [k, parsed.data[k]])) })}>Save times</button>
        </div>
      </div>
    </section>
  );
}
