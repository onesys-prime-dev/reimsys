import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { notFound } from '../lib/errors.js';
import { assertOwner, loadVisible } from '../lib/receipts.js';
import { canEditReceipt, type ReceiptStatus } from '@reimsys/shared';
import { requireAuth, requirePerm } from '../middleware/auth.js';

/**
 * Unfinished forms. The page saves what has been typed a moment after each change, even when it is half filled and would not pass the checks of a
 * receipt, so a wrong exit loses nothing. A draft belongs to its owner alone and is never listed, counted or audited as a receipt.
 */
export const formDraftsRouter = Router();
formDraftsRouter.use(requireAuth, requirePerm('receipt.create'));

const KEPT_DAYS = 30;

const bodySchema = z.object({
  id: z.number().int().positive().optional(),
  receiptId: z.number().int().positive().nullable().optional(),
  step: z.number().int().min(0).max(20).default(0),
  // The answers exactly as typed: text and ticks only, nothing that could be run.
  data: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,40}$/), z.union([z.string().max(1000), z.boolean()])).refine((o) => Object.keys(o).length <= 60, 'Too many answers.'),
});

const idParam = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0 || n > 2_147_483_647) throw notFound('That unfinished form was not found.');
  return n;
};

const parse = (text: string): Record<string, string | boolean> => { try { const v = JSON.parse(text); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };

const brief = (d: { id: number; receiptId: number | null; step: number; data: string; updatedAt: Date }) => {
  const a = parse(d.data);
  const s = (k: string) => (typeof a[k] === 'string' ? (a[k] as string).trim() : '');
  return { id: d.id, receiptId: d.receiptId, step: d.step, updatedAt: d.updatedAt.toISOString(), vendor: s('payee') || null, amount: s('amount') && !Number.isNaN(Number(s('amount'))) ? Number(s('amount')) : null, invoiceNo: s('invoiceNo') || null };
};

/** The person's unfinished forms, newest first. Ones left for a month are dropped. */
formDraftsRouter.get('/', async (req, res) => {
  const userId = req.auth!.user.id;
  await prisma.formDraft.deleteMany({ where: { userId, updatedAt: { lt: new Date(Date.now() - KEPT_DAYS * 86_400_000) } } });
  const rows = await prisma.formDraft.findMany({ where: { userId }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: 50 });
  res.json({ drafts: rows.map(brief) });
});

formDraftsRouter.get('/:id', async (req, res) => {
  const d = await prisma.formDraft.findFirst({ where: { id: idParam(req.params.id), userId: req.auth!.user.id } });
  if (!d) throw notFound('That unfinished form was not found.');
  res.json({ draft: { ...brief(d), data: parse(d.data) } });
});

/** Saves the answers. With an id it replaces that draft; with a receipt it is the one draft of that receipt; otherwise a new draft is started. */
formDraftsRouter.put('/', async (req, res) => {
  const userId = req.auth!.user.id;
  const body = bodySchema.parse(req.body);
  const text = JSON.stringify(body.data);
  let draft = body.id ? await prisma.formDraft.findFirst({ where: { id: body.id, userId } }) : null;
  if (body.id && !draft) throw notFound('That unfinished form was not found.');
  if (!draft && body.receiptId) {
    // Only the owner of an editable receipt keeps changes for it.
    const r = await loadVisible(req.auth!, body.receiptId);
    assertOwner(req.auth!, r);
    if (!canEditReceipt(r.status as ReceiptStatus)) throw notFound('That receipt can no longer be edited.');
    draft = await prisma.formDraft.findFirst({ where: { userId, receiptId: r.id } });
  }
  const saved = draft
    ? await prisma.formDraft.update({ where: { id: draft.id }, data: { data: text, step: body.step } })
    : await prisma.formDraft.create({ data: { userId, receiptId: body.receiptId ?? null, data: text, step: body.step } });
  res.json({ draft: brief(saved) });
});

formDraftsRouter.delete('/:id', async (req, res) => {
  await prisma.formDraft.deleteMany({ where: { id: idParam(req.params.id), userId: req.auth!.user.id } });
  res.json({ ok: true });
});
