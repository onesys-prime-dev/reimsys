import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type DragEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, errMsg, fmtDate, money } from '../api';
import { Icon, useToast } from '../ui';

interface Preview {
  id: number; fileName: string; totalRows: number; validRows: number; errorCount: number;
  errors: { row: number; message: string }[];
  preview: { payee: string; receiptDate: string; amount: number; description: string | null; form: { birInvoice: boolean | null; invoiceNo: string | null } | null }[];
}

export function ImportPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const pick = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [pv, setPv] = useState<Preview | null>(null);

  const up = useMutation({
    mutationFn: (file: File) => { const f = new FormData(); f.append('file', file, file.name); return api<Preview>('/imports', { method: 'POST', form: f }); },
    onSuccess: setPv,
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  const confirm = useMutation({
    mutationFn: () => api<{ created: number }>(`/imports/${pv!.id}/confirm`, { method: 'POST' }),
    onSuccess: (d) => { toast(`Imported ${d.created} draft${d.created === 1 ? '' : 's'}. Add evidence, then submit.`); qc.invalidateQueries({ queryKey: ['receipts'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); nav('/receipts'); },
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) up.mutate(f); };

  return (
    <>
      <Link className="back" to="/receipts"><Icon name="back" size={18} />Back to receipts</Link>
      <div className="ph"><div><h1>Import receipts</h1><p>Upload a CSV or XLSX file. Nothing is saved until you confirm.</p></div><a className="btn" href="/api/imports/template"><Icon name="download" size={18} />Download template</a></div>

      {!pv ? (
        <section className="card"><div className="card-b">
          <div className={`drop ${over ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
            <Icon name="upload" />
            <div style={{ marginTop: 6 }}><b style={{ color: 'var(--ink)' }}>Drop a file here</b><br />CSV or XLSX · up to 2,000 rows · 5 MB</div>
            <div className="btns"><button className="btn" onClick={() => pick.current?.click()} disabled={up.isPending}><Icon name="upload" size={18} />{up.isPending ? 'Reading…' : 'Choose file'}</button></div>
            <input ref={pick} type="file" accept=".csv,.xlsx,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) up.mutate(f); e.target.value = ''; }} />
          </div>
          <p className="muted" style={{ fontSize: '.86rem', marginBottom: 0 }}>Download the template to see every column: <code>vendor</code>, <code>invoice_date</code> (YYYY-MM-DD), <code>invoice_no</code>, <code>vendor_tin</code>, <code>vendor_address</code>, <code>gross_amount</code>, <code>type</code> (product or service), <code>bir_invoice</code> (yes or no), <code>invoice_under_company</code>, <code>company_check</code>, <code>reason_for_spending</code>, <code>classification</code> (fuel, representation, meal, meeting, transportation, parking, printing or other), <code>vat_type</code>, <code>vatable_amount</code>, <code>vat_amount</code>, <code>vat_exempt_amount</code>, <code>discount</code>, <code>tax_withheld</code>, <code>wht_rate</code>, <code>wht_amount</code> and <code>charge_location</code> (a name from the list in Settings). The last page of the form (where to charge and the review) can also be completed after importing. A file with only the old columns (<code>payee</code>, <code>receipt_date</code>, <code>amount</code>) still works, but its receipts need the invoice details filled in before they can be submitted. Imported receipts start as drafts. Photos or PDFs are added afterwards.</p>
        </div></section>
      ) : (
        <>
          <div className={`callout ${pv.errorCount ? 'warn' : 'ok'}`}><Icon name="info" /><div><b>{pv.validRows} of {pv.totalRows} rows are ready to import</b><span>{pv.errorCount ? `${pv.errorCount} row${pv.errorCount === 1 ? ' has' : 's have'} problems and will be skipped.` : 'No problems found.'} File: {pv.fileName}</span></div></div>
          {pv.errorCount > 0 && (
            <section className="card" style={{ marginBottom: 16 }}>
              <div className="card-h"><h3>Rows with problems</h3><a className="btn sm" href={`/api/imports/${pv.id}/errors.csv`}><Icon name="download" size={16} />Error report</a></div>
              {pv.errors.slice(0, 20).map((e) => <div className="pref" style={{ padding: '10px 18px' }} key={e.row}><div><b>Row {e.row}</b> <span className="muted">{e.message}</span></div></div>)}
              {pv.errorCount > 20 && <div className="empty">And {pv.errorCount - 20} more in the error report.</div>}
            </section>
          )}
          {pv.preview.length > 0 && (
            <section className="card">
              <div className="card-h"><h3>First {pv.preview.length} valid rows</h3></div>
              {pv.preview.map((r, i) => <div className="pref" style={{ padding: '10px 18px' }} key={i}><div><b>{r.payee}</b><br /><small className="muted">{fmtDate(r.receiptDate)}{r.form?.invoiceNo ? ` · ${r.form.invoiceNo}` : ''}{r.form === null ? ' · invoice details to fill in' : ''}{r.description ? ` · ${r.description}` : ''}</small></div><b>{money(r.amount)}</b></div>)}
            </section>
          )}
          <div className="formbar">
            <button className="btn" onClick={() => setPv(null)}>Choose another file</button>
            <button className="btn pri" disabled={!pv.validRows || confirm.isPending} onClick={() => confirm.mutate()}>Import {pv.validRows} draft{pv.validRows === 1 ? '' : 's'}</button>
          </div>
        </>
      )}
    </>
  );
}
