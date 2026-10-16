import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { paymentMethodsSchema } from '@reimsys/shared';
import { api, errMsg } from '../api';
import { Icon, useToast } from '../ui';

/** The list Accounting picks from when marking a receipt paid. */
export function PaymentMethodsCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['payment-methods'], queryFn: () => api<{ methods: string[] }>('/payments/methods') });
  const [draft, setDraft] = useState<string[]>([]);
  useEffect(() => { if (q.data) setDraft(q.data.methods); }, [q.data]);
  const parsed = paymentMethodsSchema.safeParse({ methods: draft });
  const dirty = JSON.stringify(draft) !== JSON.stringify(q.data?.methods ?? []);
  const save = useMutation({
    mutationFn: () => api<{ methods: string[] }>('/payments/methods', { method: 'PUT', body: { methods: draft } }),
    onSuccess: (d) => { qc.setQueryData(['payment-methods'], d); toast('Payment methods saved.'); },
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  return (
    <section className="card">
      <div className="card-h"><h2>Payment methods</h2><small>What Accounting can choose when marking a receipt paid</small></div>
      <div className="card-b" style={{ display: 'grid', gap: 8 }}>
        {draft.map((m, i) => (
          <div key={i} style={{ display: 'flex', gap: 8 }}>
            <input value={m} maxLength={40} aria-label={`Payment method ${i + 1}`} onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? e.target.value : x)))} />
            <button className="btn sm" type="button" aria-label={`Remove ${m || 'this method'}`} disabled={draft.length <= 1} onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}><Icon name="x" size={16} /></button>
          </div>
        ))}
        {!parsed.success && <span className="err">{parsed.error.issues[0]?.message}</span>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <button className="btn sm" type="button" disabled={draft.length >= 12} onClick={() => setDraft((d) => [...d, ''])}><Icon name="plus" size={16} />Add a method</button>
          <button className="btn pri sm" type="button" disabled={!dirty || !parsed.success || save.isPending} onClick={() => save.mutate()}>Save methods</button>
        </div>
      </div>
    </section>
  );
}
