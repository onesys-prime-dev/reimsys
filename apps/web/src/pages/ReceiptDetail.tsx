import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { ReceiptAction } from '@reimsis/shared';
import { api, errMsg, fmtDate, fmtDateTime, money, printUrl } from '../api';
import { useAuth } from '../auth';
import { EvidenceViewer } from '../components/EvidenceViewer';
import type { HistoryItem, ReceiptDetail } from '../types';
import { Empty, Icon, Modal, StatusPill, useToast } from '../ui';

const COPY: Record<ReceiptAction, { label: string; icon: string; cls: string; title: string; desc: string; field: string; ok: string }> = {
  submit: { label: 'Submit for checking', icon: 'check', cls: 'pri', title: '', desc: '', field: '', ok: 'Submitted. Checkers have been notified.' },
  check: { label: 'Mark checked', icon: 'check', cls: 'pri', title: 'Mark as checked', desc: 'Add remarks for the Approver. Optional.', field: 'Remarks', ok: 'Marked as checked. Approvers have been notified.' },
  return: { label: 'Return', icon: 'undo', cls: '', title: 'Return to Med Ref', desc: 'Tell the Med Ref what to fix. They will get an email.', field: 'What needs to be corrected', ok: 'Returned. The Med Ref has been emailed.' },
  approve: { label: 'Approve', icon: 'check', cls: 'ok', title: 'Approve this record', desc: 'A reimbursement document will be created and the Med Ref will be emailed.', field: 'Remark', ok: 'Approved. The reimbursement document is being prepared.' },
  disapprove: { label: 'Disapprove', icon: 'x', cls: 'bad', title: 'Disapprove this record', desc: 'A reason is required. The Med Ref will see it in the email.', field: 'Reason for disapproval', ok: 'Disapproved. The Med Ref has been emailed.' },
  reserve: { label: 'Reserve', icon: 'pause', cls: 'hold', title: 'Put this record on hold', desc: 'A note is required. You can release it back to your queue later.', field: 'Why is it on hold', ok: 'Put on hold. The Med Ref has been emailed.' },
  release: { label: 'Release to queue', icon: 'check', cls: 'pri', title: 'Release the hold', desc: 'The record returns to your approval queue.', field: 'Remark', ok: 'Released. The record is back in your queue.' },
};
const ORDER: ReceiptAction[] = ['return', 'disapprove', 'reserve', 'check', 'approve', 'release', 'submit'];

