import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { categorySchema, type ReceiptStatus } from '@reimsys/shared';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { config } from '../config.js';
import { queueEmail } from '../lib/email.js';
import { renderEmail } from '../lib/emailTemplates.js';
import { resolveMail } from '../lib/mailSettings.js';
import { sendDigestNow } from '../lib/digest.js';
import { sendReminders } from '../lib/reminders.js';
import { enqueue } from '../lib/jobs.js';
import { dateOnly, receiptBrief, receiptInclude, visibleWhere } from '../lib/receipts.js';
import { requireAuth, requirePerm } from '../middleware/auth.js';

const idParam = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0 || n > 2_147_483_647) throw notFound();
  return n;
};

/* ---------- categories ---------- */
export const categoriesRouter = Router();
categoriesRouter.use(requireAuth);

categoriesRouter.get('/', async (req, res) => {
  const all = req.query.all === 'true' && req.auth!.permissions.has('category.manage');
  const rows = await prisma.category.findMany({ where: all ? {} : { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], include: { _count: { select: { receipts: true } } } });
  res.json({ categories: rows.map((c) => ({ id: c.id, name: c.name, isActive: c.isActive, receiptCount: c._count.receipts })) });
});

categoriesRouter.post('/', requirePerm('category.manage'), async (req, res) => {
  const data = categorySchema.parse(req.body);
  const c = await prisma.category.create({ data: { name: data.name, isActive: data.isActive ?? true } });
  await audit(req, { action: 'category.created', entityType: 'category', entityId: c.id, summary: `created category ${c.name}` });
  res.status(201).json({ category: { id: c.id, name: c.name, isActive: c.isActive, receiptCount: 0 } });
});

categoriesRouter.patch('/:id', requirePerm('category.manage'), async (req, res) => {
  const id = idParam(req.params.id);
  const data = categorySchema.partial().parse(req.body);
  const before = await prisma.category.findUnique({ where: { id } });
  if (!before) throw notFound('Category not found.');
  const c = await prisma.category.update({ where: { id }, data });
  await audit(req, { action: 'category.updated', entityType: 'category', entityId: id, summary: `updated category ${c.name}`, before: { name: before.name, isActive: before.isActive }, after: { name: c.name, isActive: c.isActive } });
  res.json({ category: { id: c.id, name: c.name, isActive: c.isActive } });
});

/* ---------- notifications ---------- */
export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get('/', async (req, res) => {
  const userId = req.auth!.user.id;
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId }, orderBy: { id: 'desc' }, take: 30 }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);
  res.json({ unread, items: items.map((n) => ({ id: n.id, type: n.type, text: n.text, receiptId: n.receiptId, read: !!n.readAt, createdAt: n.createdAt })) });
});

notificationsRouter.post('/read', async (req, res) => {
  // A huge number is still a whole number but would crash the query (too big for the column), so ids outside the column's range are ignored.
  const dbId = (n: number) => Number.isInteger(n) && n > 0 && n <= 2_147_483_647;
  const ids = Array.isArray(req.body?.ids) ? (req.body.ids as unknown[]).map(Number).filter(dbId) : null;
  const receiptId = dbId(Number(req.body?.receiptId)) ? Number(req.body.receiptId) : null;
  await prisma.notification.updateMany({
    where: { userId: req.auth!.user.id, readAt: null, ...(ids ? { id: { in: ids } } : {}), ...(receiptId ? { receiptId } : {}) },
    data: { readAt: new Date() },
  });
  res.json({ ok: true });
});

