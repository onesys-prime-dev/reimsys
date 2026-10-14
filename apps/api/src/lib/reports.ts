import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { Prisma } from '@prisma/client';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { dateOnly } from './receipts.js';
import { registerJob } from './jobs.js';
import { drawLogo } from './logo.js';
import { saveFile } from './storage.js';

export interface ReportFilters { from: string; to: string; categoryId?: number | null; encoderId?: number | null; scope: Prisma.ReceiptWhereInput }

/** Human description of the optional filters, e.g. "Person: Ana Reyes · Category: Medicine". Empty when nothing is filtered. */
export async function filterLabel(f: { categoryId?: number | null; encoderId?: number | null }) {
  const parts: string[] = [];
  if (f.encoderId) { const u = await prisma.user.findUnique({ where: { id: f.encoderId }, select: { name: true } }); if (u) parts.push(`Person: ${u.name}`); }
  if (f.categoryId) { const c = await prisma.category.findUnique({ where: { id: f.categoryId }, select: { name: true } }); if (c) parts.push(`Category: ${c.name}`); }
  return parts.join(' · ');
}

/** Approved records only. This is enforced in the query, never in the UI. */
export async function reportRows(f: ReportFilters) {
  const where: Prisma.ReceiptWhereInput = {
    AND: [
      f.scope,
      { status: 'approved' },
      { receiptDate: { gte: new Date(f.from + 'T00:00:00Z'), lte: new Date(f.to + 'T00:00:00Z') } },
      f.categoryId ? { categoryId: f.categoryId } : {},
      f.encoderId ? { encoderId: f.encoderId } : {},
    ],
  };
  const rows = await prisma.receipt.findMany({ where, include: { category: true, encoder: true, document: true }, orderBy: [{ receiptDate: 'asc' }, { id: 'asc' }] });
  const data = rows.map((r) => ({
    docNo: r.document?.docNo ?? '', refNo: r.refNo, date: dateOnly(r.receiptDate), payee: r.payee, category: r.category.name,
    encoder: r.encoder.name, approvedAt: r.decidedAt ? dateOnly(r.decidedAt) : '', amount: Number(r.amount),
  }));
  const total = Math.round(data.reduce((s, r) => s + r.amount * 100, 0)) / 100;
  return { rows: data, total };
}
type Row = Awaited<ReturnType<typeof reportRows>>['rows'][number];

const php = (n: number) => 'PHP ' + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const HEAD = ['Document no.', 'Receipt ref.', 'Receipt date', 'Paid to', 'Category', 'Encoded by', 'Approved', 'Amount (PHP)'];
const cells = (r: Row) => [r.docNo, r.refNo, r.date, r.payee, r.category, r.encoder, r.approvedAt, r.amount];

export function toCsv(rows: (string | number)[][]) {
  const q = (v: string | number) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
}

export async function buildCsv(rows: Row[], total: number) {
  return Buffer.from(toCsv([HEAD, ...rows.map(cells), ['', '', '', '', '', '', 'Total', total]]));
}

export async function buildXlsx(rows: Row[], f: { from: string; to: string; label?: string }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = config.orgName;
  const ws = wb.addWorksheet('Liquidation');
  ws.addRow([`${config.orgName} - Liquidation report`]).font = { bold: true, size: 14 };
  ws.addRow([`Approved records from ${f.from} to ${f.to}${f.label ? ' · ' + f.label : ''}`]).font = { color: { argb: 'FF546770' } };
  ws.addRow([]);
  const head = ws.addRow(HEAD);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0C7480' } }; });
  rows.forEach((r) => ws.addRow(cells(r)));
  const first = 5, last = 4 + rows.length;
  const tot = ws.addRow(['', '', '', '', '', '', 'Total', rows.length ? { formula: `SUM(H${first}:H${last})` } : 0]);
  tot.font = { bold: true };
  ws.getColumn(8).numFmt = '#,##0.00';
  [16, 16, 14, 30, 16, 22, 14, 16].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.views = [{ state: 'frozen', ySplit: 4 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function buildPdf(rows: Row[], total: number, f: { from: string; to: string; label?: string }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const L = 40, W = doc.page.width - 80;
    const cols = [{ h: 'Document no.', w: 92 }, { h: 'Receipt ref.', w: 92 }, { h: 'Date', w: 66 }, { h: 'Paid to', w: 170 }, { h: 'Category', w: 80 }, { h: 'Encoded by', w: 100 }, { h: 'Amount', w: 0 }];
    cols[6]!.w = W - cols.slice(0, 6).reduce((s, c) => s + c.w, 0);
    const header = () => {
      drawLogo(doc, L, 32, 38);
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#0c7480').text(config.orgName.toUpperCase(), L + 48, 34);
      doc.font('Helvetica-Bold').fontSize(16).fillColor('#12232b').text('Liquidation Report', L + 48, 48);
      doc.font('Helvetica').fontSize(9).fillColor('#546770').text(`Approved records · ${f.from} to ${f.to}${f.label ? ' · ' + f.label : ''} · ${rows.length} record${rows.length === 1 ? '' : 's'}`, L + 48, 70);
      let x = L;
      const y = 94;
      doc.rect(L, y, W, 20).fill('#0c7480');
      cols.forEach((c) => {
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff').text(c.h.toUpperCase(), x + 4, y + 6, { width: c.w - 8, align: c.h === 'Amount' ? 'right' : 'left' });
        x += c.w;
      });
      return y + 24;
    };
    let y = header();
    rows.forEach((r, i) => {
      if (y > doc.page.height - 70) { doc.addPage(); y = header(); }
      if (i % 2) doc.rect(L, y - 3, W, 18).fill('#f1f6f6');
      const vals = [r.docNo, r.refNo, r.date, r.payee, r.category, r.encoder, php(r.amount)];
      let x = L;
      cols.forEach((c, j) => {
        doc.font('Helvetica').fontSize(8.5).fillColor('#12232b').text(vals[j]!, x + 4, y, { width: c.w - 8, height: 12, ellipsis: true, align: j === 6 ? 'right' : 'left' });
        x += c.w;
      });
      y += 18;
    });
    if (y > doc.page.height - 90) { doc.addPage(); y = header(); }
    doc.moveTo(L, y + 2).lineTo(L + W, y + 2).strokeColor('#12232b').stroke();
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#12232b').text(`Total  ${php(total)}`, L, y + 10, { width: W, align: 'right' });
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
    const { rows, total } = await reportRows(f);
    const buf = rep.format === 'pdf' ? await buildPdf(rows, total, { ...f, label }) : rep.format === 'xlsx' ? await buildXlsx(rows, { ...f, label }) : await buildCsv(rows, total);
    const filePath = await saveFile('reports', rep.format, buf);
    await prisma.liquidationReport.update({ where: { id: rep.id }, data: { status: 'ready', filePath, rowCount: rows.length, total, finishedAt: new Date(), error: null } });
  } catch (err) {
    await prisma.liquidationReport.update({ where: { id: rep.id }, data: { status: 'failed', error: (err instanceof Error ? err.message : String(err)).slice(0, 300), finishedAt: new Date() } });
    throw err;
  }
});
