import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, money } from '../api';
import { Icon, Modal } from '../ui';

interface Totals {
  receipts: number; answeredYes: number; answeredNo: number; taxWithheld: number; potentialLoss: number; potentialSavings: number;
  incomplete: number; incompleteLoss: number; notEstimable: number;
}
interface Worst { id: number; refNo: string; vendor: string; date: string; employee: string; potentialLoss: number; reasons: string[] }
interface Employee {
  employeeId: number; employee: string; receipts: number; answeredNo: number; incomplete: number; potentialLoss: number; potentialSavings: number; recurring: boolean;
  submissions: { id: number; refNo: string; vendor: string; date: string; potentialLoss: number; reasons: string[] }[];
}
interface Cell { receipts: number; answeredNo: number; incomplete: number; potentialLoss: number; potentialSavings: number }
interface EmployeeMonths { months: string[]; employees: { employeeId: number; employee: string; cells: Record<string, Cell> }[] }
interface Impact { scope: 'all' | 'own'; people?: { id: number; name: string }[]; employeeId?: number | null; truncated?: boolean; rate: number; totals: Totals; months: { month: string; potentialLoss: number; potentialSavings: number }[]; worst: Worst[]; employees: Employee[]; employeeMonths?: EmployeeMonths }

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
        {/* each figure opens the report, on the part that explains it */}
        <Link className="tile alert tile-link" to="/tax-impact?tab=worst" aria-label="Potential loss: open the report with the largest losses"><small>Potential loss (answered No)</small><b>{t ? money(t.potentialLoss) : '–'}</b><em aria-hidden="true">See the receipts →</em></Link>
        <Link className="tile tile-link" to="/tax-impact?tab=months" aria-label="Potential savings: open the report by month"><small>Potential savings (answered Yes)</small><b>{t ? money(t.potentialSavings) : '–'}</b><em aria-hidden="true">See by month →</em></Link>
        <Link className="tile tile-link" to="/tax-impact?tab=employees" aria-label="Answered No: open the employee evaluation"><small>Answered No</small><b>{t ? `${t.answeredNo} of ${t.receipts}` : '–'}</b><em aria-hidden="true">See who →</em></Link>
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
  // The dashboard tiles open this page on the part that explains the figure (?tab=worst, months or employees).
  const [params] = useSearchParams();
  const fromTile = params.get('tab');
  // Nothing chosen yet: management lands on the employee evaluation (the part that matters most), a Med Ref on the months.
  const [tab, setTab] = useState<Tab | null>(fromTile === 'worst' || fromTile === 'months' || fromTile === 'employees' ? fromTile : null);
  const [who, setWho] = useState('');
  const [flagged, setFlagged] = useState(false);
  const q = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}), ...(who ? { employeeId: who } : {}), ...(flagged ? { flagged: '1' } : {}) }).toString();
  const d = useQuery({ queryKey: ['dashboard', 'tax-impact', from, to, who, flagged], queryFn: () => api<Impact>(`/dashboard/tax-impact${q ? `?${q}` : ''}`), refetchInterval: 60_000 });
  const t = d.data?.totals;
  const all = d.data?.scope === 'all';
  const maxBar = Math.max(1, ...(d.data?.months ?? []).map((m) => Math.max(m.potentialLoss, m.potentialSavings)));
  const picked: Tab = tab ?? (all ? 'employees' : 'months');
  const shown: Tab = picked === 'employees' && !all ? 'months' : picked;

  return (
    <div className="taximpact stack" aria-label="Tax withheld figures">
      <div className="tifilterbar">
        <span className="muted">{!all ? 'Your receipts with a BIR invoice' : flagged && !who ? 'Receipts with a BIR invoice from people who need attention' : who ? `Receipts with a BIR invoice: ${d.data?.people?.find((p) => String(p.id) === who)?.name ?? ''}` : 'All receipts with a BIR invoice, everyone'}</span>
        <div className="tifilter">
          {all && <label className="f"><span>Employee</span><select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Employee"><option value="">Everyone</option>{(d.data?.people ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
          <label className="f"><span>From</span><input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="From date" /></label>
          <label className="f"><span>To</span><input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="To date" /></label>
          {all && <label className="f ev-only" title="Only people with three or more receipts that have a problem. Every figure on the page follows it."><input type="checkbox" checked={flagged} onChange={(e) => setFlagged(e.target.checked)} aria-label="Only people who need attention" /><span>Only people who need attention</span></label>}
          {(from || to || who || flagged) && <button type="button" className="btn sm ghost" onClick={() => { setFrom(''); setTo(''); setWho(''); setFlagged(false); }}>Clear</button>}
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
          {all && <button role="tab" aria-selected={shown === 'employees'} className={shown === 'employees' ? 'on' : ''} onClick={() => setTab('employees')}>Employee evaluation{d.data?.employees.length ? <span className="n"> {d.data.employees.length}</span> : null}</button>}
          <button role="tab" aria-selected={shown === 'months'} className={shown === 'months' ? 'on' : ''} onClick={() => setTab('months')}>By month</button>
          <button role="tab" aria-selected={shown === 'worst'} className={shown === 'worst' ? 'on' : ''} onClick={() => setTab('worst')}>Largest losses{d.data?.worst.length ? <span className="n"> {d.data.worst.length}</span> : null}</button>
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

          {d.data && shown === 'employees' && <EmployeePane employees={d.data.employees} byMonth={d.data.employeeMonths} />}
        </div>
      </section>
    </div>
  );
}

