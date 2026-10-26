import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, money } from '../api';

interface Totals {
  receipts: number; answeredYes: number; answeredNo: number; taxWithheld: number; potentialLoss: number; potentialSavings: number;
  incomplete: number; incompleteLoss: number; notEstimable: number;
}
interface Worst { id: number; refNo: string; vendor: string; date: string; employee: string; potentialLoss: number; reasons: string[] }
interface Employee {
  employeeId: number; employee: string; receipts: number; answeredNo: number; incomplete: number; potentialLoss: number; potentialSavings: number; recurring: boolean;
  submissions: { id: number; refNo: string; vendor: string; date: string; potentialLoss: number; reasons: string[] }[];
}
interface Impact { scope: 'all' | 'own'; rate: number; totals: Totals; months: { month: string; potentialLoss: number; potentialSavings: number }[]; worst: Worst[]; employees: Employee[] }

const monthName = (m: string) => new Date(m + '-01T00:00:00').toLocaleDateString('en-PH', { month: 'short', year: '2-digit' });

/** Potential tax loss and savings, and the employee evaluation. Every figure is a potential one, not a verified one, and says so. */
export function TaxImpactSection() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const q = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString();
  const d = useQuery({ queryKey: ['dashboard', 'tax-impact', from, to], queryFn: () => api<Impact>(`/dashboard/tax-impact${q ? `?${q}` : ''}`), refetchInterval: 60_000 });
  const t = d.data?.totals;
  const all = d.data?.scope === 'all';
  const maxBar = Math.max(1, ...(d.data?.months ?? []).map((m) => Math.max(m.potentialLoss, m.potentialSavings)));

  return (
    <section className="card taximpact" aria-labelledby="ti-h" style={{ marginTop: 16 }}>
      <div className="card-h">
        <h2 id="ti-h">Tax withheld: potential loss and savings</h2>
        <div className="btns" style={{ margin: 0 }}>
          <label className="f" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><span>From</span><input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="From date" /></label>
          <label className="f" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><span>To</span><input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="To date" /></label>
        </div>
      </div>
      <div className="card-b">
        <p className="muted" style={{ marginTop: 0 }}>
          {all ? 'All receipts with a BIR invoice.' : 'Your receipts with a BIR invoice.'} These are <b>potential</b> figures, not verified: answering Yes works the tax out on the net amount and answering No on the gross amount, so the difference is the rate times the VAT.
          {d.data && ` Where no rate was entered, the usual rate of ${d.data.rate}% is used.`}
        </p>
        <div className="tilegrid" data-testid="ti-tiles">
          <div className="tile alert"><small>Potential loss (answered No)</small><b data-testid="ti-loss">{t ? money(t.potentialLoss) : '–'}</b></div>
          <div className="tile"><small>Potential savings (answered Yes)</small><b data-testid="ti-savings">{t ? money(t.potentialSavings) : '–'}</b></div>
          <div className="tile"><small>Tax withheld (answered Yes)</small><b data-testid="ti-withheld">{t ? money(t.taxWithheld) : '–'}</b></div>
          <div className="tile"><small>Answered No</small><b data-testid="ti-no">{t ? `${t.answeredNo} of ${t.receipts}` : '–'}</b></div>
          <div className="tile"><small>Incomplete receipts</small><b data-testid="ti-incomplete">{t ? t.incomplete : '–'}</b></div>
        </div>
        {t && t.notEstimable > 0 && <p className="muted" style={{ fontSize: '.86rem' }}>{t.notEstimable} incomplete receipt{t.notEstimable === 1 ? '' : 's'} lack the figures needed to estimate a loss, so {t.notEstimable === 1 ? 'it counts' : 'they count'} as ₱0.00 until the details are completed.</p>}

        {d.data && d.data.months.length > 0 && (
          <div className="tibars" role="img" aria-label="Potential loss and savings by month">
            {d.data.months.map((m) => (
              <div key={m.month} className="tibar">
                <span className="tibar-l">{monthName(m.month)}</span>
                <span className="tibar-t"><i className="loss" style={{ width: `${(m.potentialLoss / maxBar) * 100}%` }} /><i className="save" style={{ width: `${(m.potentialSavings / maxBar) * 100}%` }} /></span>
                <span className="tibar-v">{money(m.potentialLoss)} lost · {money(m.potentialSavings)} saved</span>
              </div>
            ))}
            <div className="tilegend"><span><i className="loss" />Potential loss</span><span><i className="save" />Potential savings</span></div>
          </div>
        )}

        <h3 style={{ marginBottom: 8 }}>Receipts with the largest potential loss or missing details</h3>
        {d.data && !d.data.worst.length && <p className="muted">Nothing to show. No receipt has a potential loss or missing details.</p>}
        {d.data && d.data.worst.length > 0 && (
          <div className="matrix"><table style={{ minWidth: 560 }}>
            <thead><tr><th style={{ textAlign: 'left' }}>Receipt</th>{all && <th style={{ textAlign: 'left' }}>Employee</th>}<th style={{ textAlign: 'left' }}>Why</th><th style={{ textAlign: 'right' }}>Potential loss</th></tr></thead>
            <tbody>{d.data.worst.map((r) => (
              <tr key={r.id}><td><Link to={`/receipts/${r.id}`} style={{ color: 'var(--accent)' }}>{r.refNo}</Link><br /><small className="muted">{r.vendor} · {r.date}</small></td>{all && <td>{r.employee}</td>}<td>{r.reasons.join(', ') || '-'}</td><td style={{ textAlign: 'right' }}>{money(r.potentialLoss)}</td></tr>
            ))}</tbody>
          </table></div>
        )}

        {all && d.data && (
          <>
            <h3 style={{ margin: '20px 0 4px' }}>Employee evaluation</h3>
            <p className="muted" style={{ marginTop: 0 }}>Who answered No or left receipt details incomplete, and what that may have cost. A general view for now: the criteria will be defined later. A flag appears when three or more receipts from the same person have a problem.</p>
            {!d.data.employees.length && <p className="muted">No employee has a potential loss or incomplete receipts.</p>}
            {d.data.employees.length > 0 && (
              <div className="matrix"><table style={{ minWidth: 640 }} data-testid="ti-employees">
                <thead><tr><th style={{ textAlign: 'left' }}>Employee</th><th style={{ textAlign: 'right' }}>Receipts</th><th style={{ textAlign: 'right' }}>Answered No</th><th style={{ textAlign: 'right' }}>Incomplete</th><th style={{ textAlign: 'right' }}>Potential loss</th><th style={{ textAlign: 'right' }}>Potential savings</th></tr></thead>
                <tbody>{d.data.employees.map((e) => (
                  <EmployeeRows key={e.employeeId} e={e} />
                ))}</tbody>
              </table></div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function EmployeeRows({ e }: { e: Employee }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr>
        <td><button type="button" className="btn sm ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? '▾' : '▸'} {e.employee}</button>{e.recurring && <span className="chip" style={{ marginLeft: 6 }} title="Three or more receipts with a problem">Recurring</span>}</td>
        <td style={{ textAlign: 'right' }}>{e.receipts}</td><td style={{ textAlign: 'right' }}>{e.answeredNo}</td><td style={{ textAlign: 'right' }}>{e.incomplete}</td>
        <td style={{ textAlign: 'right' }}>{money(e.potentialLoss)}</td><td style={{ textAlign: 'right' }}>{money(e.potentialSavings)}</td>
      </tr>
      {open && e.submissions.map((s) => (
        <tr key={s.id} className="sub"><td colSpan={2}><Link to={`/receipts/${s.id}`} style={{ color: 'var(--accent)' }}>{s.refNo}</Link> <small className="muted">{s.vendor} · {s.date}</small></td><td colSpan={3}>{s.reasons.join(', ')}</td><td style={{ textAlign: 'right' }}>{money(s.potentialLoss)}</td></tr>
      ))}
    </>
  );
}
