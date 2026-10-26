import PDFDocument from 'pdfkit';
import { classificationText } from '@reimsys/shared';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { registerJob } from './jobs.js';
import { drawLogo } from './logo.js';
import { saveFile } from './storage.js';
import { typeLabel } from './receipts.js';

const php = (n: number | string) => 'PHP ' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d: Date | null) => (d ? d.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }) : '-');

function toBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

/**
 * Reimbursement document for one approved receipt.
 * Carries the answers from the client's reimbursement form (invoice, VAT and withholding) so the paper copy matches the screen.
 */
export async function buildReimbursementPdf(receiptId: number) {
  const r = await prisma.receipt.findUniqueOrThrow({
    where: { id: receiptId },
    include: { category: true, chargeLocation: true, encoder: true, document: true, evidence: { where: { deletedAt: null } } },
  });
  const people = await prisma.user.findMany({ where: { id: { in: [r.checkedById, r.decidedById].filter((x): x is number => !!x) } } });
  const nameOf = (id: number | null) => people.find((p) => p.id === id)?.name ?? '-';

  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Reimbursement ${r.document?.docNo ?? ''}`, Author: config.orgName } });
  const L = 50, W = doc.page.width - 100;

  drawLogo(doc, L, 46, 46);
  const TX = L + 60;
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#0c7480').text(config.orgName.toUpperCase(), TX, 48);
  doc.font('Helvetica-Bold').fontSize(20).fillColor('#12232b').text('Reimbursement Document', TX, 62);
  doc.font('Helvetica').fontSize(10).fillColor('#546770').text(`Document no. ${r.document?.docNo ?? '-'}`, TX, 88);
  doc.moveTo(L, 118).lineTo(L + W, 118).strokeColor('#d6dfe2').stroke();

  let y = 136;
  const row = (label: string, value: string) => {
    doc.font('Helvetica').fontSize(8.5).fillColor('#546770').text(label.toUpperCase(), L, y + 1, { width: 150 });
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#12232b').text(value, L + 160, y - 1, { width: W - 160 });
    y += Math.max(19, doc.heightOfString(value, { width: W - 160 }) + 8);
  };
  const money = (n: unknown) => (n === null || n === undefined ? '-' : php(Number(n)));
  row('Receipt reference', r.refNo);
  row('Vendor', r.payee);
  if (r.vendorAddress) row('Vendor address', r.vendorAddress);
  if (r.vendorTin) row('Vendor TIN', r.vendorTin);
  row('Invoice no.', r.invoiceNo || '-');
  row('Invoice date', fmtDate(r.receiptDate));
  if (r.transactionType) row('Type', typeLabel(r));
  row('BIR-registered invoice', r.birInvoice === null ? '-' : r.birInvoice ? 'Yes' : 'No');
  if (r.birInvoice && r.invoiceUnderCompany !== null) row('Invoice under the company', r.invoiceUnderCompany ? 'Yes' : 'No');
  if (r.classification) row('Classification', classificationText(r.classification, r.classificationOther));
  if (r.reasonForSpending) row('Reason for spending', r.reasonForSpending);
  if (r.birInvoice) {
    row('VAT', r.vatType === 'vatable' ? 'Vatable' : r.vatType === 'non_vatable' ? 'Non-vatable' : '-');
    row('Vatable amount', money(r.vatableAmount));
    row('VAT amount', money(r.vatAmount));
    row('VAT-exempt amount', money(r.vatExemptAmount));
    row('Discount', money(r.discountAmount));
    row('Tax withheld', r.withheld ? `${Number(r.whtRate ?? 0)}%  ·  ${money(r.whtAmount)}` : r.withheld === false ? 'None' : '-');
  }
  if (r.chargeLocation) row('Charged to', r.chargeLocation.name);
  if (r.newReimbursementCode !== null) row('Reimbursement code', r.newReimbursementCode ? 'New code' : r.reimbursementCode || '-');
  row('Description', r.description || '-');
  row('Evidence files', String(r.evidence.length));
  doc.moveTo(L, y).lineTo(L + W, y).strokeColor('#d6dfe2').stroke();
  y += 14;
  doc.font('Helvetica').fontSize(9).fillColor('#546770').text('INVOICE GROSS AMOUNT APPROVED FOR REIMBURSEMENT', L, y);
  doc.font('Helvetica-Bold').fontSize(22).fillColor('#12232b').text(php(Number(r.amount)), L, y + 13);
  y += 52;

  doc.font('Helvetica-Bold').fontSize(11).fillColor('#12232b').text('Workflow', L, y);
  y += 20;
  row('Encoded by', `${r.encoder.name}  ·  ${fmtDate(r.createdAt)}`);
  row('Checked by', `${nameOf(r.checkedById)}  ·  ${fmtDate(r.checkedAt)}`);
  if (r.checkNote) row('Checker remarks', r.checkNote);
  row('Approved by', `${nameOf(r.decidedById)}  ·  ${fmtDate(r.decidedAt)}`);
  if (r.decisionNote) row('Approver remarks', r.decisionNote);

  const sy = Math.max(y + 40, 640);
  const cols = [['Prepared by', r.encoder.name], ['Checked by', nameOf(r.checkedById)], ['Approved by', nameOf(r.decidedById)]];
  const cw = W / 3;
  cols.forEach(([label, name], i) => {
    const x = L + i * cw;
    doc.moveTo(x + 6, sy).lineTo(x + cw - 20, sy).strokeColor('#12232b').stroke();
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#12232b').text(name!, x + 6, sy + 6, { width: cw - 26 });
    doc.font('Helvetica').fontSize(8).fillColor('#546770').text(label!, x + 6, sy + 22);
  });
  doc.page.margins.bottom = 0;
  doc.font('Helvetica').fontSize(8).fillColor('#8a9aa1').text(`Generated ${new Date().toLocaleString('en-PH')} by ${config.orgName}`, L, 790, { width: W, align: 'center', lineBreak: false });
  return toBuffer(doc);
}

registerJob('document', async ({ receiptId }: { receiptId: number }) => {
  const d = await prisma.reimbursementDocument.findUnique({ where: { receiptId } });
  if (!d) return; // the approval was taken back before the document was made
  try {
    const pdf = await buildReimbursementPdf(receiptId);
    const filePath = await saveFile('documents', 'pdf', pdf);
    await prisma.reimbursementDocument.update({ where: { id: d.id }, data: { status: 'ready', filePath, generatedAt: new Date(), error: null } });
  } catch (err) {
    await prisma.reimbursementDocument.update({ where: { id: d.id }, data: { status: 'failed', error: (err instanceof Error ? err.message : String(err)).slice(0, 300) } });
    throw err;
  }
});
