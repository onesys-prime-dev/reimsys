import { useEffect, useRef, useState } from 'react';
import { Icon, Modal } from '../ui';

type Tab = 'overview' | 'total' | 'vatable' | 'vat' | 'exempt' | 'discount' | 'withholding';
type GuideStep = 'invoice' | 'vat' | 'wht';

/** `at` is how far down the picture (0 to 1) the marked place is, so the view opens on it instead of on the top of the page. */
const TABS: Record<Tab, { label: string; image: string; text: string; at: number }> = {
  overview: { label: 'The invoice', image: 'overview', at: 0.3, text: 'It must say "Invoice". The details may be computerized or printed by a machine. Handwriting is allowed only inside the invoice itself. The BIR Authority to Print line at the bottom must be readable.' },
  total: { label: 'Gross amount', image: 'total', at: 0.61, text: 'Total Sales (VAT Inclusive) is the invoice gross amount, without any deduction.' },
  vatable: { label: 'Vatable amount', image: 'vatable', at: 0.63, text: 'The vatable amount is shown as VATable Sales, or as Amount: Net of VAT.' },
  vat: { label: 'VAT amount', image: 'vat', at: 0.66, text: 'The VAT amount is shown on the VAT line, or on Less: VAT and Add: VAT. Enter 0 if the invoice has no VAT.' },
  exempt: { label: 'VAT-exempt', image: 'exempt', at: 0.7, text: 'VAT-Exempt Sales is a different line from VATable Sales. Do not add it to the vatable amount.' },
  discount: { label: 'Discount', image: 'discount', at: 0.69, text: 'Less: Discount (SC/PWD/NAAC/MOV/SP) is a deduction. The gross amount is entered without any deduction.' },
  withholding: { label: 'Withholding tax', image: 'withholding', at: 0.75, text: 'If an amount is written on Less: Withholding Tax, answer Yes to "Withheld tax?".' },
};

/** What matters on each page of the form comes first, in this order; the rest follow so nothing is hidden. */
const RELEVANT: Record<GuideStep, Tab[]> = {
  invoice: ['overview', 'total'],
  vat: ['vatable', 'vat', 'exempt', 'discount'],
  wht: ['withholding'],
};
const ALL: Tab[] = ['overview', 'total', 'vatable', 'vat', 'exempt', 'discount', 'withholding'];
const ZOOMS = [1, 1.5, 2, 3];

/** A button that opens the sample invoice with each place to look marked. It opens on the part that matches the page, and the picture can be zoomed. */
export function InvoiceGuide({ step }: { step: GuideStep }) {
  const [open, setOpen] = useState(false);
  const order = [...RELEVANT[step], ...ALL.filter((t) => !RELEVANT[step].includes(t))];
  const [tab, setTab] = useState<Tab>(order[0]!);
  const [zi, setZi] = useState(0);
  const view = useRef<HTMLDivElement>(null);
  const zoom = ZOOMS[zi]!;
  const img = useRef<HTMLImageElement>(null);
  /** Scrolls so the marked place is in the middle of the view. */
  const showMark = (t: Tab = tab) => {
    const v = view.current, i = img.current;
    if (!v || !i) return;
    v.scrollTo({ top: Math.max(0, TABS[t].at * i.clientHeight - v.clientHeight / 2), left: Math.max(0, (i.clientWidth - v.clientWidth) * 0.45) });
  };
  /** On a narrow screen the picture starts zoomed in, so the print is readable without pressing anything. */
  const home = () => (window.innerWidth < 600 ? 2 : 0);
  const go = (t: Tab) => { setTab(t); setZi(home()); };
  const by = (d: number) => setZi((i) => Math.max(0, Math.min(ZOOMS.length - 1, i + d)));
  // after every tab change or zoom, once the picture has its new size, go back to the marked place
  useEffect(() => { if (open) requestAnimationFrame(() => showMark()); }, [open, tab, zi]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === '+' || e.key === '=') by(1); if (e.key === '-') by(-1); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [open]);

  const cur = TABS[tab];
  return (
    <>
      <button type="button" className="btn sm" onClick={() => { setTab(order[0]!); setZi(home()); setOpen(true); }}><Icon name="info" size={16} />How to read the invoice</button>
      {open && (
        <Modal title="How to read the invoice" onClose={() => setOpen(false)} className="guide-modal">
          <div className="issues" role="tablist" aria-label="Part of the invoice">
            {order.map((t) => (
              <button key={t} type="button" role="tab" aria-selected={t === tab} className={'issue' + (t === tab ? ' on' : '') + (RELEVANT[step].includes(t) ? '' : ' other')} onClick={() => go(t)}>{TABS[t].label}</button>
            ))}
          </div>
          <div className="guide-bar">
            <span className="muted">Zoom</span>
            <button type="button" className="btn sm" aria-label="Zoom out" disabled={zi === 0} onClick={() => by(-1)}>−</button>
            <b aria-live="polite">{Math.round(zoom * 100)}%</b>
            <button type="button" className="btn sm" aria-label="Zoom in" disabled={zi === ZOOMS.length - 1} onClick={() => by(1)}>+</button>
            <button type="button" className="btn sm" disabled={zi === home()} onClick={() => setZi(home())}>Reset</button>
          </div>
          <div className="guide-view" ref={view} data-zoom={zoom}>
            <img ref={img} className="guide-img" src={`/guide/${cur.image}.png`} alt={`Sample invoice: ${cur.label}`} style={{ width: `${zoom * 100}%` }} onLoad={() => showMark()}
              onClick={() => setZi((i) => (i >= ZOOMS.length - 1 ? 0 : i + 1))} />
          </div>
          <p className="guide-text"><b>{cur.label}.</b> {cur.text}</p>
          <div className="btns"><button className="btn pri" type="button" onClick={() => setOpen(false)}>Close</button></div>
        </Modal>
      )}
    </>
  );
}
