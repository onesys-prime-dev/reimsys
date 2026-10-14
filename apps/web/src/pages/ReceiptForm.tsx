import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { DEFAULT_COMPANY, DEFAULT_SETTINGS, TRANSACTION_LABEL, VAT_LABEL, makeReceiptSchema, peso, receiptProblems, receiptWarnings, type AppSettings, type Company } from '@reimsys/shared';
import { api, errMsg, todayIso } from '../api';
import type { ReceiptDetail } from '../types';
import { Field, Icon, useToast } from '../ui';

const kb = (n: number) => (n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,application/pdf';

/** Everything on the form, as text, exactly as typed. Turned into numbers and flags only when it is checked or saved. */
interface FormState {
  bir: '' | 'yes' | 'no';
  seenCompany: boolean; seenTin: boolean; seenAddress: boolean;
  noBirReason: string;
  date: string; invoiceNo: string; payee: string; vendorAddress: string; vendorTin: string; amount: string; type: '' | 'product' | 'service';
  vatType: '' | 'vatable' | 'non_vatable'; vatable: string; vat: string;
  withheld: '' | 'yes' | 'no'; whtRate: string; whtAmount: string;
  description: string;
}
const EMPTY: FormState = {
  bir: '', seenCompany: false, seenTin: false, seenAddress: false, noBirReason: '', date: todayIso(), invoiceNo: '', payee: '', vendorAddress: '', vendorTin: '', amount: '',
  type: '', vatType: '', vatable: '', vat: '', withheld: '', whtRate: '', whtAmount: '', description: '',
};

type StepId = 'bir' | 'company' | 'reason' | 'invoice' | 'vat' | 'wht' | 'evidence';
const STEP_TITLE: Record<StepId, string> = {
  bir: 'Reimbursement details', company: 'Invoice under the company', reason: 'No BIR-registered invoice', invoice: 'Invoice details', vat: 'VAT details', wht: 'Withholding tax', evidence: 'Proof and review',
};
const STEP_FIELDS: Record<StepId, string[]> = {
  bir: ['birInvoice'], company: ['seenCompany', 'seenTin', 'seenAddress'], reason: ['noBirReason'],
  invoice: ['receiptDate', 'invoiceNo', 'payee', 'vendorAddress', 'vendorTin', 'amount', 'transactionType'],
  vat: ['vatType', 'vatableAmount', 'vatAmount', 'withheld'], wht: ['whtRate', 'whtAmount'], evidence: ['description'],
};

const toCandidate = (f: FormState, rules: AppSettings) => ({
  birInvoice: f.bir, seenCompany: f.bir === 'yes' ? f.seenCompany : null, seenTin: f.bir === 'yes' ? f.seenTin : null, seenAddress: f.bir === 'yes' ? f.seenAddress : null,
  noBirReason: f.noBirReason, receiptDate: f.date, invoiceNo: f.invoiceNo, payee: f.payee, vendorAddress: f.vendorAddress, vendorTin: f.vendorTin, amount: f.amount,
  transactionType: f.type, vatType: f.vatType, vatableAmount: f.vatable, vatAmount: f.vat, withheld: rules.askWithholding ? f.withheld : f.bir === 'yes' ? 'no' : '', whtRate: f.whtRate, whtAmount: f.whtAmount, description: f.description || null,
});

const fromReceipt = (r: ReceiptDetail): FormState => {
  const x = r.form;
  const yn = (v: boolean | null) => (v === null ? '' : v ? 'yes' : 'no');
  const n = (v: number | null) => (v === null ? '' : String(v));
  return {
    bir: yn(x.birInvoice), seenCompany: !!x.seenCompany, seenTin: !!x.seenTin, seenAddress: !!x.seenAddress, noBirReason: x.noBirReason ?? '',
    date: r.receiptDate, invoiceNo: x.invoiceNo ?? '', payee: r.payee, vendorAddress: x.vendorAddress ?? '', vendorTin: x.vendorTin ?? '', amount: String(r.amount),
    type: (x.transactionType as FormState['type']) ?? '', vatType: (x.vatType as FormState['vatType']) ?? '', vatable: n(x.vatableAmount), vat: n(x.vatAmount),
    withheld: yn(x.withheld), whtRate: n(x.whtRate), whtAmount: n(x.whtAmount), description: r.description ?? '',
  };
};

function Choice<T extends string>({ value, onChange, options, name }: { value: T | ''; onChange: (v: T) => void; options: { value: T; label: string; sub?: string }[]; name: string }) {
  return (
    <div className="choices" role="radiogroup" aria-label={name}>
      {options.map((o) => (
        <button type="button" key={o.value} role="radio" aria-checked={value === o.value} className={`choice ${value === o.value ? 'on' : ''}`} onClick={() => onChange(o.value)}>
          <span className="dot" aria-hidden="true" /><span><b>{o.label}</b>{o.sub && <small>{o.sub}</small>}</span>
        </button>
      ))}
    </div>
  );
}

function Tick({ checked, onChange, label, value, error }: { checked: boolean; onChange: (v: boolean) => void; label: string; value: string; error?: string }) {
  return (
    <div className={`tick ${error ? 'bad' : ''}`}>
      <label>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span><b>{label}</b><em>{value}</em></span>
      </label>
      {error && <span className="err">{error}</span>}
    </div>
  );
}

export function ReceiptFormPage() {
  const id = useParams().id ? Number(useParams().id) : null;
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const pick = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [f, setF] = useState<FormState>(EMPTY);
  const [stepIx, setStepIx] = useState(0);
  const [queued, setQueued] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  // When editing, the form stays hidden until the saved values are in it, so nothing flashes empty and nothing typed early gets overwritten.
  const [ready, setReady] = useState(id === null);

  const company = useQuery({ queryKey: ['company'], queryFn: () => api<{ company: Company }>('/company') });
  const co = company.data?.company ?? DEFAULT_COMPANY;
  const appSet = useQuery({ queryKey: ['app-settings'], queryFn: () => api<{ settings: AppSettings }>('/app-settings') });
  const rules = appSet.data?.settings ?? DEFAULT_SETTINGS;
  const MAX_FILES = rules.evidenceMaxFiles;
  const MAX_BYTES = rules.evidenceMaxMb * 1_048_576;
  const existing = useQuery({ queryKey: ['receipt', id], enabled: id !== null, queryFn: () => api<{ receipt: ReceiptDetail }>(`/receipts/${id}`) });
  const rec = existing.data?.receipt;

  useEffect(() => { if (rec) { setF(fromReceipt(rec)); setReady(true); } }, [rec?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof FormState>(k: K, v: FormState[K], ...errKeys: string[]) => {
    setF((p) => ({ ...p, [k]: v }));
    if (errKeys.length) setErrors((e) => { const n = { ...e }; errKeys.forEach((x) => delete n[x]); return n; });
  };

  // The steps follow the client's form, and skip whatever the answers make unnecessary.
  const steps = useMemo<StepId[]>(() => {
    const s: StepId[] = ['bir'];
    if (f.bir === 'yes') s.push('company'); else if (f.bir === 'no') s.push('reason');
    s.push('invoice');
    if (f.bir === 'yes') { s.push('vat'); if (f.withheld === 'yes') s.push('wht'); }
    s.push('evidence');
    return s;
  }, [f.bir, f.withheld]);
  const step = steps[Math.min(stepIx, steps.length - 1)]!;

  const files = rec?.evidence ?? [];
  const total = files.length + queued.length;
  const required = f.bir === 'yes';

  const warnings = useMemo(() => {
    const n = (v: string) => (v.trim() === '' || Number.isNaN(Number(v)) ? null : Number(v));
    const amount = n(f.amount);
    if (amount === null) return [];
    return receiptWarnings({
      birInvoice: f.bir === '' ? null : f.bir === 'yes', amount, vendorTin: f.vendorTin, vatType: f.vatType || null, vatableAmount: n(f.vatable), vatAmount: n(f.vat),
      withheld: f.withheld === '' ? null : f.withheld === 'yes', whtRate: n(f.whtRate), whtAmount: n(f.whtAmount),
    }, rules);
  }, [f, rules]);

  /** Problems in the whole form, grouped by the field they belong to. */
  const validate = () => {
    const candidate = toCandidate(f, rules);
    const errs = receiptProblems(candidate, rules);
    return { parsed: makeReceiptSchema(rules).safeParse(candidate), errs };
  };

  function next() {
    const { errs } = validate();
    const mine = Object.fromEntries(Object.entries(errs).filter(([k]) => STEP_FIELDS[step].includes(k) && step !== 'evidence'));
    setErrors((e) => ({ ...e, ...mine }));
    if (Object.keys(mine).length) { window.setTimeout(() => document.querySelector('.err')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 0); return; }
    setStepIx((i) => Math.min(i + 1, steps.length - 1));
    window.scrollTo({ top: 0 });
  }
  const back = () => { setStepIx((i) => Math.max(0, i - 1)); window.scrollTo({ top: 0 }); };

  function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list);
    const nextFiles: File[] = [];
    for (const x of incoming) {
      if (x.size > MAX_BYTES) { toast(`"${x.name}" is over ${rules.evidenceMaxMb} MB.`, 'bad'); continue; }
      if (!ACCEPT.split(',').includes(x.type) && !/\.(heic|pdf|jpe?g|png|webp)$/i.test(x.name)) { toast(`"${x.name}" is not a photo or PDF.`, 'bad'); continue; }
      nextFiles.push(x);
    }
    if (files.length + queued.length + nextFiles.length > MAX_FILES) { toast(`A receipt can have up to ${MAX_FILES} files.`, 'bad'); return; }
    setQueued((q) => [...q, ...nextFiles]);
    setErrors((e) => ({ ...e, evidence: '' }));
  }
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); };

  const removeSaved = useMutation({
    mutationFn: (eid: number) => api<{ receipt: ReceiptDetail }>(`/receipts/${id}/evidence/${eid}`, { method: 'DELETE' }),
    onSuccess: (d) => qc.setQueryData(['receipt', id], d),
    onError: (e) => toast(errMsg(e), 'bad'),
  });

  async function save(andSubmit: boolean) {
    const { parsed, errs } = validate();
    if (andSubmit && !total) errs.evidence = 'Add at least one photo or PDF of the receipt.';
    setErrors(errs);
    if (Object.keys(errs).length || !parsed.success) {
      // Take the person to the first step that has a problem.
      const bad = steps.findIndex((s) => STEP_FIELDS[s].some((k) => errs[k]) || (s === 'evidence' && errs.evidence));
      if (bad >= 0) setStepIx(bad);
      window.setTimeout(() => document.querySelector('.err')?.scrollIntoView({ block: 'center' }), 50);
      return;
    }
    setBusy(true);
    try {
      let current = rec;
      if (id) current = (await api<{ receipt: ReceiptDetail }>(`/receipts/${id}`, { method: 'PATCH', body: parsed.data })).receipt;
      else current = (await api<{ receipt: ReceiptDetail }>('/receipts', { method: 'POST', body: parsed.data })).receipt;
      if (queued.length) {
        const form = new FormData();
        queued.forEach((x) => form.append('files', x, x.name));
        const up = await api<{ receipt: ReceiptDetail; warnings: string[] }>(`/receipts/${current!.id}/evidence`, { method: 'POST', form });
        current = up.receipt;
        up.warnings.forEach((w) => toast(w));
      }
      if (andSubmit) current = (await api<{ receipt: ReceiptDetail }>(`/receipts/${current!.id}/submit`, { method: 'POST', body: { version: current!.version } })).receipt;
      toast(andSubmit ? 'Submitted. Checkers have been notified.' : 'Draft saved.');
      qc.invalidateQueries({ queryKey: ['receipts'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.setQueryData(['receipt', current!.id], { receipt: current });
      nav(`/receipts/${current!.id}`);
    } catch (e) {
      toast(errMsg(e), 'bad');
      // The record may exist already (created before the upload failed), so reload it.
      qc.invalidateQueries({ queryKey: ['receipts'] });
    } finally {
      setBusy(false);
    }
  }

  if (id && existing.isError) return <div className="empty"><b>Receipt not found</b></div>;
  if (id && !ready && !(rec && !rec.canEdit)) return <div className="empty">Loading…</div>;
  if (id && rec && !rec.canEdit) return <div className="empty"><b>This receipt can no longer be edited</b><Link to={`/receipts/${id}`} style={{ color: 'var(--accent)' }}>Open it</Link></div>;

  const last = stepIx >= steps.length - 1;
  const money = (v: string) => (v.trim() === '' || Number.isNaN(Number(v)) ? '-' : peso(Number(v)));
  const e = errors;
  const inv = (label: string, children: ReactNode) => <div className="rv"><span>{label}</span><b>{children}</b></div>;

  return (
    <>
      <Link className="back" to={id ? `/receipts/${id}` : '/receipts'}><Icon name="back" size={18} />Back</Link>
      <div className="ph"><div><h1>{id ? 'Edit receipt' : 'New receipt'}</h1><p>Answer the questions about the invoice, then attach a clear photo or PDF.</p></div></div>
      {rec?.status === 'returned' && rec.lastNote && <div className="callout warn"><Icon name="undo" /><div><b>Returned for correction</b><span>{rec.lastNote}</span></div></div>}

      <ol className="steps" aria-label="Progress">
        {steps.map((s, i) => (
          <li key={s} className={i === stepIx ? 'on' : i < stepIx ? 'done' : ''} aria-current={i === stepIx ? 'step' : undefined}><span>{i < stepIx ? '✓' : i + 1}</span><em>{STEP_TITLE[s]}</em></li>
        ))}
      </ol>

      <section className="card">
        <form className="card-b" noValidate onSubmit={(ev) => { ev.preventDefault(); if (last) void save(false); else next(); }}>
          <h2 className="steph">{STEP_TITLE[step]}</h2>

          {step === 'bir' && (
            <div className="form">
              <div className="full">
                <div className="q">With BIR-registered invoice under <b>{co.name}</b>? <i>*</i></div>
                <Choice name="BIR-registered invoice" value={f.bir} onChange={(v) => set('bir', v, 'birInvoice')} options={[{ value: 'yes', label: 'Yes', sub: 'The invoice is addressed to the company' }, ...(rules.allowNoBir ? [{ value: 'no' as const, label: 'No', sub: 'There is no registered invoice, so you will explain why' }] : [])]} />
                {e.birInvoice && <span className="err">{e.birInvoice}</span>}
              </div>
            </div>
          )}

          {step === 'company' && (
            <div className="form">
              <p className="full muted" style={{ margin: 0 }}>Look at the invoice. Tick each one only if it can be seen <b>completely</b>.</p>
              <div className="full"><Tick label={`Check if ${co.name} can be seen COMPLETELY in the invoice`} value={`Company name: ${co.name}`} checked={f.seenCompany} onChange={(v) => set('seenCompany', v, 'seenCompany')} error={e.seenCompany} /></div>
              <div className="full"><Tick label={`Check if TIN ${co.tin} can be seen COMPLETELY in the invoice`} value={`Tax ID No. (TIN): ${co.tin}`} checked={f.seenTin} onChange={(v) => set('seenTin', v, 'seenTin')} error={e.seenTin} /></div>
              <div className="full"><Tick label="Check if the complete address can be seen COMPLETELY in the invoice" value={`Complete address: ${co.address}`} checked={f.seenAddress} onChange={(v) => set('seenAddress', v, 'seenAddress')} error={e.seenAddress} /></div>
            </div>
          )}

          {step === 'reason' && (
            <div className="form">
              <div className="callout warn full" style={{ marginBottom: 0 }}><Icon name="info" /><div><b>This will get a closer look</b><span>The Checker decides whether a receipt without a BIR-registered invoice can be reimbursed.</span></div></div>
              <Field label="Why is there no BIR-registered invoice?" className="full" error={e.noBirReason}>
                <textarea rows={4} value={f.noBirReason} maxLength={500} onChange={(ev) => set('noBirReason', ev.target.value, 'noBirReason')} placeholder="For example: small store that only gave an acknowledgement receipt" autoFocus />
              </Field>
            </div>
          )}

          {step === 'invoice' && (
            <div className="form">
              <Field label={required ? 'Invoice date' : 'Date on the receipt'} error={e.receiptDate}><input type="date" value={f.date} max={todayIso()} onChange={(ev) => set('date', ev.target.value, 'receiptDate')} /></Field>
              <Field label="Invoice no." hint={required && rules.requireInvoiceNo ? undefined : 'Optional'} error={e.invoiceNo}><input type="text" value={f.invoiceNo} maxLength={60} onChange={(ev) => set('invoiceNo', ev.target.value, 'invoiceNo')} /></Field>
              <Field label="Vendor complete name" className="full" error={e.payee}><input type="text" value={f.payee} maxLength={160} onChange={(ev) => set('payee', ev.target.value, 'payee')} placeholder="Store or provider name" /></Field>
              <Field label="Vendor complete address" hint={required && rules.requireVendorAddress ? undefined : 'Optional'} className="full" error={e.vendorAddress}><input type="text" value={f.vendorAddress} maxLength={300} onChange={(ev) => set('vendorAddress', ev.target.value, 'vendorAddress')} /></Field>
              <Field label="Vendor Tax ID No. (TIN)" hint={required && rules.requireVendorTin ? undefined : 'Optional'} error={e.vendorTin}><input type="text" inputMode="numeric" value={f.vendorTin} maxLength={30} onChange={(ev) => set('vendorTin', ev.target.value, 'vendorTin')} placeholder="000-000-000-00000" /></Field>
              <Field label="Invoice gross amount, without any deduction (PHP)" error={e.amount}><input type="number" step="0.01" min="0" inputMode="decimal" value={f.amount} onChange={(ev) => set('amount', ev.target.value, 'amount')} placeholder="0.00" /></Field>
              <div className="full">
                <div className="q">Business transaction? <i>*</i></div>
                <Choice name="Business transaction" value={f.type} onChange={(v) => set('type', v, 'transactionType')} options={[{ value: 'product', label: 'Product' }, { value: 'service', label: 'Service' }]} />
                {e.transactionType && <span className="err">{e.transactionType}</span>}
              </div>
              {warnings.filter((w) => w.includes('TIN')).map((w) => <div key={w} className="callout warn full" style={{ marginBottom: 0 }}><Icon name="info" /><div><span>{w}</span></div></div>)}
            </div>
          )}

          {step === 'vat' && (
            <div className="form">
              <div className="full">
                <div className="q">Vatable or non-vatable? <i>*</i></div>
                <Choice name="VAT type" value={f.vatType} onChange={(v) => set('vatType', v, 'vatType')} options={[{ value: 'vatable', label: 'Vatable', sub: '"VAT" can be seen in the letterhead of the invoice' }, { value: 'non_vatable', label: 'Non-vatable', sub: '"NON-VAT" appeared in the letterhead of the invoice' }]} />
                {e.vatType && <span className="err">{e.vatType}</span>}
              </div>
              <Field label="Vatable amount, without VAT and any deduction (PHP)" error={e.vatableAmount}><input type="number" step="0.01" min="0" inputMode="decimal" value={f.vatable} onChange={(ev) => set('vatable', ev.target.value, 'vatableAmount')} placeholder="0.00" /></Field>
              <Field label='VAT amount, enter "0" if no VAT in the invoice (PHP)' error={e.vatAmount}><input type="number" step="0.01" min="0" inputMode="decimal" value={f.vat} onChange={(ev) => set('vat', ev.target.value, 'vatAmount')} placeholder="0.00" /></Field>
              {rules.askWithholding && <div className="full">
                <div className="q">Withheld tax? <i>*</i></div>
                <Choice name="Withheld tax" value={f.withheld} onChange={(v) => set('withheld', v, 'withheld')} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
                {e.withheld && <span className="err">{e.withheld}</span>}
              </div>}
              {warnings.filter((w) => !w.includes('TIN') && !w.toLowerCase().includes('withhold')).map((w) => <div key={w} className="callout warn full" style={{ marginBottom: 0 }}><Icon name="info" /><div><b>Please double-check</b><span>{w}</span></div></div>)}
            </div>
          )}

          {step === 'wht' && (
            <div className="form">
              <Field label="Withholding tax rate (%)" error={e.whtRate}><input type="number" step="0.01" min="0" max="100" inputMode="decimal" value={f.whtRate} onChange={(ev) => set('whtRate', ev.target.value, 'whtRate')} placeholder="e.g. 1" /></Field>
              <Field label="Withholding tax amount (PHP)" error={e.whtAmount}><input type="number" step="0.01" min="0" inputMode="decimal" value={f.whtAmount} onChange={(ev) => set('whtAmount', ev.target.value, 'whtAmount')} placeholder="0.00" /></Field>
              {warnings.filter((w) => w.toLowerCase().includes('withhold')).map((w) => <div key={w} className="callout warn full" style={{ marginBottom: 0 }}><Icon name="info" /><div><b>Please double-check</b><span>{w}</span></div></div>)}
            </div>
          )}

          {step === 'evidence' && (
            <div className="form">
              <div className="full">
                <div style={{ fontWeight: 600, fontSize: '.84rem', marginBottom: 6 }}>Evidence <span className="hint muted" style={{ fontWeight: 400 }}>{total} of {MAX_FILES}</span></div>
                <div className={`drop ${over ? 'over' : ''}`} onDragOver={(ev) => { ev.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
                  <Icon name="upload" />
                  <div style={{ marginTop: 6 }}><b style={{ color: 'var(--ink)' }}>Drop files here</b><br />JPG, PNG, WEBP, HEIC or PDF · up to {rules.evidenceMaxMb} MB each</div>
                  <div className="btns">
                    <button type="button" className="btn" onClick={() => { pick.current?.removeAttribute('capture'); pick.current?.click(); }}><Icon name="upload" size={18} />Choose files</button>
                    <button type="button" className="btn" onClick={() => { pick.current?.setAttribute('capture', 'environment'); pick.current?.click(); }}><Icon name="camera" size={18} />Take photo</button>
                  </div>
                  <input ref={pick} type="file" multiple accept={ACCEPT} onChange={(ev) => { if (ev.target.files) addFiles(ev.target.files); ev.target.value = ''; }} />
                </div>
                {e.evidence && <span className="err">{e.evidence}</span>}
                <div className="files">
                  {files.map((x) => (
                    <div className="file" key={x.id}><span className="thumb"><Icon name={x.mime === 'application/pdf' ? 'file' : 'camera'} /></span><div><b>{x.fileName}</b><small className="muted">Saved · {kb(x.size)}</small></div>
                      <button type="button" className="btn sm ghost" aria-label={`Remove ${x.fileName}`} onClick={() => removeSaved.mutate(x.id)}><Icon name="x" size={16} /></button></div>
                  ))}
                  {queued.map((x, i) => (
                    <div className="file" key={x.name + i}><span className="thumb"><Icon name={x.type === 'application/pdf' ? 'file' : 'camera'} /></span><div><b>{x.name}</b><small className="muted">Ready to upload · {kb(x.size)}</small></div>
                      <button type="button" className="btn sm ghost" aria-label={`Remove ${x.name}`} onClick={() => setQueued((q) => q.filter((_, j) => j !== i))}><Icon name="x" size={16} /></button></div>
                  ))}
                </div>
              </div>

              {rules.showDescription && <Field label="Description" hint="Optional" className="full"><input type="text" value={f.description} onChange={(ev) => set('description', ev.target.value)} placeholder="What was this for?" maxLength={500} /></Field>}

              <div className="full">
                <div style={{ fontWeight: 600, fontSize: '.84rem', marginBottom: 6 }}>Review</div>
                <div className="review">
                  {inv('BIR-registered invoice', f.bir === 'yes' ? 'Yes' : f.bir === 'no' ? 'No' : '-')}
                  {f.bir === 'no' && inv('Reason', f.noBirReason || '-')}
                  {inv('Vendor', f.payee || '-')}
                  {inv('Invoice no. · date', `${f.invoiceNo || '-'} · ${f.date || '-'}`)}
                  {f.vendorTin && inv('Vendor TIN', f.vendorTin)}
                  {inv('Type', f.type ? TRANSACTION_LABEL[f.type] : '-')}
                  {inv('Gross amount', money(f.amount))}
                  {f.bir === 'yes' && inv('VAT', `${f.vatType ? VAT_LABEL[f.vatType] : '-'} · vatable ${money(f.vatable)} · VAT ${money(f.vat)}`)}
                  {f.bir === 'yes' && rules.askWithholding && inv('Withholding tax', f.withheld === 'yes' ? `${f.whtRate || '-'}% · ${money(f.whtAmount)}` : f.withheld === 'no' ? 'None' : '-')}
                </div>
                {warnings.length > 0 && <div className="callout warn" style={{ marginTop: 12, marginBottom: 0 }}><Icon name="info" /><div><b>The Checker will see these notes</b><span>{warnings.map((w) => <span key={w} style={{ display: 'block' }}>{w}</span>)}</span></div></div>}
              </div>
            </div>
          )}

          <div className="formbar">
            {stepIx > 0 && <button type="button" className="btn" disabled={busy} onClick={back}>Back</button>}
            {!last && <button type="submit" className="btn pri">Next</button>}
            {last && <button type="submit" className="btn" disabled={busy}>Save draft</button>}
            {last && <button type="button" className="btn pri" disabled={busy} onClick={() => void save(true)}>{rec?.status === 'returned' ? 'Resubmit for checking' : 'Submit for checking'}</button>}
          </div>
        </form>
      </section>
    </>
  );
}
