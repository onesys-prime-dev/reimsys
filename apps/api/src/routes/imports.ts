import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { parse } from 'csv-parse/sync';
import { assertSafeZip } from '../lib/zipGuard.js';
import { receiptInputSchema } from '@reimsys/shared';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { toCsv } from '../lib/reports.js';
import { nextReceiptRef } from '../lib/sequence.js';
import { requireAuth, requirePerm } from '../middleware/auth.js';

export const importsRouter = Router();
importsRouter.use(requireAuth, requirePerm('receipt.import'));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const MAX_ROWS = 2000;
const TEMPLATE_HEAD = ['payee', 'receipt_date', 'amount', 'category', 'description', 'encoder_email'];

const idParam = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw notFound();
  return n;
};

const norm = (h: string) => h.trim().toLowerCase().replace(/[\s-]+/g, '_');
const ALIAS: Record<string, string> = { paid_to: 'payee', date: 'receipt_date', amount_php: 'amount', encoder: 'encoder_email', email: 'encoder_email' };

function cellText(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as { text?: unknown; result?: unknown; richText?: { text: string }[] };
    if (o.richText) return o.richText.map((t) => t.text).join('');
    if (o.result !== undefined) return cellText(o.result);
    if (o.text !== undefined) return String(o.text);
  }
  return String(v).trim();
}

async function readRows(file: Express.Multer.File): Promise<Record<string, string>[]> {
  const isXlsx = /\.xlsx$/i.test(file.originalname) || file.buffer.subarray(0, 2).toString('ascii') === 'PK';
  let table: string[][];
  if (isXlsx) {
    const wb = new ExcelJS.Workbook();
    assertSafeZip(file.buffer);
    await wb.xlsx.load(file.buffer as never);
    const ws = wb.worksheets[0];
    if (!ws) throw badRequest('The workbook has no sheets.');
    table = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = (row.values as unknown[]).slice(1);
      table.push(vals.map(cellText));
    });
  } else {
    table = parse(file.buffer, { bom: true, skip_empty_lines: true, relax_column_count: true, trim: true }) as string[][];
  }
  if (table.length < 2) throw badRequest('The file has no data rows.');
  const head = table[0]!.map((h) => { const n = norm(h); return ALIAS[n] ?? n; });
  for (const need of ['payee', 'receipt_date', 'amount', 'category']) {
    if (!head.includes(need)) throw badRequest(`Missing the "${need}" column. Download the template to see the layout.`, 'BAD_TEMPLATE');
  }
  return table.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').toString().trim()])));
}

importsRouter.get('/template', (_req, res) => {
  const sample = [['Mercury Drug - Mandaue', '2026-10-12', '1284.50', 'Medicine', 'Clinic supplies', '']];
  res.type('text/csv').attachment('reimsys-import-template.csv').send(toCsv([TEMPLATE_HEAD, ...sample]));
});

