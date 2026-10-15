import { useQuery } from '@tanstack/react-query';
import { api, money } from '../api';
import type { PaymentQueue } from '../types';
import { Empty } from '../ui';
import { ReceiptRow } from './Receipts';

export function ReadyToPayPage() {
  const q = useQuery({ queryKey: ['payments-queue'], queryFn: () => api<PaymentQueue>('/payments/queue'), refetchInterval: 30_000 });
  const groups = q.data?.groups ?? [];
  return (
    <>
      <div className="ph">
        <div><h1>Ready to pay</h1><p>Approved receipts waiting for payment, by person. One payment covers one person's receipts.</p></div>
        {q.data && <div className="muted" style={{ textAlign: 'right' }}><b style={{ display: 'block', fontSize: '1.3rem', color: 'var(--ink)' }}>{money(q.data.totals.total)}</b>{q.data.totals.count} receipt{q.data.totals.count === 1 ? '' : 's'}</div>}
      </div>
      {!q.data && <div className="empty">Loading…</div>}
      {q.data && !groups.length && <Empty title="Nothing to pay">Every approved receipt has been paid.</Empty>}
      <div className="stack">
        {groups.map((g) => (
          <section key={g.payee.id} className="card">
            <div className="card-h"><h2>{g.payee.name}</h2><small>{g.payee.branch ? `${g.payee.branch} · ` : ''}{g.count} receipt{g.count === 1 ? '' : 's'} · {money(g.total)}</small></div>
            {g.receipts.map((r) => <ReceiptRow key={r.id} r={r} showEncoder={false} />)}
          </section>
        ))}
      </div>
    </>
  );
}
