import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, money } from '../api';
import { Icon } from '../ui';

interface Totals {
  receipts: number; answeredYes: number; answeredNo: number; taxWithheld: number; potentialLoss: number; potentialSavings: number;
  incomplete: number; incompleteLoss: number; notEstimable: number;
}
interface Worst { id: number; refNo: string; vendor: string; date: string; employee: string; potentialLoss: number; reasons: string[] }
interface Employee {
  employeeId: number; employee: string; receipts: number; answeredNo: number; incomplete: number; potentialLoss: number; potentialSavings: number; recurring: boolean;
  submissions: { id: number; refNo: string; vendor: string; date: string; potentialLoss: number; reasons: string[] }[];
}
interface Impact { scope: 'all' | 'own'; truncated?: boolean; rate: number; totals: Totals; months: { month: string; potentialLoss: number; potentialSavings: number }[]; worst: Worst[]; employees: Employee[] }

const monthName = (m: string) => new Date(m + "-01T00:00:00").toLocaleDateString("en-PH", { month: "short", year: "numeric" });

/** A small row for the dashboard: the three figures that matter and a link to the page with everything. */
export function TaxImpactSummary() {
  const d = useQuery({ queryKey: ['dashboard', 'tax-impact', '', ''], queryFn: () => api<Impact>('/dashboard/tax-impact'), refetchInterval: 60_000 });
  const t = d.data?.totals;
  return (
    <section className="tisum" aria-labelledby="tis-h" data-testid="ti-summary">
      <div className="tisum-h">
        <h2 id="tis-h">Tax withheld <small>potential, not verified</small></h2>
        <Link className="btn sm ghost" to="/tax-impact">Details and employee evaluation →</Link>
      </div>
      <div className="tisum-t">
        <div className="tile alert"><small>Potential loss (answered No)</small><b>{t ? money(t.potentialLoss) : '–'}</b></div>
        <div className="tile"><small>Potential savings (answered Yes)</small><b>{t ? money(t.potentialSavings) : '–'}</b></div>
        <div className="tile"><small>Answered No</small><b>{t ? `${t.answeredNo} of ${t.receipts}` : '–'}</b></div>
      </div>
    </section>
  );
}

/** The whole picture, on its own page: the filters, every figure, the monthly chart, the largest losses and the employee evaluation. */
export function TaxImpactPage() {
  return (
    <>
      <div className="ph">
        <div><h1>Tax withheld: potential loss and savings</h1><p>What answering No may cost, and what Yes may save.</p></div>
        <Link className="btn" to="/"><Icon name="back" size={16} />Dashboard</Link>
      </div>
      <TaxImpactSection />
    </>
  );
}

type Tab = 'months' | 'worst' | 'employees';

