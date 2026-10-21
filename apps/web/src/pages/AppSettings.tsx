import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { SETTINGS_SECTIONS, appSettingsSchema, type AppSettings } from '@reimsys/shared';
import { api, errMsg } from '../api';
import { PaymentMethodsCard } from '../components/PaymentMethods';
import { Icon, Modal, Switch, useToast } from '../ui';

interface Data { settings: AppSettings; defaults: AppSettings }

/** Things an administrator may adjust. Changes apply straight away to everyone and are written to the audit log. */
export function AppSettingsTab() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['app-settings'], queryFn: () => api<Data>('/app-settings') });
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  // Start from what is saved, and pick up changes made by someone else as long as this person has not started editing.
  useEffect(() => { if (q.data && draft === null) setDraft({ ...q.data.settings }); }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const remind = useMutation({
    mutationFn: () => api<{ sent: number }>('/email-log/reminders-now', { method: 'POST', body: {} }),
    onSuccess: (d) => toast(d.sent ? `Reminders sent to ${d.sent} ${d.sent === 1 ? 'person' : 'people'}.` : 'Nothing has waited long enough, so no reminders were sent.'),
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  const done = (d: Data, msg: string) => { qc.setQueryData(['app-settings'], d); setDraft({ ...d.settings }); toast(msg); };
  const save = useMutation({
    mutationFn: (body: unknown) => api<Data>('/app-settings', { method: 'PUT', body }),
    onSuccess: (d) => done(d, 'Settings saved. They apply now.'),
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  const reset = useMutation({
    mutationFn: () => api<Data>('/app-settings/reset', { method: 'POST' }),
    onSuccess: (d) => { setConfirmReset(false); done(d, 'Every setting is back to its default.'); },
    onError: (e) => { setConfirmReset(false); toast(errMsg(e), 'bad'); },
  });

  if (!q.data || !draft) return <div className="empty">Loading…</div>;
  const { settings, defaults } = q.data;
  const parsed = appSettingsSchema.safeParse(draft);
  const errs: Record<string, string> = {};
  if (!parsed.success) for (const i of parsed.error.issues) errs[String(i.path[0])] ||= i.message;
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const set = (k: string, v: unknown) => setDraft((d) => ({ ...(d ?? {}), [k]: v }));
  const isDefault = JSON.stringify(settings) === JSON.stringify(defaults);

  return (
    <>
      <div className="callout"><Icon name="info" /><div><b>Changes apply straight away</b><span>Everyone gets the new rules on their next action, and each change is recorded in the audit log with the old and new value.</span></div></div>
      {SETTINGS_SECTIONS.map((sec) => (
        <section className="card" key={sec.title} style={{ marginBottom: 16 }}>
          <div className="card-h"><h3>{sec.title}</h3><small>{sec.help}</small></div>
          <div className="card-b" style={{ display: 'grid', gap: 14 }}>
            {sec.items.map((it) => {
              const same = draft[it.key] === defaults[it.key];
              return (
                <div key={it.key} style={{ display: 'flex', gap: 14, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 280px', minWidth: 0 }}>
                    <b>{it.label}</b>
                    {it.help && <div className="muted" style={{ fontSize: '.86rem' }}>{it.help}</div>}
                    {!same && <small className="muted">Default: {it.kind === 'bool' ? (defaults[it.key] ? 'On' : 'Off') : `${defaults[it.key]} ${it.unit ?? ''}`}</small>}
                    {errs[it.key] && <span className="err" style={{ display: 'block' }}>{errs[it.key]}</span>}
                  </div>
                  {it.kind === 'bool' ? (
                    <Switch checked={!!draft[it.key]} label={it.label} onChange={(v) => set(it.key, v)} />
                  ) : (
                    <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input type="number" style={{ width: 110 }} step={it.step} value={String(draft[it.key] ?? '')} aria-label={it.label} onChange={(e) => set(it.key, e.target.value)} />
                      <span className="muted">{it.unit}</span>
                    </label>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
      <PaymentMethodsCard />
      <div className="formbar" style={{ justifyContent: 'space-between' }}>
        <button className="btn" type="button" disabled={isDefault || reset.isPending} onClick={() => setConfirmReset(true)}>Reset everything to default</button>
        <span style={{ display: 'flex', gap: 10 }}>
          <button className="btn" type="button" disabled={!dirty} onClick={() => setDraft({ ...settings })}>Undo my edits</button>
          <button className="btn pri" type="button" disabled={!dirty || !parsed.success || save.isPending} onClick={() => parsed.success && save.mutate(parsed.data)}>Save settings</button>
        </span>
      </div>
      <RetentionPreview months={Number(settings.retentionMonths ?? 0)} />
      <section className="card" style={{ marginTop: 16 }}>
        <div className="card-h"><h2>Waiting-receipt reminders</h2><small>Also sent by themselves at about 9am</small></div>
        <div className="card-b" style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <span className="muted">Send the reminders now, using the days you have saved above.</span>
          <button className="btn" type="button" disabled={remind.isPending} onClick={() => remind.mutate()}>Send reminders now</button>
        </div>
      </section>
      {confirmReset && (
        <Modal title="Reset every setting?" onClose={() => setConfirmReset(false)}>
          <p>All the settings on this page go back to their default values for everyone. Receipts already saved are not changed.</p>
          <div className="btns"><button className="btn" onClick={() => setConfirmReset(false)}>Cancel</button><button className="btn bad" disabled={reset.isPending} onClick={() => reset.mutate()}>Reset</button></div>
        </Modal>
      )}
    </>
  );
}

interface Preview { enabled: boolean; months: number; cutoff?: string; total?: number; totalAmount?: number; byStatus?: Record<string, { count: number; amount: number }>; byMonth?: { month: string; count: number; amount: number }[]; oldest?: string | null; files?: { count: number; bytes: number }; note?: string }

/** Phase 1 of keeping records: shows what the keeping period would point out. It changes nothing. */
function RetentionPreview({ months }: { months: number }) {
  const toast = useToast();
  const run = useMutation({
    mutationFn: () => api<Preview>('/retention/preview'),
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  const p = run.data;
  const mb = (b: number) => (b > 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
  return (
    <section className="card" style={{ marginTop: 16 }}>
      <div className="card-h"><h2>Keeping records: what would be pointed out</h2><small>Preview only, nothing is deleted</small></div>
      <div className="card-b">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <span className="muted">{months ? `Finished receipts (paid or disapproved) older than ${months} month${months === 1 ? '' : 's'}. Save the setting above first if you changed it.` : 'The keeping period is 0 (off). Set a number of months above and save to see what it would point out.'}</span>
          <span style={{ display: 'flex', gap: 8 }}>
            <button className="btn" type="button" disabled={!months || run.isPending} onClick={() => run.mutate()}>{run.isPending ? 'Looking…' : 'Preview now'}</button>
            <a className={`btn ${months ? '' : 'disabled'}`} href="/api/retention/preview.csv" aria-disabled={!months}>Download list (CSV)</a>
          </span>
        </div>
        {p && !p.enabled && <p className="muted" style={{ marginBottom: 0 }}>The keeping period is off, so nothing is listed.</p>}
        {p?.enabled && (
          <div style={{ marginTop: 14 }}>
            <p style={{ margin: '0 0 8px' }}><b>{p.total}</b> finished receipt{p.total === 1 ? '' : 's'} older than {p.cutoff} ({new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(p.totalAmount ?? 0)} in total{p.oldest ? `, the oldest from ${p.oldest}` : ''}), with {p.files?.count ?? 0} file{p.files?.count === 1 ? '' : 's'} ({mb(p.files?.bytes ?? 0)}).</p>
            {!!p.total && (
              <div className="matrix"><table style={{ minWidth: 360 }}>
                <thead><tr><th style={{ textAlign: 'left' }}>Month</th><th style={{ textAlign: 'right' }}>Receipts</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
                <tbody>{p.byMonth?.map((m) => <tr key={m.month}><td>{m.month}</td><td style={{ textAlign: 'right' }}>{m.count}</td><td style={{ textAlign: 'right' }}>{new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(m.amount)}</td></tr>)}</tbody>
              </table></div>
            )}
            <p className="muted" style={{ margin: '10px 0 0', fontSize: '.86rem' }}>{p.note}</p>
          </div>
        )}
      </div>
    </section>
  );
}
