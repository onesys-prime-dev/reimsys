import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { paymentIssues, totalOf } from '@reimsys/shared';
import { api, errMsg, localToday, money } from '../api';
import { Field, Modal, useToast } from '../ui';

export interface PayLine { id: number; refNo: string; vendor: string; amount: number; version: number }

/** Records one payment for one person's receipts: the date, how it was paid, the proof, and what was paid on each receipt. */
export function PayDialog({ payee, lines, onClose, onDone }: { payee: string; lines: PayLine[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const methods = useQuery({ queryKey: ['payment-methods'], queryFn: () => api<{ methods: string[] }>('/payments/methods') });
  const [method, setMethod] = useState('');
  const [paidOn, setPaidOn] = useState(localToday());
  const [file, setFile] = useState<File | null>(null);
  const [amounts, setAmounts] = useState<Record<number, string>>(() => Object.fromEntries(lines.map((l) => [l.id, String(l.amount)])));
  const [reasons, setReasons] = useState<Record<number, string>>({});

  const chosen = method || methods.data?.methods[0] || '';
  const parsed = lines.map((l) => ({ receiptId: l.id, version: l.version, amount: Math.round(Number(amounts[l.id]) * 100) / 100, shortReason: (reasons[l.id] ?? '').trim() || null }));
  const badAmount = (id: number) => { const n = parsed.find((p) => p.receiptId === id)!.amount; return !Number.isFinite(n) || n <= 0; };
  const issues = paymentIssues({ paidOn, lines: parsed.filter((p) => !badAmount(p.receiptId)) }, new Map(lines.map((l) => [l.id, l.amount])));
  const issueFor = (id: number) => issues.find((i) => i.receiptId === id && i.code !== 'SHORT_REASON');
  const total = totalOf(parsed.filter((p) => !badAmount(p.receiptId)));
  const ready = !!file && !!chosen && !!paidOn && !issues.length && lines.every((l) => !badAmount(l.id));

  const save = useMutation({
    mutationFn: () => {
      const f = new FormData();
      f.append('method', chosen);
      f.append('paidOn', paidOn);
      f.append('lines', JSON.stringify(parsed));
      f.append('proof', file!);
      return api<{ payment: { paymentNo: string } }>('/payments', { method: 'POST', form: f });
    },
    onSuccess: (d) => {
      toast(`Marked as paid. Payment ${d.payment.paymentNo}.`);
      for (const k of ['payments-queue', 'receipts', 'receipt', 'dashboard', 'history']) qc.invalidateQueries({ queryKey: [k] });
      onDone();
    },
    onError: (e) => { toast(errMsg(e), 'bad'); qc.invalidateQueries({ queryKey: ['payments-queue'] }); },
  });

  return (
    <Modal title={`Mark as paid: ${payee}`} onClose={onClose}>
      <div className="form">
        <Field label="Paid on"><input type="date" value={paidOn} max={localToday()} onChange={(e) => setPaidOn(e.target.value)} /></Field>
        <Field label="Method">
          <select value={chosen} onChange={(e) => setMethod(e.target.value)}>{methods.data?.methods.map((m) => <option key={m}>{m}</option>)}</select>
        </Field>
        <Field label="Proof of payment" hint="Photo or PDF of the transfer, cheque or signed voucher" className="full">
          <input type="file" aria-label="Proof of payment" accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
      </div>
      <div style={{ display: 'grid', gap: 10, margin: '14px 0' }}>
        {lines.map((l) => {
          const p = parsed.find((x) => x.receiptId === l.id)!;
          const short = !badAmount(l.id) && Math.round(p.amount * 100) < Math.round(l.amount * 100);
          const problem = badAmount(l.id) ? 'Enter an amount greater than zero.' : issueFor(l.id)?.message;
          return (
            <div key={l.id} className="callout" style={{ margin: 0, display: 'block' }}>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
                <span><b>{l.vendor}</b><small className="muted" style={{ display: 'block' }}>{l.refNo} · receipt {money(l.amount)}</small></span>
                <input style={{ width: 130, textAlign: 'right' }} inputMode="decimal" aria-label={`Amount paid for ${l.refNo}`} value={amounts[l.id]} onChange={(e) => setAmounts((s) => ({ ...s, [l.id]: e.target.value }))} />
              </div>
              {problem && <span className="err" style={{ display: 'block' }}>{problem}</span>}
              {short && <input style={{ marginTop: 8, width: '100%' }} aria-label={`Why less was paid for ${l.refNo}`} placeholder="Why less than the full amount was paid (required)" maxLength={300} value={reasons[l.id] ?? ''} onChange={(e) => setReasons((s) => ({ ...s, [l.id]: e.target.value }))} />}
            </div>
          );
        })}
      </div>
      {issues.some((i) => i.code === 'DATE_FUTURE') && <p className="err">The payment date cannot be in the future.</p>}
      <p><b>Total {money(total)}</b> · {lines.length} receipt{lines.length === 1 ? '' : 's'}. {payee.split(' ')[0]} will get one email.</p>
      <div className="btns">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn ok" disabled={!ready || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Mark as paid'}</button>
      </div>
    </Modal>
  );
}