importsRouter.post('/', upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) throw badRequest('Choose a CSV or XLSX file.');
  const rows = await readRows(file);
  if (rows.length > MAX_ROWS) throw badRequest(`Import up to ${MAX_ROWS} rows at a time.`, 'TOO_MANY_ROWS');
  const auth = req.auth!;
  const importerIsEncoder = auth.permissions.has('receipt.create');

  const cats = await prisma.category.findMany({ where: { isActive: true } });
  const encoders = await prisma.user.findMany({ where: { isActive: true, role: { permissions: { some: { permission: { code: 'receipt.create' } } } } }, select: { id: true, email: true } });
  const valid: Record<string, unknown>[] = [];
  const errors: { row: number; message: string }[] = [];

  rows.forEach((r, i) => {
    const rowNo = i + 2;
    const cat = cats.find((c) => c.name.toLowerCase() === (r.category ?? '').toLowerCase());
    if (!cat) return void errors.push({ row: rowNo, message: `Unknown category "${r.category}". Use one of: ${cats.map((c) => c.name).join(', ')}.` });
    let encoderId = auth.user.id;
    if (r.encoder_email) {
      const e = encoders.find((x) => x.email.toLowerCase() === r.encoder_email!.toLowerCase());
      if (!e) return void errors.push({ row: rowNo, message: `No active Med Ref with email "${r.encoder_email}".` });
      if (importerIsEncoder && e.id !== auth.user.id) return void errors.push({ row: rowNo, message: 'You can only import receipts for yourself.' });
      encoderId = e.id;
    } else if (!importerIsEncoder) {
      return void errors.push({ row: rowNo, message: 'Add the encoder_email column so the receipt has an owner.' });
    }
    const parsed = receiptInputSchema.safeParse({ payee: r.payee, receiptDate: r.receipt_date, amount: (r.amount ?? '').replace(/[₱,\s]|php/gi, ''), categoryId: cat.id, description: r.description || null });
    if (!parsed.success) return void errors.push({ row: rowNo, message: parsed.error.issues.map((x) => `${x.path[0] === 'receiptDate' ? 'receipt_date' : x.path[0]}: ${x.message}`).join(' ') });
    valid.push({ ...parsed.data, encoderId });
  });

  const job = await prisma.importJob.create({
    data: { userId: auth.user.id, fileName: file.originalname.slice(0, 200), rows: JSON.stringify(valid), errors: JSON.stringify(errors), totalRows: rows.length, validRows: valid.length },
  });
  await audit(req, { action: 'import.previewed', entityType: 'import', entityId: job.id, summary: `previewed import "${job.fileName}" (${valid.length} valid, ${errors.length} with errors)` });
  res.status(201).json({ id: job.id, fileName: job.fileName, totalRows: rows.length, validRows: valid.length, errors: errors.slice(0, 200), errorCount: errors.length, preview: valid.slice(0, 10) });
});

importsRouter.get('/:id/errors.csv', async (req, res) => {
  const job = await prisma.importJob.findFirst({ where: { id: idParam(req.params.id), userId: req.auth!.user.id } });
  if (!job) throw notFound();
  const errs = JSON.parse(job.errors) as { row: number; message: string }[];
  res.type('text/csv').attachment(`import-${job.id}-errors.csv`).send(toCsv([['Row', 'Problem'], ...errs.map((e) => [e.row, e.message])]));
});

importsRouter.post('/:id/confirm', async (req, res) => {
  const job = await prisma.importJob.findFirst({ where: { id: idParam(req.params.id), userId: req.auth!.user.id } });
  if (!job) throw notFound();
  if (job.status !== 'previewed') throw conflict('This import was already processed.', 'ALREADY_DONE');
  const rows = JSON.parse(job.rows) as { payee: string; receiptDate: string; amount: number; categoryId: number; description: string | null; encoderId: number }[];
  if (!rows.length) throw badRequest('There are no valid rows to import.');
  const claimed = await prisma.importJob.updateMany({ where: { id: job.id, status: 'previewed' }, data: { status: 'confirmed', confirmedAt: new Date() } });
  if (!claimed.count) throw conflict('This import was already processed.', 'ALREADY_DONE');
  const created = await prisma.$transaction(async (tx) => {
    const out: { id: number; refNo: string }[] = [];
    for (const r of rows) {
      const rec = await tx.receipt.create({
        data: { refNo: await nextReceiptRef(tx), encoderId: r.encoderId, payee: r.payee, receiptDate: new Date(r.receiptDate + 'T00:00:00Z'), amount: r.amount, categoryId: r.categoryId, description: r.description },
      });
      out.push({ id: rec.id, refNo: rec.refNo });
    }
    return out;
  }, { timeout: 60_000 });
  for (const c of created) await audit(req, { action: 'receipt.created', entityType: 'receipt', entityId: c.id, summary: `created the draft ${c.refNo} from import "${job.fileName}"` });
  await audit(req, { action: 'import.confirmed', entityType: 'import', entityId: job.id, summary: `imported ${created.length} receipt${created.length === 1 ? '' : 's'} from "${job.fileName}"` });
  res.json({ created: created.length });
});