/* ---------- dashboard ---------- */
export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get('/', async (req, res) => {
  const auth = req.auth!;
  const p = auth.permissions;
  const scope = visibleWhere(auth);
  const grouped = await prisma.receipt.groupBy({ by: ['status'], where: scope, _count: { _all: true }, _sum: { amount: true } });
  const counts: Record<string, number> = {};
  const sums: Record<string, number> = {};
  for (const g of grouped) { counts[g.status] = g._count._all; sums[g.status] = Number(g._sum.amount ?? 0); }

  let queueWhere: Prisma.ReceiptWhereInput;
  let queueTitle: string;
  let oldestFirst = true;
  if (p.has('review.check')) { queueWhere = { status: 'submitted' }; queueTitle = 'Waiting to be checked'; }
  else if (p.has('review.decide')) { queueWhere = { status: 'checked' }; queueTitle = 'Ready for your decision'; }
  else if (p.has('receipt.create')) { queueWhere = { encoderId: auth.user.id, status: { in: ['returned', 'reserved', 'draft'] } }; queueTitle = 'Your next steps'; oldestFirst = false; }
  else if (p.has('payment.mark')) { queueWhere = { status: 'approved', encoderId: { not: auth.user.id } }; queueTitle = 'Ready to pay'; }
  else { queueWhere = { status: { in: ['submitted', 'checked'] } }; queueTitle = 'Pending in the workflow'; }
  const queue = await prisma.receipt.findMany({
    where: { AND: [scope, queueWhere] }, include: receiptInclude,
    orderBy: oldestFirst ? [{ submittedAt: 'asc' }, { id: 'asc' }] : [{ updatedAt: 'desc' }], take: 6,
  });
  const queueTotal = await prisma.receipt.count({ where: { AND: [scope, queueWhere] } });
  const now = new Date();
  const paidMonth = await prisma.receipt.aggregate({
    where: { AND: [scope, { status: 'paid', paidAt: { gte: new Date(now.getFullYear(), now.getMonth(), 1) } }] },
    _count: { _all: true }, _sum: { paidAmount: true },
  });

  let activity;
  if (p.has('audit.view')) {
    // Sign-ins and evidence views would drown out the real work, so the feed skips them. The audit log still has everything.
    activity = await prisma.auditLog.findMany({ where: { NOT: [{ action: { startsWith: 'auth.' } }, { action: { startsWith: 'evidence.' } }] }, orderBy: { id: 'desc' }, take: 8 });
  } else {
    const recent = await prisma.receipt.findMany({ where: scope, select: { id: true }, orderBy: { updatedAt: 'desc' }, take: 50 });
    activity = await prisma.auditLog.findMany({ where: { entityType: 'receipt', entityId: { in: recent.map((r) => String(r.id)) }, action: { notIn: ['evidence.viewed', 'evidence.downloaded', 'evidence.printed'] } }, orderBy: { id: 'desc' }, take: 8 });
  }
  const refs = await prisma.receipt.findMany({ where: { id: { in: activity.filter((a) => a.entityType === 'receipt' && a.entityId).map((a) => Number(a.entityId)) } }, select: { id: true, refNo: true } });
  res.json({
    counts, sums, queueTitle, queueTotal,
    paidThisMonth: { count: paidMonth._count._all, total: Number(paidMonth._sum.paidAmount ?? 0) },
    queue: queue.map((r) => ({ ...receiptBrief(r), status: r.status as ReceiptStatus })),
    activity: activity.map((a) => ({ id: a.id, actor: a.actorName, summary: a.summary ?? a.action, receiptId: a.entityType === 'receipt' && a.entityId ? Number(a.entityId) : null, refNo: refs.find((x) => String(x.id) === a.entityId)?.refNo ?? null, createdAt: a.createdAt })),
    today: dateOnly(new Date()),
  });
});

/* ---------- email log (admin) ---------- */
export const emailLogRouter = Router();
emailLogRouter.use(requireAuth, requirePerm('audit.view'));

emailLogRouter.get('/', async (req, res) => {
  const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : undefined;
  const page = Math.max(1, Number(req.query.page) || 1);
  const where: Prisma.EmailLogWhereInput = status ? { status } : {};
  const [total, rows] = await Promise.all([
    prisma.emailLog.count({ where }),
    prisma.emailLog.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * 25, take: 25 }),
  ]);
  res.json({ total, page, pageSize: 25, items: rows.map((e) => ({ id: e.id, to: e.toEmail, template: e.template, subject: e.subject, status: e.status, attempts: e.attempts, error: e.error, createdAt: e.createdAt, sentAt: e.sentAt, response: e.response })) });
});

emailLogRouter.post('/:id/retry', async (req, res) => {
  const id = idParam(req.params.id);
  const row = await prisma.emailLog.findUnique({ where: { id } });
  if (!row) throw notFound();
  if (row.status === 'sent') throw conflict('That email was already sent.');
  await prisma.emailLog.update({ where: { id }, data: { status: 'queued', error: null } });
  await enqueue('email', { emailLogId: id });
  await audit(req, { action: 'email.retried', entityType: 'email', entityId: id, summary: `retried email to ${row.toEmail}` });
  res.json({ ok: true });
});

emailLogRouter.get('/status', async (_req, res) => {
  const mail = await resolveMail();
  res.json({ configured: !!mail.smtp, source: mail.source, testRedirect: mail.redirectTo ?? null, passwordUnreadable: !!mail.passwordUnreadable, host: mail.smtp?.host ?? null, port: mail.smtp?.port ?? null, from: mail.from });
});

/** Sends a short message so an administrator can confirm the mail settings work. It goes through the same queue as real emails. */
emailLogRouter.post('/test', async (req, res) => {
  const to = typeof req.body?.to === 'string' ? req.body.to.trim() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw badRequest('Enter a valid email address.');
  const mail = await renderEmail({ key: 'test', data: { actorName: req.auth!.user.name }, link: config.webOrigin });
  await queueEmail({ to, template: 'test', subject: mail.subject, html: mail.html });
  await audit(req, { action: 'email.test', entityType: 'email', summary: `sent a test email to ${to}` });
  res.status(202).json({ ok: true });
});

/** Sends the reminders for receipts that have waited too long right now (they also go out by themselves at 9am), so an administrator can try the settings. */
emailLogRouter.post('/reminders-now', async (req, res) => {
  const sent = await sendReminders();
  await audit(req, { action: 'email.reminders_sent', entityType: 'email', summary: `sent waiting-receipt reminders to ${sent} people now` });
  res.json({ sent });
});

/** Sends one person their daily summary right now, so an administrator can see what it looks like. */
emailLogRouter.post('/digest-now', async (req, res) => {
  const userId = Number(req.body?.userId);
  if (!Number.isInteger(userId) || userId <= 0 || userId > 2_147_483_647) throw badRequest('Choose a person.');
  const sent = await sendDigestNow(userId);
  if (sent) await audit(req, { action: 'email.digest_sent', entityType: 'email', summary: `sent the daily summary to user #${userId} now` });
  res.json({ sent });
});
