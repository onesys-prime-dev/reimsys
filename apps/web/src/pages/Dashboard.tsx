import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { RECEIPT_STATUSES, STATUS_LABEL, type ReceiptStatus } from '@reimsys/shared';
import { ago, api, money } from '../api';
import { useAuth } from '../auth';
import type { ReceiptBrief } from '../types';
import { Empty, Icon } from '../ui';
import { ReceiptRow } from './Receipts';

interface Dash {
  counts: Record<string, number>;
  sums: Record<string, number>;
  queueTitle: string;
  queueTotal: number;
  paidThisMonth: { count: number; total: number };
  queue: ReceiptBrief[];
  activity: { id: number; actor: string; summary: string; receiptId: number | null; refNo: string | null; createdAt: string }[];
}

const BLURB: Record<string, string> = {
  receipt: 'Encode receipts, attach evidence and track each one.',
  check: 'Verify receipts and evidence, oldest first.',
  decide: 'Only checked records reach you.',
  pay: 'Record payments for approved reimbursements.',
  admin: 'A read-only view of the whole system.',
};

export function DashboardPage() {
  const { me, can } = useAuth();
  const d = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dash>('/dashboard'), refetchInterval: 30_000 });
  const users = useQuery({ queryKey: ['users', 'summary'], enabled: can('user.manage'), queryFn: () => api<{ users: { isActive: boolean }[] }>('/users') });
  if (!me) return null;
  const hr = new Date().getHours();
  const greet = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  const kind = can('review.check') ? 'check' : can('review.decide') ? 'decide' : can('receipt.create') ? 'receipt' : can('payment.mark') ? 'pay' : 'admin';
  const c = d.data?.counts ?? {};
  const n = (...s: ReceiptStatus[]) => s.reduce((t, k) => t + (c[k] ?? 0), 0);

  const tiles: { label: string; value: string | number; to: string; alert?: boolean }[] =
    kind === 'receipt' ? [
      { label: 'Needs your action', value: n('returned', 'reserved'), to: '/receipts', alert: true },
      { label: 'In review', value: n('submitted', 'checked'), to: '/receipts' },
      { label: 'Approved, not paid', value: n('approved'), to: '/receipts' },
      { label: 'Paid', value: n('paid'), to: '/receipts' },
    ] : kind === 'check' ? [
      { label: 'To check', value: n('submitted'), to: '/receipts', alert: true },
      { label: 'Checked', value: n('checked'), to: '/receipts' },
      { label: 'Approved, not paid', value: n('approved'), to: '/receipts' },
      { label: 'Paid', value: n('paid'), to: '/receipts' },
    ] : kind === 'decide' ? [
      { label: 'To decide', value: n('checked'), to: '/receipts', alert: true },
      { label: 'On hold', value: n('reserved'), to: '/receipts' },
      { label: 'Approved, not paid', value: money(d.data?.sums.approved ?? 0), to: '/receipts' },
      { label: 'Paid', value: money(d.data?.sums.paid ?? 0), to: '/receipts' },
    ] : kind === 'pay' ? [
      { label: 'To pay', value: n('approved'), to: '/pay', alert: true },
      { label: 'Waiting to be paid', value: money(d.data?.sums.approved ?? 0), to: '/pay' },
      { label: 'Paid this month', value: money(d.data?.paidThisMonth.total ?? 0), to: '/receipts' },
      { label: 'Paid', value: n('paid'), to: '/receipts' },
    ] : [
      { label: 'Waiting for review', value: n('submitted', 'checked'), to: '/receipts', alert: true },
      { label: 'All receipts', value: Object.values(c).reduce((a, b) => a + b, 0), to: '/receipts' },
      { label: 'Active users', value: users.data ? users.data.users.filter((u) => u.isActive).length : '–', to: '/access' },
      { label: 'Approved total (incl. paid)', value: money((d.data?.sums.approved ?? 0) + (d.data?.sums.paid ?? 0)), to: '/receipts' },
    ];

  return (
    <>
      <div className="ph">
        <div><h1>{greet}, {me.name.split(' ')[0]}</h1><p>{BLURB[kind]}</p></div>
        {can('receipt.create') && <Link className="btn pri" to="/receipts/new"><Icon name="plus" size={18} />New receipt</Link>}
      </div>

      <div className="tiles">
        {tiles.map((t) => <Link key={t.label} className={`tile ${t.alert ? 'alert' : ''}`} to={t.to}><small>{t.label}</small><b>{d.data ? t.value : '–'}</b></Link>)}
      </div>

      <div className="grid2">
        <div className="stack">
        <section className="card">
          <div className="card-h"><h2>{d.data?.queueTitle ?? 'Your queue'}</h2>{d.data && d.data.queueTotal > d.data.queue.length && <Link className="btn sm ghost" to={kind === 'pay' ? '/pay' : '/receipts'}>View all {d.data.queueTotal}</Link>}</div>
          {d.data?.queue.map((r) => <ReceiptRow key={r.id} r={r} showEncoder={kind !== 'receipt'} />)}
          {d.data && !d.data.queue.length && <Empty title="You are all caught up">Nothing needs your attention right now.</Empty>}
          {!d.data && <div className="empty">Loading…</div>}
        </section>
        <section className="card">
          <div className="card-h"><h2>Receipts by status</h2><small>{Object.values(c).reduce((a, b) => a + b, 0)} in total</small></div>
          <div className="card-b">
            {RECEIPT_STATUSES.filter((s) => c[s]).map((s) => {
              const total = Math.max(1, ...Object.values(c));
              return (
                <Link key={s} to="/receipts" className="bar-row" style={{ color: 'inherit', textDecoration: 'none' }}>
                  <span>{STATUS_LABEL[s as ReceiptStatus]}</span>
                  <span className="track"><span className="fill" style={{ width: `${((c[s] ?? 0) / total) * 100}%` }} /></span>
                  <b style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{c[s]}</b>
                </Link>
              );
            })}
            {d.data && !Object.keys(c).length && <span className="muted">No receipts yet.</span>}
          </div>
        </section>
        </div>
        <section className="card">
          <div className="card-h"><h2>Recent activity</h2>{can('audit.view') && <Link className="btn sm ghost" to="/audit">Audit log</Link>}</div>
          <div className="card-b">
            <ol className="tl">
              {d.data?.activity.slice(0, 6).map((a) => (
                <li key={a.id}><span className="dot" /><div><b>{a.actor}</b> {a.summary.charAt(0).toLowerCase() + a.summary.slice(1)} {a.receiptId && a.refNo && <Link to={`/receipts/${a.receiptId}`} style={{ color: 'var(--accent)' }}>{a.refNo}</Link>}<small>{ago(a.createdAt)}</small></div></li>
              ))}
            </ol>
            {d.data && !d.data.activity.length && <span className="muted">No activity yet.</span>}
          </div>
        </section>
      </div>
    </>
  );
}
