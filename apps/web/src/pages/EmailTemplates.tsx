import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { unknownPlaceholders, type EmailBranding, type EmailTemplate, type PlaceholderDef, type TemplateKey, type TemplateView } from '@reimsis/shared';
import { api, errMsg } from '../api';
import { useAuth } from '../auth';
import { Field, Icon, Switch, useToast } from '../ui';

interface Data { templates: TemplateView[]; branding: EmailBranding; placeholders: PlaceholderDef[]; linkIsPublic: boolean }
interface Preview { subject: string; html: string; text: string; buttonHiddenForNow: boolean }
type FieldName = 'subject' | 'heading' | 'body' | 'buttonLabel';

const same = (a: EmailTemplate, b: EmailTemplate) => a.subject === b.subject && a.heading === b.heading && a.body === b.body && a.buttonLabel === b.buttonLabel && a.showDetails === b.showDetails;

export function EmailTemplatesTab() {
  const toast = useToast();
  const qc = useQueryClient();
  const { me } = useAuth();
  const q = useQuery({ queryKey: ['email-templates'], queryFn: () => api<Data>('/settings/email-templates') });
  const [sel, setSel] = useState<TemplateKey>('returned');
  const [drafts, setDrafts] = useState<Partial<Record<TemplateKey, EmailTemplate>>>({});
  const [brand, setBrand] = useState<EmailBranding | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [phone, setPhone] = useState(false);
  const [sampleTo, setSampleTo] = useState('');
  const refs = useRef<Partial<Record<FieldName, HTMLInputElement | HTMLTextAreaElement | null>>>({});
  const lastField = useRef<FieldName>('body');

  const data = q.data;
  const view = data?.templates.find((t) => t.key === sel);
  const draft = (view && drafts[sel]) || view?.template;
  const accentOk = !!brand && /^#[0-9a-fA-F]{6}$/.test(brand.accent.trim());
  const nameOk = !!brand && brand.orgName.trim().length > 0;
  const brandOk = accentOk && nameOk;

  useEffect(() => { if (data && !brand) setBrand(data.branding); }, [data, brand]);
  useEffect(() => { if (me && !sampleTo) setSampleTo(me.email); }, [me, sampleTo]);

  const edit = (patch: Partial<EmailTemplate>) => view && setDrafts((d) => ({ ...d, [sel]: { ...(d[sel] ?? view.template), ...patch } }));

  /* live preview: what the server would actually send, using the unsaved text */
  useEffect(() => {
    if (!view || !draft || !brand) return;
    const t = setTimeout(() => {
      api<Preview>(`/settings/email-templates/${sel}/preview`, { method: 'POST', body: { template: draft, branding: brandOk ? brand : data?.branding } })
        .then((p) => { setPreview(p); setPreviewError(''); })
        .catch((e) => setPreviewError(errMsg(e)));
    }, 350);
    return () => clearTimeout(t);
  }, [sel, JSON.stringify(draft), JSON.stringify(brandOk ? brand : null), view?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const afterSave = (d: { templates: TemplateView[] }, key: TemplateKey) => {
    qc.setQueryData(['email-templates'], (old: Data | undefined) => (old ? { ...old, templates: d.templates } : old));
    setDrafts((x) => { const n = { ...x }; delete n[key]; return n; });
  };
  const save = useMutation({
    mutationFn: () => api<{ templates: TemplateView[] }>(`/settings/email-templates/${sel}`, { method: 'PUT', body: draft }),
    onSuccess: (d) => { afterSave(d, sel); toast('Saved. New emails use this wording.'); },
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  const reset = useMutation({
    mutationFn: () => api<{ templates: TemplateView[] }>(`/settings/email-templates/${sel}`, { method: 'DELETE' }),
    onSuccess: (d) => { afterSave(d, sel); toast('Back to the default wording.'); },
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  const saveBrand = useMutation({
    mutationFn: () => api<{ branding: EmailBranding }>('/settings/email-branding', { method: 'PUT', body: brand }),
    onSuccess: (d) => { qc.setQueryData(['email-templates'], (old: Data | undefined) => (old ? { ...old, branding: d.branding } : old)); setBrand(d.branding); toast('Name, footer and colour saved.'); },
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  const sendSample = useMutation({
    mutationFn: () => api<{ to: string }>(`/settings/email-templates/${sel}/send-test`, { method: 'POST', body: { to: sampleTo, template: draft } }),
    onSuccess: (d) => { toast(`Sample sent to ${d.to}. It starts with [Sample] in the subject.`); qc.invalidateQueries({ queryKey: ['email-log'] }); },
    onError: (e) => toast(errMsg(e), 'bad'),
  });

  function insert(key: string) {
    if (!draft) return;
    const name = lastField.current;
    const el = refs.current[name];
    const token = `{{${key}}}`;
    const text = draft[name] as string;
    const start = el?.selectionStart ?? text.length, end = el?.selectionEnd ?? text.length;
    edit({ [name]: text.slice(0, start) + token + text.slice(end) });
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(start + token.length, start + token.length); });
  }

  if (!data || !brand) return <div className="empty">Loading…</div>;
  if (!view || !draft) return null;
  const unknown = unknownPlaceholders(draft, sel);
  const dirty = !same(draft, view.template);
  const brandDirty = JSON.stringify(brand) !== JSON.stringify(data.branding);
  const mine = data.placeholders.filter((p) => view.allowed.includes(p.key));
  const bind = (name: FieldName) => ({ ref: (el: HTMLInputElement | HTMLTextAreaElement | null) => { refs.current[name] = el; }, onFocus: () => { lastField.current = name; } });

  return (
    <>
      <section className="card" style={{ marginBottom: 16 }}>
        <div className="card-h"><h2>Look and feel</h2><small>Used by every email</small></div>
        <div className="card-b">
          <div className="form">
            <Field label="Organisation name" error={nameOk ? undefined : 'Enter your organisation name.'}><input type="text" value={brand.orgName} onChange={(e) => setBrand({ ...brand, orgName: e.target.value })} maxLength={60} /></Field>
            <Field label="Brand colour" error={accentOk ? undefined : 'Use a colour like #0c7480, or pick one with the square.'}>
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="color" value={/^#[0-9a-f]{6}$/i.test(brand.accent) ? brand.accent : '#0c7480'} onChange={(e) => setBrand({ ...brand, accent: e.target.value })} aria-label="Pick a colour" style={{ width: 52, padding: 4 }} />
                <input type="text" value={brand.accent} onChange={(e) => setBrand({ ...brand, accent: e.target.value })} placeholder="#0c7480" style={{ flex: 1 }} />
              </div>
            </Field>
            <Field label="Footer text" hint="optional, shown at the bottom of every email" className="full"><input type="text" value={brand.footer} onChange={(e) => setBrand({ ...brand, footer: e.target.value })} placeholder="Your address, phone number or a short note" maxLength={300} /></Field>
          </div>
          <div className="formbar"><button className="btn pri" disabled={!brandDirty || !brandOk || saveBrand.isPending} onClick={() => saveBrand.mutate()}>Save look and feel</button></div>
        </div>
      </section>

      <div className="tpl-grid">
        <nav className="card tpl-list" aria-label="Emails">
          {data.templates.map((t) => {
            const unsaved = drafts[t.key] && !same(drafts[t.key]!, t.template);
            return (
              <button key={t.key} className={t.key === sel ? 'on' : ''} onClick={() => { setSel(t.key); setPreview(null); }}>
                <b>{t.label}</b>
                <small>{t.to}</small>
                <span className="tags">{t.isCustom && <span className="pill s-chk">Edited</span>}{unsaved && <span className="pill s-ret">Unsaved</span>}</span>
              </button>
            );
          })}
        </nav>

        <div className="stack">
          <section className="card">
            <div className="card-h"><div><h2>{view.label}</h2><small>Sent when: {view.when}. To: {view.to}.</small></div></div>
            <div className="card-b">
              <div className="form">
                <Field label="Subject" className="full"><input type="text" value={draft.subject} onChange={(e) => edit({ subject: e.target.value })} {...bind('subject')} maxLength={150} /></Field>
                <Field label="Heading" className="full"><input type="text" value={draft.heading} onChange={(e) => edit({ heading: e.target.value })} {...bind('heading')} maxLength={100} /></Field>
                <Field label="Message" className="full">
                  <textarea value={draft.body} onChange={(e) => edit({ body: e.target.value })} {...bind('body')} rows={9} maxLength={2000} style={{ minHeight: 180 }} />
                  <span className="hint" style={{ fontWeight: 400 }}>Leave a blank line between paragraphs. Start a line with <code>&gt;</code> to put it in a highlighted box. The box disappears by itself if nothing was written for it.</span>
                </Field>
                <Field label="Button text" hint="leave empty for no button"><input type="text" value={draft.buttonLabel} onChange={(e) => edit({ buttonLabel: e.target.value })} {...bind('buttonLabel')} maxLength={40} /></Field>
                <div className="f" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, alignSelf: 'end', minHeight: 42 }}>
                  <Switch checked={draft.showDetails && view.hasReceipt} disabled={!view.hasReceipt} onChange={(v) => edit({ showDetails: v })} label="Show the receipt details" />
                  <span>Show the receipt details table{!view.hasReceipt && <span className="hint" style={{ fontWeight: 400 }}> (not for this email)</span>}</span>
                </div>
              </div>

              <div style={{ marginTop: 16 }}>
                <div style={{ fontWeight: 600, fontSize: '.84rem', marginBottom: 6 }}>Click to add a detail <span className="muted" style={{ fontWeight: 400 }}>(goes where your cursor is)</span></div>
                <div className="chips">
                  {mine.map((p) => <button key={p.key} type="button" className="chip" title={`${p.label}, for example: ${p.example}`} onClick={() => insert(p.key)}>{`{{${p.key}}}`}</button>)}
                </div>
              </div>

              {unknown.length > 0 && (
                <div className="callout bad" role="alert" style={{ margin: '16px 0 0' }}>
                  <Icon name="x" />
                  <div><b>This email does not have {unknown.map((u) => `{{${u}}}`).join(', ')}</b><span>It would come out empty. Remove it or pick one from the list above.</span></div>
                </div>
              )}

              <div className="formbar" style={{ justifyContent: 'space-between' }}>
                <div>{view.isCustom && <button className="btn ghost" type="button" onClick={() => reset.mutate()} disabled={reset.isPending}>Reset to default wording</button>}</div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {dirty && <button className="btn" type="button" onClick={() => setDrafts((d) => { const n = { ...d }; delete n[sel]; return n; })}>Undo changes</button>}
                  <button className="btn pri" type="button" disabled={!dirty || unknown.length > 0 || save.isPending} onClick={() => save.mutate()}>Save</button>
                </div>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card-h">
              <h2>Preview</h2>
              <div className="seg"><button className={!phone ? 'on' : ''} onClick={() => setPhone(false)}>Computer</button><button className={phone ? 'on' : ''} onClick={() => setPhone(true)}>Phone</button></div>
            </div>
            <div className="card-b">
              {previewError ? <div className="callout warn" style={{ margin: 0 }}><Icon name="info" /><div><b>Preview paused</b><span>{previewError}</span></div></div> : preview ? (
                <>
                  <div className="muted" style={{ fontSize: '.86rem', marginBottom: 8 }}>Subject: <b style={{ color: 'var(--ink)' }}>{preview.subject}</b></div>
                  <div className="tpl-frame"><iframe title="Email preview" sandbox="" srcDoc={preview.html} style={{ width: phone ? 375 : '100%', height: 560 }} /></div>
                  {preview.buttonHiddenForNow && draft.buttonLabel && <p className="muted" style={{ fontSize: '.84rem', margin: '10px 0 0' }}>The button is shown here as it will look once REIMSYS has a secure web address. Until then the emails say "Sign in to {brand.orgName} to open it." instead, because links to a plain address make mail look like spam.</p>}
                </>
              ) : <div className="empty">Loading preview…</div>}
              <form className="tools" style={{ marginTop: 16, marginBottom: 0 }} onSubmit={(e) => { e.preventDefault(); if (sampleTo && !unknown.length) sendSample.mutate(); }}>
                <div style={{ flex: '1 1 260px', maxWidth: 360 }}><input type="email" value={sampleTo} onChange={(e) => setSampleTo(e.target.value)} placeholder="Send a sample to…" aria-label="Send a sample to" /></div>
                <button className="btn" type="submit" disabled={!sampleTo || unknown.length > 0 || sendSample.isPending}>Send a sample</button>
              </form>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
