import { useState } from 'react';
import { Icon, Modal } from '../ui';

type Tab = 'overview' | 'total' | 'vatable' | 'vat' | 'exempt' | 'discount' | 'withholding';

const TABS: { id: Tab; label: string; image: string; text: string }[] = [
  { id: 'overview', label: 'The invoice', image: 'overview', text: 'It must say "Invoice". The details may be computerized or printed by a machine. Handwriting is allowed only inside the invoice itself. The BIR Authority to Print line at the bottom must be readable.' },
  { id: 'total', label: 'Gross amount', image: 'total', text: 'Total Sales (VAT Inclusive) is the invoice gross amount, without any deduction.' },
  { id: 'vatable', label: 'Vatable amount', image: 'vatable', text: 'The vatable amount is shown as VATable Sales, or as Amount: Net of VAT.' },
  { id: 'vat', label: 'VAT amount', image: 'vat', text: 'The VAT amount is shown on the VAT line, or on Less: VAT and Add: VAT. Enter 0 if the invoice has no VAT.' },
  { id: 'exempt', label: 'VAT-exempt', image: 'exempt', text: 'VAT-Exempt Sales is a different line from VATable Sales. Do not add it to the vatable amount.' },
  { id: 'discount', label: 'Discount', image: 'discount', text: 'Less: Discount (SC/PWD/NAAC/MOV/SP) is a deduction. The gross amount is entered without any deduction.' },
  { id: 'withholding', label: 'Withholding tax', image: 'withholding', text: 'If an amount is written on Less: Withholding Tax, answer Yes to "Withheld tax?".' },
];

/** A button that opens the sample invoice with each place to look marked, opening on the part that matches the current step. */
export function InvoiceGuide({ start = 'overview' }: { start?: Tab }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>(start);
  const cur = TABS.find((t) => t.id === tab)!;
  return (
    <>
      <button type="button" className="btn sm" onClick={() => { setTab(start); setOpen(true); }}><Icon name="info" size={16} />How to read the invoice</button>
      {open && (
        <Modal title="How to read the invoice" onClose={() => setOpen(false)} className="guide-modal">
          <div className="issues" role="tablist" aria-label="Part of the invoice">
            {TABS.map((t) => <button key={t.id} type="button" role="tab" aria-selected={t.id === tab} className={'issue' + (t.id === tab ? ' on' : '')} onClick={() => setTab(t.id)}>{t.label}</button>)}
          </div>
          <p style={{ margin: '12px 0' }}>{cur.text}</p>
          <img className="guide-img" src={`/guide/${cur.image}.jpg`} alt={`Sample invoice: ${cur.label}`} />
          <div className="btns"><button className="btn pri" type="button" onClick={() => setOpen(false)}>Close</button></div>
        </Modal>
      )}
    </>
  );
}