/** Potential tax loss and savings, and the employee evaluation. Every figure is a potential one, not a verified one, and says so. */
function TaxImpactSection() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [tab, setTab] = useState<Tab>('months');
  const q = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString();
  const d = useQuery({ queryKey: ['dashboard', 'tax-impact', from, to], queryFn: () => api<Impact>(`/dashboard/tax-impact${q ? `?${q}` : ''}`), refetchInterval: 60_000 });
  const t = d.data?.totals;
  const all = d.data?.scope === 'all';
  const maxBar = Math.max(1, ...(d.data?.months ?? []).map((m) => Math.max(m.potentialLoss, m.potentialSavings)));
  const shown: Tab = tab === 'employees' && !all ? 'months' : tab;

  return (
    <div className="taximpact stack" aria-label="Tax withheld figures">
      <div className="tifilterbar">
        <span className="muted">{all ? 'All receipts with a BIR invoice' : 'Your receipts with a BIR invoice'}</span>
        <div className="tifilter">
          <label className="f"><span>From</span><input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="From date" /></label>
          <label className="f"><span>To</span><input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="To date" /></label>
          {(from || to) && <button type="button" className="btn sm ghost" onClick={() => { setFrom(''); setTo(''); }}>Clear</button>}
        </div>
      </div>

      <div className="tilegrid" data-testid="ti-tiles">
        <div className="tile alert"><small>Potential loss (answered No)</small><b data-testid="ti-loss">{t ? money(t.potentialLoss) : '–'}</b></div>
        <div className="tile"><small>Potential savings (answered Yes)</small><b data-testid="ti-savings">{t ? money(t.potentialSavings) : '–'}</b></div>
        <div className="tile"><small>Tax withheld (answered Yes)</small><b data-testid="ti-withheld">{t ? money(t.taxWithheld) : '–'}</b></div>
        <div className="tile"><small>Answered No</small><b data-testid="ti-no">{t ? `${t.answeredNo} of ${t.receipts}` : '–'}</b></div>
        <div className="tile"><small>Incomplete receipts</small><b data-testid="ti-incomplete">{t ? t.incomplete : '–'}</b></div>
      </div>

      <details className="tihow">
        <summary>How these figures are worked out</summary>
        <p>They are <b>potential</b> figures, not verified. Answering Yes works the tax out on the net amount (vatable plus VAT-exempt) and answering No on the gross amount, so the difference is the rate times the VAT.{d.data && ` Where no rate was entered, the usual rate of ${d.data.rate}% is used.`}{d.data?.truncated && ' Only the newest 20,000 receipts are counted. Narrow the dates to see the rest.'}</p>
        {t && t.notEstimable > 0 && <p>{t.notEstimable} incomplete receipt{t.notEstimable === 1 ? '' : 's'} lack the figures needed to estimate a loss, so {t.notEstimable === 1 ? 'it counts' : 'they count'} as ₱0.00 until the details are completed.</p>}
      </details>

      <section className="card">
        <div className="tabs tipanes" role="tablist" aria-label="Tax figures">
          <button role="tab" aria-selected={shown === 'months'} className={shown === 'months' ? 'on' : ''} onClick={() => setTab('months')}>By month</button>
          <button role="tab" aria-selected={shown === 'worst'} className={shown === 'worst' ? 'on' : ''} onClick={() => setTab('worst')}>Largest losses{d.data?.worst.length ? <span className="n"> {d.data.worst.length}</span> : null}</button>
          {all && <button role="tab" aria-selected={shown === 'employees'} className={shown === 'employees' ? 'on' : ''} onClick={() => setTab('employees')}>Employee evaluation{d.data?.employees.length ? <span className="n"> {d.data.employees.length}</span> : null}</button>}
        </div>
        <div className="card-b" role="tabpanel">
          {!d.data && <p className="muted">Loading…</p>}

          {d.data && shown === 'months' && (
            d.data.months.length ? (
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
            ) : <p className="muted">No receipts in this period.</p>
          )}

          {d.data && shown === 'worst' && (
            d.data.worst.length ? (
              <div className="matrix"><table style={{ minWidth: 520 }}>
                <thead><tr><th style={{ textAlign: 'left' }}>Receipt</th>{all && <th style={{ textAlign: 'left' }}>Employee</th>}<th style={{ textAlign: 'left' }}>Why</th><th style={{ textAlign: 'right' }}>Potential loss</th></tr></thead>
                <tbody>{d.data.worst.map((r) => (
                  <tr key={r.id}><td><Link to={`/receipts/${r.id}`} style={{ color: 'var(--accent)' }}>{r.refNo}</Link><br /><small className="muted">{r.vendor} · {r.date}</small></td>{all && <td>{r.employee}</td>}<td>{r.reasons.join(', ') || '-'}</td><td style={{ textAlign: 'right' }}>{money(r.potentialLoss)}</td></tr>
                ))}</tbody>
              </table></div>
            ) : <p className="muted">Nothing to show. No receipt has a potential loss or missing details.</p>
          )}

          {d.data && shown === 'employees' && (
            <>
              <p className="muted" style={{ marginTop: 0 }}>Who answered No or left receipt details incomplete, and what that may have cost. A general view for now: the criteria will be defined later. A flag appears when three or more receipts from the same person have a problem.</p>
              {d.data.employees.length ? (
                <div className="matrix"><table style={{ minWidth: 640 }} data-testid="ti-employees">
                  <thead><tr><th style={{ textAlign: 'left' }}>Employee</th><th style={{ textAlign: 'right' }}>Receipts</th><th style={{ textAlign: 'right' }}>Answered No</th><th style={{ textAlign: 'right' }}>Incomplete</th><th style={{ textAlign: 'right' }}>Potential loss</th><th style={{ textAlign: 'right' }}>Potential savings</th></tr></thead>
                  <tbody>{d.data.employees.map((e) => <EmployeeRows key={e.employeeId} e={e} />)}</tbody>
                </table></div>
              ) : <p className="muted">No employee has a potential loss or incomplete receipts.</p>}
            </>
          )}
        </div>
      </section>
    </div>
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