export function ReceiptDetailPage() {
  const id = Number(useParams().id);
  const { me } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [modal, setModal] = useState<ReceiptAction | null>(null);
  const [allHistory, setAllHistory] = useState(false);

  const q = useQuery({
    queryKey: ['receipt', id],
    queryFn: () => api<{ receipt: ReceiptDetail }>(`/receipts/${id}`),
    // The document is built in the background, so keep checking until it is ready.
    refetchInterval: (query) => (query.state.data?.receipt.document?.status === 'pending' ? 1500 : false),
  });
  const history = useQuery({ queryKey: ['history', id], queryFn: () => api<{ items: HistoryItem[] }>(`/receipts/${id}/history`), enabled: q.isSuccess });
  const r = q.data?.receipt;

  const refresh = () => { qc.invalidateQueries({ queryKey: ['receipt', id] }); qc.invalidateQueries({ queryKey: ['history', id] }); qc.invalidateQueries({ queryKey: ['receipts'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); };
  const act = useMutation({
    mutationFn: ({ action, note }: { action: ReceiptAction; note?: string }) => api<{ receipt: ReceiptDetail }>(`/receipts/${id}/${action}`, { method: 'POST', body: { note, version: r!.version } }),
    onSuccess: (d, v) => { qc.setQueryData(['receipt', id], d); toast(COPY[v.action].ok); setModal(null); refresh(); },
    onError: (e) => { toast(errMsg(e), 'bad'); setModal(null); refresh(); },
  });
  const copy = useMutation({
    mutationFn: () => api<{ receipt: ReceiptDetail }>(`/receipts/${id}/copy`, { method: 'POST' }),
    onSuccess: (d) => { toast('Copied into a new draft.'); qc.invalidateQueries({ queryKey: ['receipts'] }); nav(`/receipts/${d.receipt.id}`); },
    onError: (e) => toast(errMsg(e), 'bad'),
  });

  if (q.isError) return <Empty title="Receipt not found">It may have been removed, or you may not have access. <Link to="/receipts" style={{ color: 'var(--accent)' }}>Back to receipts</Link></Empty>;
  if (!r || !me) return <div className="empty">Loading…</div>;

  // A reviewer must have opened the evidence since the last submission before checking.
  const viewedSince = !!history.data?.items.some((h) => h.action === 'evidence.viewed' && h.actor === me.name && (!r.submittedAt || new Date(h.createdAt) >= new Date(r.submittedAt)));
  const actions = [...r.actions].sort((a, b) => ORDER.indexOf(a.action) - ORDER.indexOf(b.action));
  const needsView = (a: ReceiptAction) => a === 'check' && !viewedSince && r.evidence.length > 0;
  const note = r.status === 'returned' ? { cls: 'warn', icon: 'undo', title: 'Returned for correction', text: r.lastNote }
    : r.status === 'reserved' ? { cls: 'hold', icon: 'pause', title: 'On hold', text: r.lastNote }
    : r.status === 'disapproved' ? { cls: 'bad', icon: 'x', title: 'Disapproved', text: r.lastNote } : null;
  const modalCfg = modal ? COPY[modal] : null;

  return (
    <>
      <Link className="back" to="/receipts"><Icon name="back" size={18} />Back to receipts</Link>
      <div className="dh">
        <div className="ttl">
          <h1>{r.payee}</h1>
          <div className="meta"><StatusPill status={r.status} /><span className="muted">{r.refNo}</span><span className="amt-big">{money(r.amount)}</span></div>
        </div>
        <div className="actionbar">
          {r.canEdit && <Link className="btn" to={`/receipts/${r.id}/edit`}><Icon name="edit" size={18} />Edit</Link>}
          {r.canCopy && <button className="btn" onClick={() => copy.mutate()} disabled={copy.isPending}>Copy to new draft</button>}
          {actions.map((a) => {
            const c = COPY[a.action];
            const click = () => (a.action === 'submit' ? act.mutate({ action: 'submit' }) : setModal(a.action));
            return <button key={a.action} className={`btn ${c.cls}`} disabled={act.isPending || needsView(a.action)} onClick={click}><Icon name={c.icon} size={18} />{a.action === 'submit' && r.status === 'returned' ? 'Resubmit' : c.label}</button>;
          })}
          {actions.some((a) => needsView(a.action)) && <span className="hint-line"><Icon name="eye" size={16} />Open the evidence first. Checking unlocks after you view it.</span>}
        </div>
      </div>

      {note?.text && <div className={`callout ${note.cls}`}><Icon name={note.icon} /><div><b>{note.title}</b><span>{note.text}</span></div></div>}

      <div className="dgrid">
        <div className="stack">
          {r.status === 'approved' && r.document && (
            <section className="card">
              <div className="card-h"><h3>Reimbursement document</h3><StatusPill status="approved" /></div>
              <div className="card-b" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 150 }}><b>{r.document.docNo}</b><br /><small className="muted">One document for this approved transaction</small></div>
                {r.document.status === 'ready' ? (
                  <>
                    <a className="btn sm" href={`/api/documents/${r.document.id}/file?mode=download`}><Icon name="download" size={16} />Download</a>
                    <button className="btn sm" onClick={() => printUrl(`/api/documents/${r.document!.id}/file?mode=print`)}><Icon name="print" size={16} />Print</button>
                  </>
                ) : r.document.status === 'failed' ? <span className="pill s-dis">Could not be created</span> : <span className="muted">Preparing the document…</span>}
              </div>
            </section>
          )}
          <section className="card">
            <div className="card-h"><h3>Details</h3></div>
            <div className="card-b">
              <dl className="dl">
                <dt>Paid to</dt><dd>{r.payee}</dd>
                <dt>Receipt date</dt><dd>{fmtDate(r.receiptDate)}</dd>
                <dt>Amount</dt><dd>{money(r.amount)}</dd>
                <dt>Category</dt><dd>{r.category.name}</dd>
                <dt>Encoded by</dt><dd>{r.encoder.name}</dd>
                <dt>Description</dt><dd>{r.description || '-'}</dd>
                {r.checkedBy && <><dt>Checked by</dt><dd>{r.checkedBy}{r.checkedAt ? ` · ${fmtDateTime(r.checkedAt)}` : ''}</dd></>}
                {r.checkNote && <><dt>Checker remarks</dt><dd>{r.checkNote}</dd></>}
                {r.decidedBy && <><dt>Decided by</dt><dd>{r.decidedBy}{r.decidedAt ? ` · ${fmtDateTime(r.decidedAt)}` : ''}</dd></>}
                {r.decisionNote && <><dt>Approver remarks</dt><dd>{r.decisionNote}</dd></>}
              </dl>
            </div>
          </section>
          <section className="card">
            <div className="card-h"><h3>History</h3><small>Every action is recorded</small></div>
            <div className="card-b">
              <ol className="tl">
                {history.data?.items.slice(0, allHistory ? 200 : 6).map((h) => (
                  <li key={h.id}><span className="dot" /><div><b>{h.actor}</b> {h.summary ?? h.action}<small>{fmtDateTime(h.createdAt)}</small>{h.note && <q>{h.note}</q>}</div></li>
                ))}
              </ol>
              {history.data && !history.data.items.length && <span className="muted">Nothing yet.</span>}
              {history.data && history.data.items.length > 6 && <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => setAllHistory(!allHistory)}>{allHistory ? 'Show fewer' : `Show all ${history.data.items.length}`}</button>}
            </div>
          </section>
        </div>

        <section className="card sticky">
          <div className="card-h"><h3>Evidence</h3><small>{r.evidence.length} file{r.evidence.length === 1 ? '' : 's'}</small></div>
          <EvidenceViewer key={r.id + ':' + r.version} receiptId={r.id} files={r.evidence} gated={!r.isOwner} onOpened={() => setTimeout(() => qc.invalidateQueries({ queryKey: ['history', id] }), 900)} />
        </section>
      </div>

      {modal && modalCfg && <NoteModal receipt={r} action={modal} cfg={modalCfg} required={r.actions.find((a) => a.action === modal)?.note === 'required'} busy={act.isPending} onClose={() => setModal(null)} onSubmit={(note) => act.mutate({ action: modal, note })} />}
    </>
  );
}

