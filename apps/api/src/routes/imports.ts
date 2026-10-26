import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { parse } from 'csv-parse/sync';
import { assertSafeZip } from '../lib/zipGuard.js';
import { CLASSIFICATIONS, CLASSIFICATION_LABEL, cleanFormData, makeReceiptSchema } from '@reimsys/shared';
import { getSettings } from '../lib/appSettings.js';
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
const TEMPLATE_HEAD = ['vendor', 'invoice_date', 'invoice_no', 'vendor_tin', 'vendor_address', 'gross_amount', 'type', 'bir_invoice', 'invoice_under_company', 'company_check', 'reason_for_spending', 'classification', 'vat_type', 'vatable_amount', 'vat_amount', 'vat_exempt_amount', 'discount', 'tax_withheld', 'wht_rate', 'wht_amount', 'charge_location', 'new_reimbursement_code', 'reimbursement_code', 'description', 'encoder_email'];

const idParam = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0 || n > 2_147_483_647) throw notFound();
  return n;
};

const norm = (h: string) => h.trim().toLowerCase().replace(/[\s-]+/g, '_');
const ALIAS: Record<string, string> = {
  paid_to: 'payee', vendor: 'payee', vendor_name: 'payee', date: 'receipt_date', invoice_date: 'receipt_date', amount_php: 'amount', gross_amount: 'amount',
  no_bir_reason: 'reason_for_spending', reason: 'reason_for_spending', encoder: 'encoder_email', email: 'encoder_email', transaction_type: 'type', business_transaction: 'type', bir: 'bir_invoice', tin: 'vendor_tin', withheld: 'tax_withheld',
};
const yesNo = (v: string | undefined) => (/^(yes|y|true|1)$/i.test((v ?? '').trim()) ? true : /^(no|n|false|0)$/i.test((v ?? '').trim()) ? false : undefined);
/** "Meeting, Seminar, or Convention", "meal" or "Other: team building" -> the stored code and, for Other, the person's words. */
function readClassification(v: string | undefined, other: string | undefined) {
  const s = (v ?? '').trim();
  if (!s) return {};
  const m = /^other\s*[:\-]?\s*(.*)$/i.exec(s);
  if (m) return { classification: 'other', classificationOther: (m[1] || other || '').trim() || undefined };
  const lower = s.toLowerCase();
  // The words of the old list still work: Meal is Meal - Personal, Representation is Representation - Meal.
  const legacy: Record<string, string> = { meal: 'meal_personal', representation: 'representation_meal' };
  const code = CLASSIFICATIONS.find((c) => c === lower || CLASSIFICATION_LABEL[c].toLowerCase() === lower) ?? legacy[lower] ?? CLASSIFICATIONS.find((c) => lower.startsWith(c.split('_')[0]!));
  return { classification: code ?? lower };
}
const num = (v: string | undefined) => (v ?? '').replace(/[₱,%\s]|php/gi, '');

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
  for (const need of ['payee', 'receipt_date', 'amount']) {
    if (!head.includes(need)) throw badRequest(`Missing the "${need}" column. Download the template to see the layout.`, 'BAD_TEMPLATE');
  }
  return table.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').toString().trim()])));
}

importsRouter.get('/template', (_req, res) => {
  const sample = [
    ['Mercury Drug - Mandaue', '2026-10-12', 'SI-004521', '123-456-789-00000', 'Mandaue City, Cebu', '1120.00', 'product', 'yes', 'yes', 'yes', 'Clinic supplies for the week', 'Other: Clinic supplies', 'vatable', '1000.00', '120.00', '0', '0', 'no', '', '', 'Makati Medical Center', 'yes', '', 'Clinic supplies', ''],
    ['Corner Store', '2026-10-12', '', '', 'Mandaue City, Cebu', '350.00', '', 'no', '', '', 'Water refills for the clinic', 'meal - personal', '', '', '', '', '', '', '', '', 'Makati Medical Center', 'yes', '', '', ''],
  ];
  res.type('text/csv').attachment('reimsys-import-template.csv').send(toCsv([TEMPLATE_HEAD, ...sample]));
});

