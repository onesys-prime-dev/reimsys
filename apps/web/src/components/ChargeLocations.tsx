import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errMsg } from '../api';
import { Icon, Switch, useToast } from '../ui';

interface Loc { id: number; name: string; isActive: boolean; receiptCount?: number }

/** The places a receipt can be charged to ("Choose where to charge" on the form). An administrator adds, renames and switches them off here. */
export function ChargeLocationsCard() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['charge-locations', 'all'], queryFn: () => api<{ locations: Loc[] }>('/charge-locations?all=true') });
  const [name, setName] = useState('');
  const [edit, setEdit] = useState<Record<number, string>>({});
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['charge-locations'] }); };
  const add = useMutation({
    mutationFn: () => api('/charge-locations', { method: 'POST', body: { name } }),
    onSuccess: () => { setName(''); refresh(); toast('Added.'); },
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  const change = useMutation({
    mutationFn: (v: { id: number; body: { name?: string; isActive?: boolean } }) => api(`/charge-locations/${v.id}`, { method: 'PATCH', body: v.body }),
    onSuccess: (_d, v) => { setEdit((x) => { const n = { ...x }; delete n[v.id]; return n; }); refresh(); toast('Saved.'); },
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  return (
    <section className="card" style={{ marginTop: 16 }} aria-labelledby="cl-h">
      <div className="card-h"><h3 id="cl-h">Where to charge</h3><small>The choices on the last page of the reimbursement form</small></div>
      <div className="card-b" style={{ display: 'grid', gap: 10 }}>
        {q.data?.locations.map((l) => (
          <div key={l.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input style={{ flex: '1 1 260px', minWidth: 0 }} value={edit[l.id] ?? l.name} maxLength={120} aria-label={`Name of ${l.name}`} onChange={(e) => setEdit((x) => ({ ...x, [l.id]: e.target.value }))} />
            {edit[l.id] !== undefined && edit[l.id] !== l.name && <button className="btn sm pri" type="button" disabled={change.isPending} onClick={() => change.mutate({ id: l.id, body: { name: edit[l.id]! } })}>Save name</button>}
            <small className="muted">{l.receiptCount ?? 0} receipt{l.receiptCount === 1 ? '' : 's'}</small>
            <Switch checked={l.isActive} label={`${l.name} is offered on the form`} onChange={(v) => change.mutate({ id: l.id, body: { isActive: v } })} />
          </div>
        ))}
        {q.data && !q.data.locations.length && <span className="muted">The list is empty, so nobody can submit a receipt. Add a place.</span>}
        <div style={{ display: 'flex', gap: 8 }}>
          <input style={{ flex: 1, minWidth: 0 }} value={name} maxLength={120} placeholder="Add a place, for example a hospital or company" aria-label="New place to charge" onChange={(e) => setName(e.target.value)} />
          <button className="btn sm" type="button" disabled={name.trim().length < 2 || add.isPending} onClick={() => add.mutate()}><Icon name="plus" size={16} />Add</button>
        </div>
        <span className="muted" style={{ fontSize: '.86rem' }}>Switching a place off hides it from new receipts. Receipts already charged to it keep it.</span>
      </div>
    </section>
  );
}