type SortKey = 'loss' | 'no' | 'receipts' | 'name';
const SORTS: { key: SortKey; label: string }[] = [{ key: 'loss', label: 'Potential loss' }, { key: 'no', label: 'Answered No' }, { key: 'receipts', label: 'Receipts' }, { key: 'name', label: 'Name' }];

/** Who answered No or left details incomplete, ranked. The list is the first thing on the tab; a click on a name opens everything about that person. */
function EmployeePane({ employees, byMonth }: { employees: Employee[]; byMonth?: EmployeeMonths }) {
  const [sort, setSort] = useState<SortKey>('loss');
  const [view, setView] = useState<'whole' | 'months'>('whole');
  const [openMonth, setOpenMonth] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  if (!employees.length) return <p className="muted">No employee has a potential loss or incomplete receipts.</p>;
  const list = [...employees].sort((x, y) => (
    sort === 'name' ? x.employee.localeCompare(y.employee)
    : sort === 'no' ? y.answeredNo - x.answeredNo || y.potentialLoss - x.potentialLoss
    : sort === 'receipts' ? y.receipts - x.receipts || y.potentialLoss - x.potentialLoss
    : y.potentialLoss - x.potentialLoss || y.answeredNo - x.answeredNo));
  const flagged = employees.filter((e) => e.recurring).length;
  const loss = employees.reduce((n, e) => n + e.potentialLoss, 0);
  const maxLoss = Math.max(1, ...employees.map((e) => e.potentialLoss));
  const open = employees.find((e) => e.employeeId === openId) ?? null;
  return (
    <div className="ev" data-testid="ti-eval">
      <div className="ev-bar">
        <p className="ev-line" data-testid="ev-line"><b>{employees.length}</b> {employees.length === 1 ? 'person' : 'people'}{flagged > 0 && <> · <span className="ev-warn"><b>{flagged}</b> need attention</span></>} · potential loss <b>{money(loss)}</b></p>
        <div className="ev-ctl">
          {byMonth && byMonth.months.length > 0 && (
            <div className="seg" role="radiogroup" aria-label="View">
              <button type="button" role="radio" aria-checked={view === 'whole'} className={view === 'whole' ? 'on' : ''} onClick={() => setView('whole')}>Whole period</button>
              <button type="button" role="radio" aria-checked={view === 'months'} className={view === 'months' ? 'on' : ''} onClick={() => setView('months')}>Month by month</button>
            </div>
          )}
          <div className="seg" role="radiogroup" aria-label="Sort the list by">
            {SORTS.map((o) => <button key={o.key} type="button" role="radio" aria-checked={sort === o.key} className={sort === o.key ? 'on' : ''} onClick={() => setSort(o.key)}>{o.label}</button>)}
          </div>
        </div>
      </div>
      {view === 'months' && byMonth ? <MonthMatrix data={byMonth} order={list.map((e) => e.employeeId)} flagged={new Set(employees.filter((e) => e.recurring).map((e) => e.employeeId))} onOpen={(id, month) => { setOpenId(id); setOpenMonth(month); }} /> : null}
      {view === 'whole' && <div className="matrix"><table style={{ minWidth: 680 }} data-testid="ti-employees">
        <thead><tr>
          <th style={{ textAlign: 'left' }}>Employee</th><th style={{ textAlign: 'right' }}>Receipts</th><th style={{ textAlign: 'left', minWidth: 150 }}>Answered No</th>
          <th style={{ textAlign: 'right' }}>Incomplete</th><th style={{ textAlign: 'left', minWidth: 150 }}>Potential loss</th><th style={{ textAlign: 'right' }}>Potential savings</th>
        </tr></thead>
        <tbody>{list.map((e) => <EmployeeRow key={e.employeeId} e={e} maxLoss={maxLoss} onOpen={() => { setOpenId(e.employeeId); setOpenMonth(null); }} />)}</tbody>
      </table></div>}
      <p className="muted ev-note">Ranked by what answering No or leaving details out may have cost. <b>Needs attention</b> means three or more of a person's receipts have a problem. Click a name to see everything about that person. A general view for now: the criteria will be defined later.</p>
      {open && <EmployeeModal e={open} month={openMonth} cell={openMonth ? byMonth?.employees.find((x) => x.employeeId === open.employeeId)?.cells[openMonth] : undefined} onClose={() => { setOpenId(null); setOpenMonth(null); }} />}
    </div>
  );
}

