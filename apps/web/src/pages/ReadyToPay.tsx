import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { totalOf } from '@reimsys/shared';
import { api, money } from '../api';
import { PayDialog } from '../components/PayDialog';
import type { PaymentQueue } from '../types';
import { Empty, Icon } from '../ui';
import { ReceiptRow } from './Receipts';

const isoDay = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

/** Download the payments made in a period, for the accountant's books. */
function ExportPayments() {
  const now = new Date();
  const [from, setFrom] = useState(isoDay(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState(isoDay(now));
  const valid = !!from && !!to && from <= to;
  const qs = `from=${from}&to=${to}`;
  return (
    <details className="card" style={{ marginBottom: 16 }}>
      <summary className="card-h" style={{ cursor: 'pointer' }}><h2>Export payments</h2><small>One row per paid receipt, by payment date</small></summary>
      <div className="card-b" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="field" style={{ margin: 0 }}><span>From</span><input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="field" style={{ margin: 0 }}><span>To</span><input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
        <a className={'btn' + (valid ? '' : ' disabled')} aria-disabled={!valid} href={valid ? `/api/payments/export?format=xlsx&${qs}` : undefined}><Icon name="download" size={18} />Excel</a>
        <a className={'btn' + (valid ? '' : ' disabled')} aria-disabled={!valid} href={valid ? `/api/payments/export?format=csv&${qs}` : undefined}>CSV</a>
      </div>
    </details>
  );
}

export function ReadyToPayPage() {
  const q = useQuery({ queryKey: ['payments-queue'], queryFn: () => api<PaymentQueue>('/payments/queue'), refetchInterval: 30_000 });
  // One payment is for one person, so a selection always belongs to one group. Ticking someone else starts a new selection.
  const [picked, setPicked] = useState<{ payeeId: number; ids: number[] } | null>(null);
  const [paying, setPaying] = useState(false);
  const groups = q.data?.groups ?? [];
  const group = picked ? groups.find((g) => g.payee.id === picked.payeeId) : undefined;
  const chosen = group ? group.receipts.filter((r) => picked!.ids.includes(r.id)) : [];

  const toggle = (payeeId: number, id: number) => setPicked((s) => {
    if (!s || s.payeeId !== payeeId) return { payeeId, ids: [id] };
    const ids = s.ids.includes(id) ? s.ids.filter((x) => x !== id) : [...s.ids, id];
    return ids.length ? { payeeId, ids } : null;
  });
  const selectAll = (payeeId: number, ids: number[]) => setPicked({ payeeId, ids: ids.slice(0, 25) });

  return (
    <>
      <div className="ph">
        <div><h1>Ready to pay</h1><p>Approved receipts waiting for payment, by person. One payment covers one person's receipts.</p></div>
        {q.data && <div className="muted" style={{ textAlign: 'right' }}><b style={{ display: 'block', fontSize: '1.3rem', color: 'var(--ink)' }}>{money(q.data.totals.total)}</b>{q.data.totals.count} receipt{q.data.totals.count === 1 ? '' : 's'}</div>}
      </div>
      <ExportPayments />
      {!q.data && <div className="empty">Loading…</div>}
      {q.data && !groups.length && <Empty title="Nothing to pay">Every approved receipt has been paid.</Empty>}
      <div className="stack scroll">
        {groups.map((g) => (
          <section key={g.payee.id} className="card">
            <div className="card-h">
              <h2>{g.payee.name}</h2>
              <small>{g.payee.branch ? `${g.payee.branch} · ` : ''}{g.count} receipt{g.count === 1 ? '' : 's'} · {money(g.total)}</small>
              {g.count > 1 && <button className="btn sm ghost" onClick={() => selectAll(g.payee.id, g.receipts.map((r) => r.id))}>Select all</button>}
            </div>
            {g.receipts.map((r) => <ReceiptRow key={r.id} r={r} showEncoder={false} pick={{ on: picked?.payeeId === g.payee.id && picked.ids.includes(r.id), toggle: () => toggle(g.payee.id, r.id) }} />)}
          </section>
        ))}
      </div>
      {group && chosen.length > 0 && (
        <div className="savebar" role="region" aria-label="Selected receipts">
          <span>{chosen.length} selected · {group.payee.name} · {money(totalOf(chosen))}</span>
          <span style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => setPicked(null)}>Clear</button>
            <button className="btn ok" onClick={() => setPaying(true)}>Mark as paid</button>
          </span>
        </div>
      )}
      {paying && group && (
        <PayDialog
          payee={group.payee.name}
          lines={chosen.map((r) => ({ id: r.id, refNo: r.refNo, vendor: r.payee, amount: r.amount, version: r.version }))}
          onClose={() => setPaying(false)}
          onDone={() => { setPaying(false); setPicked(null); }}
        />
      )}
    </>
  );
}