function NoteModal({ receipt, action, cfg, required, busy, onClose, onSubmit }: { receipt: ReceiptDetail; action: ReceiptAction; cfg: (typeof COPY)[ReceiptAction]; required: boolean; busy: boolean; onClose: () => void; onSubmit: (note: string) => void }) {
  const [text, setText] = useState('');
  const ok = !required || text.trim().length >= 4;
  return (
    <Modal title={cfg.title} onClose={onClose}>
      <div className="callout" style={{ margin: '0 0 14px', display: 'block' }}>
        <b>{receipt.payee}</b>
        <span style={{ display: 'block' }}>{receipt.refNo} · {money(receipt.amount)}</span>
        {(action === 'approve' || action === 'disapprove' || action === 'reserve' || action === 'release') && (
          <span style={{ display: 'block', color: 'var(--muted)' }}>
            {receipt.checkedBy ? `Checked by ${receipt.checkedBy}${receipt.checkedAt ? ` on ${fmtDateTime(receipt.checkedAt)}` : ''}` : 'Not checked yet'}
          </span>
        )}
      </div>
      <p>{cfg.desc}</p>
      <label className="f">
        <span>{cfg.field}{!required && <span className="hint"> Optional</span>}</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={required ? 'Required' : 'Add a remark'} autoFocus maxLength={1000} />
      </label>
      <div className="btns">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className={`btn ${cfg.cls || 'pri'}`} disabled={!ok || busy} onClick={() => onSubmit(text.trim())}>{action === 'return' ? 'Return record' : cfg.label}</button>
      </div>
    </Modal>
  );
}