function EmployeeRow({ e, maxLoss, onOpen }: { e: Employee; maxLoss: number; onOpen: () => void }) {
  const pct = e.receipts ? Math.round((e.answeredNo / e.receipts) * 100) : 0;
  return (
    <tr className={e.recurring ? 'ev-flag' : ''}>
      <td>
        <button type="button" className="btn sm ghost ev-name" aria-haspopup="dialog" onClick={onOpen}>{e.employee}</button>
        {e.recurring && <span className="chip warn" style={{ marginLeft: 6 }} title="Three or more receipts with a problem">Needs attention</span>}
      </td>
      <td style={{ textAlign: 'right' }}>{e.receipts}</td>
      <td><div className="ev-meter" title={`${e.answeredNo} of ${e.receipts} receipts`}><span className="ev-track"><i style={{ width: `${pct}%` }} /></span><b>{e.answeredNo}</b><small className="muted">{pct}%</small></div></td>
      <td style={{ textAlign: 'right' }}>{e.incomplete}</td>
      <td><div className="ev-meter"><span className="ev-track loss"><i style={{ width: `${(e.potentialLoss / maxLoss) * 100}%` }} /></span><b>{money(e.potentialLoss)}</b></div></td>
      <td style={{ textAlign: 'right' }}>{money(e.potentialSavings)}</td>
    </tr>
  );
}

const monthLabel = (m: string) => new Date(m + '-01T00:00:00').toLocaleDateString('en-PH', { month: 'short', year: 'numeric' });
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const lastMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

/** Every employee in a row and every month in a column (this month first), so the current month and the past ones can be compared. Click a figure to see that month. */
function MonthMatrix({ data, order, flagged, onOpen }: { data: EmployeeMonths; order: number[]; flagged: Set<number>; onOpen: (id: number, month: string) => void }) {
  const rows = order.map((id) => data.employees.find((e) => e.employeeId === id)).filter((e): e is EmployeeMonths['employees'][number] => !!e);
  const total = (e: (typeof rows)[number]) => Object.values(e.cells).reduce((n, c) => n + c.potentialLoss, 0);
  const colTotal = (m: string) => rows.reduce((n, e) => n + (e.cells[m]?.potentialLoss ?? 0), 0);
  const cur = thisMonth(), prev = lastMonth();
  const tag = (m: string) => (m === cur ? 'This month' : m === prev ? 'Last month' : '');
  return (
    <div className="matrix evm" data-testid="ti-months"><table style={{ minWidth: 420 + data.months.length * 110 }}>
      <thead><tr>
        <th style={{ textAlign: 'left' }}>Employee</th><th style={{ textAlign: 'right' }}>Whole period</th>
        {data.months.map((m) => <th key={m} style={{ textAlign: 'right' }} className={m === cur ? 'evm-cur' : ''}>{monthLabel(m)}{tag(m) && <small>{tag(m)}</small>}</th>)}
      </tr></thead>
      <tbody>
        {rows.map((e) => (
          <tr key={e.employeeId} className={flagged.has(e.employeeId) ? 'ev-flag' : ''}>
            <td><button type="button" className="btn sm ghost ev-name" aria-haspopup="dialog" onClick={() => onOpen(e.employeeId, '')}>{e.employee}</button></td>
            <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(total(e))}</td>
            {data.months.map((m) => {
              const c = e.cells[m];
              return <td key={m} style={{ textAlign: 'right' }} className={m === cur ? 'evm-cur' : ''}>
                {c ? <button type="button" className={`evm-cell ${c.potentialLoss > 0 ? 'bad' : ''}`} aria-label={`${e.employee}, ${monthLabel(m)}: ${money(c.potentialLoss)} potential loss, ${c.answeredNo} answered No of ${c.receipts}`} onClick={() => onOpen(e.employeeId, m)}><b>{money(c.potentialLoss)}</b><small>{c.answeredNo} No · {c.receipts} receipts</small></button> : <span className="muted">–</span>}
              </td>;
            })}
          </tr>
        ))}
        <tr className="evm-total"><td>Everyone</td><td style={{ textAlign: 'right' }}>{money(rows.reduce((n, e) => n + total(e), 0))}</td>{data.months.map((m) => <td key={m} style={{ textAlign: 'right' }} className={m === cur ? 'evm-cur' : ''}>{money(colTotal(m))}</td>)}</tr>
      </tbody>
    </table></div>
  );
}