importsRouter.post('/', upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) throw badRequest('Choose a CSV or XLSX file.');
  const rows = await readRows(file);
  if (rows.length > MAX_ROWS) throw badRequest(`Import up to ${MAX_ROWS} rows at a time.`, 'TOO_MANY_ROWS');
  const auth = req.auth!;
  const importerIsEncoder = auth.permissions.has('receipt.create');

  const encoders = await prisma.user.findMany({ where: { isActive: true, role: { permissions: { some: { permission: { code: 'receipt.create' } } } } }, select: { id: true, email: true } });
  const chargeLocations = await prisma.chargeLocation.findMany({ where: { isActive: true }, select: { id: true, name: true } });
  const valid: { payee: string; receiptDate: string; amount: number; description: string | null; form: ReturnType<typeof cleanFormData> | null; encoderId: number }[] = [];
  const errors: { row: number; message: string }[] = [];

  rows.forEach((r, i) => {
    const rowNo = i + 2;
    let encoderId = auth.user.id;
    if (r.encoder_email) {
      const e = encoders.find((x) => x.email.toLowerCase() === r.encoder_email!.toLowerCase());
      if (!e) return void errors.push({ row: rowNo, message: `No active Med Ref with email "${r.encoder_email}".` });
      if (importerIsEncoder && e.id !== auth.user.id) return void errors.push({ row: rowNo, message: 'You can only import receipts for yourself.' });
      encoderId = e.id;
    } else if (!importerIsEncoder) {
      return void errors.push({ row: rowNo, message: 'Add the encoder_email column so the receipt has an owner.' });
    }
    // A row from the old template has no invoice answers. It still becomes a draft, and the Med Ref fills in the invoice details before submitting.
    const full = yesNo(r.bir_invoice) !== undefined;
    const candidate = {
      payee: r.payee, receiptDate: r.receipt_date, amount: num(r.amount), description: r.description || null,
      ...(full ? {
        birInvoice: yesNo(r.bir_invoice), invoiceUnderCompany: yesNo(r.invoice_under_company) ?? (yesNo(r.bir_invoice) ? true : undefined), seenCompany: yesNo(r.company_check), seenTin: yesNo(r.company_check), seenAddress: yesNo(r.company_check),
        reasonForSpending: r.reason_for_spending, ...readClassification(r.classification, r.classification_other),
        invoiceNo: r.invoice_no, vendorAddress: r.vendor_address, vendorTin: r.vendor_tin, transactionType: (r.type ?? '').toLowerCase(),
        vatType: (r.vat_type ?? '').toLowerCase().replace(/[\s-]+/g, '_'), vatableAmount: num(r.vatable_amount), vatAmount: num(r.vat_amount), vatExemptAmount: num(r.vat_exempt_amount), discountAmount: num(r.discount),
        chargeLocationId: chargeLocations.find((c) => c.name.toLowerCase() === (r.charge_location ?? '').trim().toLowerCase())?.id, newReimbursementCode: yesNo(r.new_reimbursement_code), reimbursementCode: r.reimbursement_code,
        withheld: yesNo(r.tax_withheld), whtRate: num(r.wht_rate), whtAmount: num(r.wht_amount),
      } : { birInvoice: false, vendorAddress: 'x', reasonForSpending: 'xxx', classification: 'fuel' }),
    };
    const parsed = makeReceiptSchema(getSettings(), false).safeParse(candidate);
    if (!parsed.success) {
      const label: Record<string, string> = { receiptDate: 'invoice_date', payee: 'vendor', amount: 'gross_amount', birInvoice: 'bir_invoice', transactionType: 'type', reasonForSpending: 'reason_for_spending', classification: 'classification', classificationOther: 'classification', invoiceUnderCompany: 'invoice_under_company', seenCompany: 'company_check', seenTin: 'company_check', seenAddress: 'company_check' };
      return void errors.push({ row: rowNo, message: parsed.error.issues.map((x) => `${label[String(x.path[0])] ?? x.path[0]}: ${x.message}`).join(' ') });
    }
    valid.push({ payee: parsed.data.payee, receiptDate: parsed.data.receiptDate, amount: parsed.data.amount, description: parsed.data.description ?? null, form: full ? cleanFormData(parsed.data, getSettings()) : null, encoderId });
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
  const rows = JSON.parse(job.rows) as { payee: string; receiptDate: string; amount: number; description: string | null; form: ReturnType<typeof cleanFormData> | null; encoderId: number }[];
  if (!rows.length) throw badRequest('There are no valid rows to import.');
  const claimed = await prisma.importJob.updateMany({ where: { id: job.id, status: 'previewed' }, data: { status: 'confirmed', confirmedAt: new Date() } });
  if (!claimed.count) throw conflict('This import was already processed.', 'ALREADY_DONE');
  const created = await prisma.$transaction(async (tx) => {
    const out: { id: number; refNo: string }[] = [];
    for (const r of rows) {
      const rec = await tx.receipt.create({
        data: { refNo: await nextReceiptRef(tx), encoderId: r.encoderId, payee: r.payee, receiptDate: new Date(r.receiptDate + 'T00:00:00Z'), amount: r.amount, description: r.description, ...(r.form ?? {}) },
      });
      out.push({ id: rec.id, refNo: rec.refNo });
    }
    return out;
  }, { timeout: 60_000 });
  for (const c of created) await audit(req, { action: 'receipt.created', entityType: 'receipt', entityId: c.id, summary: `created the draft ${c.refNo} from import "${job.fileName}"` });
  await audit(req, { action: 'import.confirmed', entityType: 'import', entityId: job.id, summary: `imported ${created.length} receipt${created.length === 1 ? '' : 's'} from "${job.fileName}"` });
  res.json({ created: created.length });
});
