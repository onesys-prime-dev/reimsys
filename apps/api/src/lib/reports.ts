import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { Prisma } from '@prisma/client';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { PAYMENT_FILTER_LABEL, TRANSACTION_LABEL, VAT_LABEL, type PaymentFilter } from '@reimsys/shared';
import { dateOnly, typeLabel } from './receipts.js';
import { registerJob } from './jobs.js';
import { drawLogo } from './logo.js';
import { readFile, saveFile } from './storage.js';

export interface ReportFilters { from: string; to: string; categoryId?: number | null; transactionType?: string | null; encoderId?: number | null; payment?: PaymentFilter; scope: Prisma.ReceiptWhereInput }

/** Human description of the optional filters, e.g. "Person: Ana Reyes · Category: Medicine". Empty when nothing is filtered. */
export async function filterLabel(f: { categoryId?: number | null; transactionType?: string | null; encoderId?: number | null; payment?: PaymentFilter }) {
  const parts: string[] = [];
  if (f.encoderId) { const u = await prisma.user.findUnique({ where: { id: f.encoderId }, select: { name: true } }); if (u) parts.push(`Person: ${u.name}`); }
  if (f.transactionType) parts.push(`Type: ${TRANSACTION_LABEL[f.transactionType as keyof typeof TRANSACTION_LABEL] ?? f.transactionType}`);
  if (f.categoryId) { const c = await prisma.category.findUnique({ where: { id: f.categoryId }, select: { name: true } }); if (c) parts.push(`Category: ${c.name}`); }
  if (f.payment && f.payment !== 'all') parts.push(`Payment: ${PAYMENT_FILTER_LABEL[f.payment]}`);
  return parts.join(' · ');
}

/** Approved records only. This is enforced in the query, never in the UI. */
export async function reportRows(f: ReportFilters) {
  const where: Prisma.ReceiptWhereInput = {
    AND: [
      f.scope,
      // Paid receipts were approved first, so "all" means both. Old saved reports have no payment filter and mean "all".
      { status: { in: f.payment === 'paid' ? ['paid'] : f.payment === 'unpaid' ? ['approved'] : ['approved', 'paid'] } },
      { receiptDate: { gte: new Date(f.from + 'T00:00:00Z'), lte: new Date(f.to + 'T00:00:00Z') } },
      f.categoryId ? { categoryId: f.categoryId } : {},
      f.transactionType ? { transactionType: f.transactionType } : {},
      f.encoderId ? { encoderId: f.encoderId } : {},
    ],
  };
  const rows = await prisma.receipt.findMany({ where, include: { category: true, encoder: true, document: true, payment: true }, orderBy: [{ receiptDate: 'asc' }, { id: 'asc' }] });
  const data = rows.map((r) => ({
    docNo: r.document?.docNo ?? '', refNo: r.refNo, date: dateOnly(r.receiptDate), invoiceNo: r.invoiceNo ?? '', payee: r.payee, vendorTin: r.vendorTin ?? '', category: typeLabel(r),
    vatType: r.vatType ? VAT_LABEL[r.vatType as keyof typeof VAT_LABEL] ?? r.vatType : '',
    vatable: r.vatableAmount === null ? 0 : Number(r.vatableAmount), vat: r.vatAmount === null ? 0 : Number(r.vatAmount), wht: r.whtAmount === null ? 0 : Number(r.whtAmount),
    encoder: r.encoder.name, approvedAt: r.decidedAt ? dateOnly(r.decidedAt) : '', amount: Number(r.amount),
    paid: r.status === 'paid', paidAmount: r.paidAmount === null ? 0 : Number(r.paidAmount), paidOn: r.payment ? dateOnly(r.payment.paidOn) : '',
    method: r.payment?.method ?? '', paymentNo: r.payment?.paymentNo ?? '', shortReason: r.paidShortReason ?? '',
  }));
  const sum = (list: typeof data, k: 'amount' | 'vatable' | 'vat' | 'wht' | 'paidAmount') => Math.round(list.reduce((s, r) => s + r[k] * 100, 0)) / 100;
  return {
    rows: data, total: sum(data, 'amount'),
    totals: { gross: sum(data, 'amount'), vatable: sum(data, 'vatable'), vat: sum(data, 'vat'), wht: sum(data, 'wht'), paid: sum(data, 'paidAmount'), unpaid: sum(data.filter((r) => !r.paid), 'amount') },
  };
}
type Row = Awaited<ReturnType<typeof reportRows>>['rows'][number];

