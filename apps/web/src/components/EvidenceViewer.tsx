import { useState } from 'react';
import { printUrl } from '../api';
import { useAuth } from '../auth';
import { Icon } from '../ui';
import type { EvidenceFile } from '../types';

const fileUrl = (receiptId: number, id: number, mode: 'view' | 'download' | 'print') => `/api/receipts/${receiptId}/evidence/${id}/file?mode=${mode}`;
const kb = (n: number) => (n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * Shows evidence for a receipt. People who are not the owner must open it on purpose,
 * and that click is what the server records as a view.
 */
export function EvidenceViewer({ receiptId, files, gated, onOpened }: { receiptId: number; files: EvidenceFile[]; gated: boolean; onOpened?: () => void }) {
  const { can } = useAuth();
  const [idx, setIdx] = useState(0);
  const [opened, setOpened] = useState(!gated);
  const [zoom, setZoom] = useState(1);
  const [nonce, setNonce] = useState(0);
  const file = files[idx] ?? files[0];

  if (!files.length) {
    return <div className="locked"><Icon name="upload" /><b>No evidence yet</b><span className="muted">Add a photo or PDF before submitting.</span></div>;
  }
  const open = () => { setOpened(true); setNonce((n) => n + 1); onOpened?.(); };
  const tabs = (
    <div className="evtabs">
      {files.map((f, i) => (
        <button key={f.id} className={`evtab ${i === idx ? 'on' : ''}`} onClick={() => { setIdx(i); setZoom(1); if (opened) { setNonce((n) => n + 1); onOpened?.(); } }}>
          <Icon name={f.mime === 'application/pdf' ? 'file' : 'camera'} size={16} /><span>{f.fileName}</span>
        </button>
      ))}
    </div>
  );

  if (!opened) {
    return (
      <>
        {tabs}
        <div className="locked">
          <Icon name="lock" />
          <b>Evidence is protected</b>
          <span className="muted">Opening it is recorded in the audit log with your name and the time.</span>
          <div style={{ marginTop: 14 }}><button className="btn pri" onClick={open}><Icon name="eye" size={18} />Open evidence</button></div>
        </div>
      </>
    );
  }

  const url = `${fileUrl(receiptId, file!.id, 'view')}&n=${nonce}`;
  const isPdf = file!.mime === 'application/pdf';
  const isHeic = file!.mime === 'image/heic';
  return (
    <>
      {tabs}
      <div className="stage" style={isPdf ? { padding: 0, display: 'block', height: 440 } : undefined}>
        {isPdf ? <iframe className="evframe" style={{ height: 440, borderRadius: 10 }} src={url} title={file!.fileName} />
          : isHeic ? <div className="muted" style={{ textAlign: 'center' }}>This photo format cannot be shown in the browser.<br />Download it to view.</div>
          : <img className="evimg" style={zoom === 1 ? undefined : { width: `${zoom * 100}%`, maxWidth: zoom > 1 ? 'none' : '100%', maxHeight: zoom > 1 ? 'none' : undefined }} src={url} alt={`Evidence: ${file!.fileName}`} />}
      </div>
      <div className="evtool">
        {!isPdf && !isHeic && (
          <>
            <button className="btn sm" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}><Icon name="search" size={16} />−</button>
            <button className="btn sm" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(2.5, z + 0.25))}><Icon name="search" size={16} />+</button>
          </>
        )}
        <small className="muted">{kb(file!.size)}</small>
        <span className="sp" />
        {can('evidence.download') && <a className="btn sm" href={fileUrl(receiptId, file!.id, 'download')}><Icon name="download" size={16} />Download</a>}
        {can('evidence.print') && !isHeic && <button className="btn sm" onClick={() => printUrl(fileUrl(receiptId, file!.id, 'print'))}><Icon name="print" size={16} />Print</button>}
      </div>
    </>
  );
}
