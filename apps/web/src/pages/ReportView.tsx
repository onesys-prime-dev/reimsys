import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { PAYMENT_FILTER_LABEL } from '@reimsys/shared';
import { api, fmtDate, fmtDateTime, money, printUrl } from '../api';
import { Empty, Icon } from '../ui';

interface Data {
  report: { id: number; format: string; status: string; from: string; to: string; person: string | null; category: string | null; payment: 'all' | 'paid' | 'unpaid'; createdAt: string; requestedBy: string };
  rows: { docNo: string; refNo: string; date: string; invoiceNo: string; payee: string; category: string; vatType: string; vat: number; wht: number; encoder: string; approvedAt: string; amount: number; paid: boolean; paidAmount: number; paidOn: string; method: string }[];
  total: number;
  totals: { gross: number; vatable: number; vat: number; wht: number; paid: number; unpaid: number };
  byCategory: { category: string; count: number; total: number }[];
  byPerson: { person: string; count: number; total: number }[];
}

export function ReportViewPage() {
  const id = Number(useParams().id);
  const q = useQuery({ queryKey: ['report-data', id], queryFn: () => api<Data>(`/reports/${id}/data`), refetchInterval: (x) => (x.state.data?.report.status === 'pending' ? 1500 : false) });
  if (q.isError) return <Empty title="Report not found">It may belong to someone else. <Link to="/reports" style={{ color: 'var(--accent)' }}>Back to reports</Link></Empty>;
  if (!q.data) return <div className="empty">Loading…</div>;
  const { report: r, rows, total, totals, byCategory, byPerson } = q.data;
  const ready = r.status === 'ready';

  return (
    <>
      <Link className="back" to="/reports"><Icon name="back" size={18} />Back to reports</Link>
      <div className="dh">
        <div className="ttl">
          <h1>Liquidation report{r.person ? ` · ${r.person}` : ''}</h1>
          <div className="meta"><span className="muted">{fmtDate(r.from)} to {fmtDate(r.to)}{r.category ? ` · ${r.category}` : ''}{r.payment !== 'all' ? ` · ${PAYMENT_FILTER_LABEL[r.payment]}` : ''}</span><span className="muted">· generated {fmtDateTime(r.createdAt)}{r.requestedBy ? ` by ${r.requestedBy}` : ''}</span></div>
        </div>
        <div className="actionbar">
          {ready && <a className="btn" href={`/api/reports/${r.id}/file`}><Icon name="download" size={18} />Download {r.format.toUpperCase()}</a>}
          {ready && r.format === 'pdf' && <button className="btn" onClick={() => printUrl(`/api/reports/${r.id}/file?mode=print`)}><Icon name="print" size={18} />Print</button>}
        </div>
      </div>

      <div className="tiles">
        <div className="tile alert"><small>Approved total</small><b>{money(total)}</b></div>
        <div className="tile"><small>Paid</small><b>{money(totals.paid)}</b></div>
        <div className="tile"><small>Not yet paid</small><b>{money(totals.unpaid)}</b></div>
        <div className="tile"><small>Records</small><b>{rows.length}</b></div>
      </div>

      {byPerson.length > 1 && (
        <section className="card" style={{ marginBottom: 16 }}>
          <div className="card-h"><h3>By person</h3></div>
          <div className="card-b">
            {byPerson.map((p) => (
              <div key={p.person} className="bar-row" style={{ gridTemplateColumns: 'minmax(110px,170px) 1fr auto' }}>
                <span>{p.person} <small className="muted">({p.count})</small></span>
                <span className="track"><span className="fill" style={{ width: `${total ? (p.total / total) * 100 : 0}%` }} /></span>
                <b style={{ fontVariantNumeric: 'tabular-nums' }}>{money(p.total)}</b>
              </div>
            ))}
          </div>
        </section>
      )}

      {byCategory.length > 0 && (
        <section className="card" style={{ marginBottom: 16 }}>
          <div className="card-h"><h3>By type</h3></div>
          <div className="card-b">
            {byCategory.map((c) => (
              <div key={c.category} style={{ display: 'grid', gridTemplateColumns: 'minmax(90px,150px) 1fr auto', gap: 12, alignItems: 'center', padding: '5px 0' }}>
                <span>{c.category} <small className="muted">({c.count})</small></span>
                <span style={{ height: 8, borderRadius: 4, background: 'var(--soft)', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: `${total ? (c.total / total) * 100 : 0}%`, background: 'var(--accent)' }} /></span>
                <b style={{ fontVariantNumeric: 'tabular-nums' }}>{money(c.total)}</b>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card scroll">
        <div className="matrix">
          <table style={{ minWidth: 820 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Document</th><th style={{ textAlign: 'left' }}>Date</th>
                <th style={{ textAlign: 'left' }}>Invoice no.</th><th style={{ textAlign: 'left' }}>Vendor</th><th style={{ textAlign: 'left' }}>Type</th><th style={{ textAlign: 'right' }}>VAT</th><th style={{ textAlign: 'right' }}>Tax withheld</th><th style={{ textAlign: 'right' }}>Paid</th><th style={{ textAlign: 'right' }}>Gross</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.refNo}>
                  <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}><b>{x.docNo}</b><br /><small className="muted">{x.refNo}</small></td>
                  <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>{fmtDate(x.date)}</td>
                  <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>{x.invoiceNo || '-'}</td>
                  <td style={{ textAlign: 'left' }}>{x.payee}<br /><small className="muted">{x.encoder}</small></td>
                  <td style={{ textAlign: 'left' }}>{x.category}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(x.vat)}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(x.wht)}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{x.paid ? <>{money(x.paidAmount)}<br /><small className="muted">{fmtDate(x.paidOn)} · {x.method}</small></> : <span className="muted">Not yet</span>}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{money(x.amount)}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={9}><Empty title="No approved records in this range" /></td></tr>}
            </tbody>
            {rows.length > 0 && <tfoot><tr><td colSpan={5} style={{ textAlign: 'right', fontWeight: 600 }}>Total</td><td style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{money(totals.vat)}</td><td style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{money(totals.wht)}</td><td style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{money(totals.paid)}</td><td style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{money(total)}</td></tr></tfoot>}
          </table>
        </div>
      </section>
      <p className="muted" style={{ fontSize: '.84rem' }}>Only approved records appear in a liquidation report, paid or not yet paid.</p>
    </>
  );
}