const php = (n: number) => 'PHP ' + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
type Totals = { gross: number; vatable: number; vat: number; wht: number; paid: number; unpaid: number };
const HEAD = ['Document no.', 'Receipt ref.', 'Invoice date', 'Invoice no.', 'Vendor', 'Vendor TIN', 'Type', 'VAT type', 'Vatable amount', 'VAT amount', 'Withholding amount', 'Encoded by', 'Approved', 'Gross amount (PHP)', 'Payment', 'Paid on', 'Method', 'Payment no.', 'Amount paid (PHP)'];
const cells = (r: Row) => [r.docNo, r.refNo, r.date, r.invoiceNo, r.payee, r.vendorTin, r.category, r.vatType, r.vatable, r.vat, r.wht, r.encoder, r.approvedAt, r.amount, r.paid ? 'Paid' : 'Not yet paid', r.paidOn, r.method, r.paymentNo, r.paid ? r.paidAmount : ''];

/**
 * A spreadsheet program treats a cell that starts with = + - @ (or a tab or line break) as a formula, so someone could save
 * a receipt called =HYPERLINK(...) and have it run on whoever opens the export. A leading apostrophe makes it plain text.
 * Numbers are left alone so totals still add up.
 */
export function neutraliseFormula(v: string | number | null | undefined): string | number {
  if (typeof v === 'number') return v;
  const s = String(v ?? '');
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

export function toCsv(rows: (string | number)[][]) {
  const q = (v: string | number) => {
    const s = String(neutraliseFormula(v));
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
}

export async function buildCsv(rows: Row[], t: Totals) {
  return Buffer.from(toCsv([HEAD, ...rows.map(cells), ['', '', '', '', '', '', '', 'Total', t.vatable, t.vat, t.wht, '', '', t.gross, '', '', '', '', t.paid]]));
}

export async function buildXlsx(rows: Row[], f: { from: string; to: string; label?: string }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = config.orgName;
  const ws = wb.addWorksheet('Liquidation');
  ws.addRow([`${config.orgName} - Liquidation report`]).font = { bold: true, size: 14 };
  ws.addRow([`Approved and paid records from ${f.from} to ${f.to}${f.label ? ' · ' + f.label : ''}`]).font = { color: { argb: 'FF546770' } };
  ws.addRow([]);
  const head = ws.addRow(HEAD);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0C7480' } }; });
  rows.forEach((r) => ws.addRow(cells(r)));
  const first = 5, last = 4 + rows.length;
  const sumOf = (col: string) => (rows.length ? { formula: `SUM(${col}${first}:${col}${last})` } : 0);
  const tot = ws.addRow(['', '', '', '', '', '', '', 'Total', sumOf('I'), sumOf('J'), sumOf('K'), '', '', sumOf('N'), '', '', '', '', sumOf('S')]);
  tot.font = { bold: true };
  for (const c of [9, 10, 11, 14, 19]) ws.getColumn(c).numFmt = '#,##0.00';
  [16, 16, 13, 16, 28, 18, 12, 13, 15, 13, 17, 22, 12, 18, 13, 12, 15, 18, 16].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.views = [{ state: 'frozen', ySplit: 4 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function buildPdf(rows: Row[], t: Totals, f: { from: string; to: string; label?: string }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const L = 40, W = doc.page.width - 80;
    const cols = [{ h: 'Document no.', w: 84 }, { h: 'Invoice no.', w: 90 }, { h: 'Date', w: 56 }, { h: 'Vendor', w: 112 }, { h: 'Type', w: 48 }, { h: 'Encoded by', w: 78 }, { h: 'VAT', w: 62 }, { h: 'Withheld', w: 62 }, { h: 'Paid', w: 74 }, { h: 'Amount', w: 0 }];
    cols[9]!.w = W - cols.slice(0, 9).reduce((s, c) => s + c.w, 0);
    const header = () => {
      drawLogo(doc, L, 32, 38);
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#0c7480').text(config.orgName.toUpperCase(), L + 48, 34);
      doc.font('Helvetica-Bold').fontSize(16).fillColor('#12232b').text('Liquidation Report', L + 48, 48);
      doc.font('Helvetica').fontSize(9).fillColor('#546770').text(`Approved and paid records · ${f.from} to ${f.to}${f.label ? ' · ' + f.label : ''} · ${rows.length} record${rows.length === 1 ? '' : 's'}`, L + 48, 70);
      let x = L;
      const y = 94;
      doc.rect(L, y, W, 20).fill('#0c7480');
      cols.forEach((c) => {
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff').text(c.h.toUpperCase(), x + 4, y + 6, { width: c.w - 8, align: ['Amount', 'VAT', 'Withheld', 'Paid'].includes(c.h) ? 'right' : 'left' });
        x += c.w;
      });
      return y + 24;
    };
    let y = header();
    rows.forEach((r, i) => {
      if (y > doc.page.height - 70) { doc.addPage(); y = header(); }
      if (i % 2) doc.rect(L, y - 3, W, 18).fill('#f1f6f6');
      const vals = [r.docNo, r.invoiceNo || r.refNo, r.date, r.payee, r.category, r.encoder, php(r.vat), php(r.wht), r.paid ? php(r.paidAmount) : 'Not yet', php(r.amount)];
      let x = L;
      cols.forEach((c, j) => {
        doc.font('Helvetica').fontSize(8.5).fillColor('#12232b').text(vals[j]!, x + 4, y, { width: c.w - 8, height: 12, ellipsis: true, align: j >= 6 ? 'right' : 'left' });
        x += c.w;
      });
      y += 18;
    });
    if (y > doc.page.height - 90) { doc.addPage(); y = header(); }
    doc.moveTo(L, y + 2).lineTo(L + W, y + 2).strokeColor('#12232b').stroke();
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#12232b').text(`Total   VAT ${php(t.vat)}   ·   Withheld ${php(t.wht)}   ·   Gross ${php(t.gross)}`, L, y + 10, { width: W, align: 'right' });
    doc.font('Helvetica').fontSize(10).fillColor('#12232b').text(`Paid ${php(t.paid)}   ·   Not yet paid ${php(t.unpaid)}`, L, y + 28, { width: W, align: 'right' });
    const n = doc.bufferedPageRange().count;
    for (let i = 0; i < n; i++) {
      doc.switchToPage(i);
      doc.page.margins.bottom = 0; // otherwise the footer is treated as overflow and spills onto a blank extra page
      doc.font('Helvetica').fontSize(8).fillColor('#8a9aa1').text(`Generated ${new Date().toLocaleString('en-PH')}  ·  Page ${i + 1} of ${n}`, L, doc.page.height - 30, { width: W, align: 'center', lineBreak: false });
    }
    doc.end();
  });
}

registerJob('report', async ({ reportId }: { reportId: number }) => {
  const rep = await prisma.liquidationReport.findUnique({ where: { id: reportId } });
  if (!rep) return;
  try {
    const f = JSON.parse(rep.filters) as ReportFilters;
    const label = await filterLabel(f);
    const { rows, total, totals } = await reportRows(f);
    const buf = rep.format === 'pdf' ? await buildPdf(rows, totals, { ...f, label }) : rep.format === 'xlsx' ? await buildXlsx(rows, { ...f, label }) : await buildCsv(rows, totals);
    const filePath = await saveFile('reports', rep.format, buf);
    // Receipts move from approved to paid all the time, so the screen view reads the same rows the file was made from.
    const snapshot = await saveFile('reports', 'json', Buffer.from(JSON.stringify({ rows, total, totals })));
    await prisma.liquidationReport.update({ where: { id: rep.id }, data: { status: 'ready', filePath, rowCount: rows.length, total, finishedAt: new Date(), error: null, filters: JSON.stringify({ ...JSON.parse(rep.filters), snapshot }) } });
  } catch (err) {
    await prisma.liquidationReport.update({ where: { id: rep.id }, data: { status: 'failed', error: (err instanceof Error ? err.message : String(err)).slice(0, 300), finishedAt: new Date() } });
    throw err;
  }
});

/** The rows a ready report was generated with. Reports made before snapshots existed are worked out again. */
export async function savedReportRows(f: ReportFilters & { snapshot?: string }) {
  if (f.snapshot) {
    try { return JSON.parse((await readFile(f.snapshot)).toString('utf8')) as Awaited<ReturnType<typeof reportRows>>; } catch { /* fall back below */ }
  }
  return reportRows(f);
}
