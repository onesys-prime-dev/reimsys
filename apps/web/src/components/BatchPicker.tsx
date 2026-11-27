import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { fmtCutoff } from '@reimsys/shared';
import { api, errMsg } from '../api';
import type { ReceiptDetail } from '../types';
import { Field, Modal, useToast } from '../ui';

interface Choice { id: number; code: string; name: string | null; cutoffAt: string | null; timeZone: string }

/** The Med Ref puts their own receipt in a batch, moves it, or takes it out. A draft keeps the choice and joins when submitted. */
export function BatchPicker({ r, onClose }: { r: ReceiptDetail; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const choices = useQuery({ queryKey: ['batch-choices'], queryFn: () => api<{ batches: Choice[] }>('/receipts/batch-choices') });
  const list = choices.data?.batches ?? [];
  const now = r.status === 'draft' ? r.wantBatch : r.batch;
  const [pick, setPick] = useState(String(now?.id ?? ''));
  // In a batch that is closed or cut off: only Accounting can move it now.
  const stuck = r.batch && choices.data && !list.some((b) => b.id === r.batch!.id);
  const save = useMutation({
    mutationFn: () => api<{ receipt: ReceiptDetail }>(`/receipts/${r.id}/batch`, { method: 'PUT', body: { batchId: pick ? Number(pick) : null } }),
    onSuccess: (d) => {
      qc.setQueryData(['receipt', r.id], { receipt: d.receipt });
      for (const k of ['receipts', 'history', 'batch-choices']) qc.invalidateQueries({ queryKey: [k] });
      const b = r.status === 'draft' ? d.receipt.wantBatch : d.receipt.batch;
      toast(b ? (r.status === 'draft' ? `It joins ${b.code} when you submit.` : `Now in batch ${b.code}.`) : 'Not in a batch now.');
      onClose();
    },
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  return (
    <Modal title={now ? 'Change the batch' : 'Choose a batch'} onClose={onClose}>
      {stuck ? (
        <p style={{ marginTop: 0 }} data-testid="batch-stuck">It is in batch {r.batch!.code}, which is closed or already cut off. Only Accounting can move it now.</p>
      ) : (
        <>
          <p style={{ marginTop: 0 }}>The batch Accounting will process this receipt with. {r.status === 'draft' ? 'It joins the batch when you submit.' : 'It moves there now.'} Only open batches whose cutoff has not passed are listed.</p>
          <Field label="Batch">
            <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Batch" disabled={!choices.data}>
              <option value="">No batch</option>
              {list.map((b) => <option key={b.id} value={b.id}>{b.code}{b.name ? ` · ${b.name}` : ''}{b.cutoffAt ? ` (cutoff ${fmtCutoff(b.cutoffAt, b.timeZone)})` : ''}</option>)}
              {now && choices.data && !list.some((b) => b.id === now.id) && <option value={now.id} disabled>{now.code} (closed now)</option>}
            </select>
          </Field>
          {choices.data && !list.length && <p className="muted">There is no open batch right now. Accounting makes them.</p>}
        </>
      )}
      <div className="btns">
        <button className="btn" type="button" onClick={onClose}>{stuck ? 'Close' : 'Cancel'}</button>
        {!stuck && <button className="btn pri" type="button" disabled={save.isPending || !choices.data || pick === String(now?.id ?? '')} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save'}</button>}
      </div>
    </Modal>
  );
}
