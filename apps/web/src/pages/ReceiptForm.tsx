import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EVIDENCE_MAX_BYTES, EVIDENCE_MAX_FILES, receiptInputSchema } from '@reimsys/shared';
import { api, errMsg, todayIso } from '../api';
import type { Category, ReceiptDetail } from '../types';
import { Field, Icon, useToast } from '../ui';

const kb = (n: number) => (n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,application/pdf';

export function ReceiptFormPage() {
  const id = useParams().id ? Number(useParams().id) : null;
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const pick = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [payee, setPayee] = useState('');
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [queued, setQueued] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  // When editing, the form stays hidden until the saved values are in it, so nothing flashes empty and nothing typed early gets overwritten.
  const [ready, setReady] = useState(id === null);

  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api<{ categories: Category[] }>('/categories') });
  const existing = useQuery({ queryKey: ['receipt', id], enabled: id !== null, queryFn: () => api<{ receipt: ReceiptDetail }>(`/receipts/${id}`) });
  const rec = existing.data?.receipt;

  useEffect(() => {
    if (!rec) return;
    setPayee(rec.payee); setDate(rec.receiptDate); setAmount(String(rec.amount)); setCategoryId(String(rec.category.id)); setDescription(rec.description ?? ''); setReady(true);
  }, [rec?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!id && !categoryId && cats.data?.categories[0]) setCategoryId(String(cats.data.categories[0].id)); }, [cats.data, id, categoryId]);

  const clear = (k: string) => setErrors((e) => (e[k] ? { ...e, [k]: '' } : e));
  const files = rec?.evidence ?? [];
  const total = files.length + queued.length;

  function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list);
    const next: File[] = [];
    for (const f of incoming) {
      if (f.size > EVIDENCE_MAX_BYTES) { toast(`"${f.name}" is over 10 MB.`, 'bad'); continue; }
      if (!ACCEPT.split(',').includes(f.type) && !/\.(heic|pdf|jpe?g|png|webp)$/i.test(f.name)) { toast(`"${f.name}" is not a photo or PDF.`, 'bad'); continue; }
      next.push(f);
    }
    if (files.length + queued.length + next.length > EVIDENCE_MAX_FILES) { toast(`A receipt can have up to ${EVIDENCE_MAX_FILES} files.`, 'bad'); return; }
    setQueued((q) => [...q, ...next]);
    setErrors((e) => ({ ...e, evidence: '' }));
  }
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); };

  const removeSaved = useMutation({
    mutationFn: (eid: number) => api<{ receipt: ReceiptDetail }>(`/receipts/${id}/evidence/${eid}`, { method: 'DELETE' }),
    onSuccess: (d) => qc.setQueryData(['receipt', id], d),
    onError: (e) => toast(errMsg(e), 'bad'),
  });

  async function save(andSubmit: boolean) {
    const parsed = receiptInputSchema.safeParse({ payee, receiptDate: date, amount, categoryId, description: description || null });
    const errs: Record<string, string> = {};
    if (!parsed.success) for (const i of parsed.error.issues) errs[String(i.path[0])] ||= i.message;
    if (andSubmit && !total) errs.evidence = 'Add at least one photo or PDF of the receipt.';
    setErrors(errs);
    if (Object.keys(errs).length || !parsed.success) { document.querySelector('.err')?.scrollIntoView({ block: 'center' }); return; }

    setBusy(true);
    try {
      let current = rec;
      if (id) current = (await api<{ receipt: ReceiptDetail }>(`/receipts/${id}`, { method: 'PATCH', body: parsed.data })).receipt;
      else current = (await api<{ receipt: ReceiptDetail }>('/receipts', { method: 'POST', body: parsed.data })).receipt;
      if (queued.length) {
        const form = new FormData();
        queued.forEach((f) => form.append('files', f, f.name));
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

  return (
    <>
      <Link className="back" to={id ? `/receipts/${id}` : '/receipts'}><Icon name="back" size={18} />Back</Link>
      <div className="ph"><div><h1>{id ? 'Edit receipt' : 'New receipt'}</h1><p>Fill in the details, then attach a clear photo or PDF.</p></div></div>
      {rec?.status === 'returned' && rec.lastNote && <div className="callout warn"><Icon name="undo" /><div><b>Returned for correction</b><span>{rec.lastNote}</span></div></div>}
      <section className="card">
        <form className="card-b" noValidate onSubmit={(e) => { e.preventDefault(); void save(false); }}>
          <div className="form">
            <Field label="Paid to" className="full" error={errors.payee}><input type="text" value={payee} onChange={(e) => { setPayee(e.target.value); clear('payee'); }} placeholder="Store or provider name" autoFocus /></Field>
            <Field label="Receipt date" error={errors.receiptDate}><input type="date" value={date} max={todayIso()} onChange={(e) => { setDate(e.target.value); clear('receiptDate'); }} /></Field>
            <Field label="Amount (PHP)" error={errors.amount}><input type="number" step="0.01" min="0" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); clear('amount'); }} placeholder="0.00" /></Field>
            <Field label="Category" error={errors.categoryId}>
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>{cats.data?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            </Field>
            <Field label="Description" hint="Optional"><input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What was this for?" maxLength={500} /></Field>

            <div className="full">
              <div style={{ fontWeight: 600, fontSize: '.84rem', marginBottom: 6 }}>Evidence <span className="hint muted" style={{ fontWeight: 400 }}>{total} of {EVIDENCE_MAX_FILES}</span></div>
              <div className={`drop ${over ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
                <Icon name="upload" />
                <div style={{ marginTop: 6 }}><b style={{ color: 'var(--ink)' }}>Drop files here</b><br />JPG, PNG, WEBP, HEIC or PDF · up to 10 MB each</div>
                <div className="btns">
                  <button type="button" className="btn" onClick={() => { pick.current?.removeAttribute('capture'); pick.current?.click(); }}><Icon name="upload" size={18} />Choose files</button>
                  <button type="button" className="btn" onClick={() => { pick.current?.setAttribute('capture', 'environment'); pick.current?.click(); }}><Icon name="camera" size={18} />Take photo</button>
                </div>
                <input ref={pick} type="file" multiple accept={ACCEPT} onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
              </div>
              {errors.evidence && <span className="err">{errors.evidence}</span>}
              <div className="files">
                {files.map((f) => (
                  <div className="file" key={f.id}><span className="thumb"><Icon name={f.mime === 'application/pdf' ? 'file' : 'camera'} /></span><div><b>{f.fileName}</b><small className="muted">Saved · {kb(f.size)}</small></div>
                    <button type="button" className="btn sm ghost" aria-label={`Remove ${f.fileName}`} onClick={() => removeSaved.mutate(f.id)}><Icon name="x" size={16} /></button></div>
                ))}
                {queued.map((f, i) => (
                  <div className="file" key={f.name + i}><span className="thumb"><Icon name={f.type === 'application/pdf' ? 'file' : 'camera'} /></span><div><b>{f.name}</b><small className="muted">Ready to upload · {kb(f.size)}</small></div>
                    <button type="button" className="btn sm ghost" aria-label={`Remove ${f.name}`} onClick={() => setQueued((q) => q.filter((_, j) => j !== i))}><Icon name="x" size={16} /></button></div>
                ))}
              </div>
            </div>
          </div>
          <div className="formbar">
            <button type="submit" className="btn" disabled={busy}>Save draft</button>
            <button type="button" className="btn pri" disabled={busy} onClick={() => void save(true)}>{rec?.status === 'returned' ? 'Resubmit for checking' : 'Submit for checking'}</button>
          </div>
        </form>
      </section>
    </>
  );
}