/** Everything about one person: the figures, how often they answered No, and every receipt with a problem, worst first. */
function EmployeeModal({ e, month, cell, onClose }: { e: Employee; month: string | null; cell?: Cell; onClose: () => void }) {
  const one = !!month;
  const figs = one ? { receipts: cell?.receipts ?? 0, answeredNo: cell?.answeredNo ?? 0, incomplete: cell?.incomplete ?? 0, potentialLoss: cell?.potentialLoss ?? 0, potentialSavings: cell?.potentialSavings ?? 0 } : e;
  const pct = figs.receipts ? Math.round((figs.answeredNo / figs.receipts) * 100) : 0;
  const subs = [...e.submissions].filter((r) => !one || r.date.startsWith(month!)).sort((x, y) => y.potentialLoss - x.potentialLoss);
  return (
    <Modal title={one ? `${e.employee}: ${monthLabel(month!)}` : e.employee} onClose={onClose} className="wide ev-modal">
      <div className="ev-mh">
        {e.recurring ? <span className="chip warn">Needs attention</span> : <span className="chip">No pattern</span>}
      </div>
      <p className="muted" style={{ margin: '0 0 12px' }}>Potential figures, not verified.{e.recurring ? ' Three or more receipts have a problem.' : ''}</p>
      <div className="ev-mt">
        <div><small>Receipts</small><b>{figs.receipts}</b></div>
        <div><small>Answered No</small><b>{figs.answeredNo}</b><em>{pct}% of {one ? 'that month' : 'their receipts'}</em></div>
        <div><small>Incomplete</small><b>{figs.incomplete}</b></div>
        <div className="loss"><small>Potential loss</small><b>{money(figs.potentialLoss)}</b></div>
        <div><small>Potential savings</small><b>{money(figs.potentialSavings)}</b></div>
      </div>
      <h3 style={{ margin: '16px 0 6px' }}>Receipts with a problem{one ? ` in ${monthLabel(month!)}` : ''} <small className="muted">({subs.length}{!one && e.incomplete > subs.length ? ' shown' : ''})</small></h3>
      {subs.length ? (
        <div className="ev-list" data-testid="ev-receipts">
          {subs.map((r) => (
            <Link key={r.id} to={`/receipts/${r.id}`} className="ev-r">
              <span><b>{r.refNo}</b><small className="muted">{r.vendor} · {r.date}</small></span>
              <span className="ev-why">{r.reasons.length ? r.reasons.map((x) => <span key={x} className="chip">{x}</span>) : <span className="muted">-</span>}</span>
              <span className="ev-amt">{money(r.potentialLoss)}</span>
            </Link>
          ))}
        </div>
      ) : <p className="muted">None{one ? ' in this month' : ''}. Every receipt from this person is complete.</p>}
      <div className="btns"><button type="button" className="btn" onClick={onClose}>Close</button></div>
    </Modal>
  );
}
