import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api, fmtDate, fmtDateTime, money, printUrl } from '../api';
import { Empty, Icon } from '../ui';

interface Data {
  report: { id: number; format: string; status: string; from: string; to: string; createdAt: string; requestedBy: string };
  rows: { docNo: string; refNo: string; date: string; payee: string; category: string; encoder: string; approvedAt: string; amount: number }[];
  total: number;
  byCategory: { category: string; count: number; total: number }[];
}

export function ReportViewPage() {
  const id = Number(useParams().id);
  const q = useQuery({ queryKey: ['report-data', id], queryFn: () => api<Data>(`/reports/${id}/data`), refetchInterval: (x) => (x.state.data?.report.status === 'pending' ? 1500 : false) });
  if (q.isError) return <Empty title="Report not found">It may belong to someone else. <Link to="/reports" style={{ color: 'var(--accent)' }}>Back to reports</Link></Empty>;
  if (!q.data) return <div className="empty">Loading…</div>;
  const { report: r, rows, total, byCategory } = q.data;
  const ready = r.status === 'ready';

  return (
    <>
      <Link className="back" to="/reports"><Icon name="back" size={18} />Back to reports</Link>
      <div className="dh">
        <div className="ttl">
          <h1>Liquidation report</h1>
          <div className="meta"><span className="muted">{fmtDate(r.from)} to {fmtDate(r.to)}</span><span className="muted">· generated {fmtDateTime(r.createdAt)}{r.requestedBy ? ` by ${r.requestedBy}` : ''}</span></div>
        </div>
        <div className="actionbar">
          {ready && <a className="btn" href={`/api/reports/${r.id}/file`}><Icon name="download" size={18} />Download {r.format.toUpperCase()}</a>}
          {ready && r.format === 'pdf' && <button className="btn" onClick={() => printUrl(`/api/reports/${r.id}/file?mode=print`)}><Icon name="print" size={18} />Print</button>}
        </div>
      </div>

      <div className="tiles">
        <div className="tile alert"><small>Approved total</small><b>{money(total)}</b></div>
        <div className="tile"><small>Records</small><b>{rows.length}</b></div>
        <div className="tile"><small>Average</small><b>{money(rows.length ? total / rows.length : 0)}</b></div>
      </div>

      {byCategory.length > 0 && (
        <section className="card" style={{ marginBottom: 16 }}>
          <div className="card-h"><h3>By category</h3></div>
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

      <section className="card">
        <div className="matrix">
          <table style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Document</th><th style={{ textAlign: 'left' }}>Receipt</th><th style={{ textAlign: 'left' }}>Date</th>
                <th style={{ textAlign: 'left' }}>Paid to</th><th style={{ textAlign: 'left' }}>Category</th><th style={{ textAlign: 'left' }}>Encoded by</th><th style={{ textAlign: 'right' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.refNo}>
                  <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}><b>{x.docNo}</b></td>
                  <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>{x.refNo}</td>
                  <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>{fmtDate(x.date)}</td>
                  <td style={{ textAlign: 'left' }}>{x.payee}</td>
                  <td style={{ textAlign: 'left' }}>{x.category}</td>
                  <td style={{ textAlign: 'left' }}>{x.encoder}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{money(x.amount)}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={7}><Empty title="No approved records in this range" /></td></tr>}
            </tbody>
            {rows.length > 0 && <tfoot><tr><td colSpan={6} style={{ textAlign: 'right', fontWeight: 600 }}>Total</td><td style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{money(total)}</td></tr></tfoot>}
          </table>
        </div>
      </section>
      <p className="muted" style={{ fontSize: '.84rem' }}>Only approved records appear in a liquidation report.</p>
    </>
  );
}
