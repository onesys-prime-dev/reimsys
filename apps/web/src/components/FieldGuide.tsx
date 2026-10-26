import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../ui';
import { ZoomPan } from './ZoomPan';

/** Each question or field that has a sample picture of its own. */
export type GuideField = 'invoiceDate' | 'invoiceNo' | 'vendorName' | 'vendorAddress' | 'vendorTin' | 'grossAmount' | 'vatableAmount' | 'vatAmount' | 'taxWithheld' | 'whtRate' | 'whtAmount';

/** The sample invoice with the place to look marked, and the name of the field for the screen reader. */
const GUIDES: Record<GuideField, { image: string; label: string }> = {
  invoiceDate: { image: 'overview', label: 'invoice date' },
  invoiceNo: { image: 'overview', label: 'invoice number' },
  vendorName: { image: 'overview', label: 'vendor name' },
  vendorAddress: { image: 'overview', label: 'vendor address' },
  vendorTin: { image: 'overview', label: 'vendor TIN' },
  grossAmount: { image: 'total', label: 'gross amount' },
  vatableAmount: { image: 'vatable', label: 'vatable amount' },
  vatAmount: { image: 'vat', label: 'VAT amount' },
  taxWithheld: { image: 'withholding', label: 'tax withheld' },
  whtRate: { image: 'withholding', label: 'withholding tax rate' },
  whtAmount: { image: 'withholding', label: 'withholding tax amount' },
};

/** A small button beside a question that opens that question's picture over the whole screen: the picture and a Close button, nothing else. */
export function FieldGuide({ field }: { field: GuideField }) {
  const [open, setOpen] = useState(false);
  const g = GUIDES[field];
  const src = `/guide/${g.image}.png`;
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const opener = useRef<HTMLButtonElement>(null);
  const closer = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); opener.current?.focus(); };

  useEffect(() => {
    if (!open) return;
    closer.current?.focus();
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', h);
    // The page behind must not scroll under the picture.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', h); document.body.style.overflow = prev; };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <button ref={opener} type="button" className="fg-open" aria-label={`Where to find the ${g.label} on the invoice`} title={`Where to find the ${g.label}`}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setLoaded(false); setFailed(false); setOpen(true); }}>
        <Icon name="info" size={16} />
      </button>
      {open && createPortal(
        <div className="fg-full" role="dialog" aria-modal="true" aria-label={`Where to find the ${g.label} on the invoice`}>
          <button ref={closer} type="button" className="btn fg-close" onClick={close}><Icon name="x" size={18} />Close</button>
          <div className="fg-stage">
            {!failed && (
              <ZoomPan label={`Sample invoice: ${g.label}`} className="fg-zp">
                <img key={`${src}#${retry}`} src={`${src}${retry ? `?try=${retry}` : ''}`} alt={`Sample invoice, with the ${g.label} marked`} draggable={false} onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
              </ZoomPan>
            )}
            {!loaded && !failed && <div className="fg-msg" role="status"><span className="spin" aria-hidden="true" /><span>Loading the picture…</span></div>}
            {failed && <div className="fg-msg" role="alert"><span>The picture could not be loaded. Check your connection.</span><button type="button" className="btn sm" onClick={() => { setFailed(false); setLoaded(false); setRetry((n) => n + 1); }}>Try again</button></div>}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
