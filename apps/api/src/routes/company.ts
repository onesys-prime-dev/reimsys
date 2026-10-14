import { Router } from 'express';
import { DEFAULT_COMPANY, companySchema, type Company } from '@reimsys/shared';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { requireAuth, requirePerm } from '../middleware/auth.js';

const KEY = 'company';
export const companyRouter = Router();
companyRouter.use(requireAuth);

export async function getCompany(): Promise<Company> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  if (!row) return DEFAULT_COMPANY;
  try { return { ...DEFAULT_COMPANY, ...(JSON.parse(row.value) as Partial<Company>) }; } catch { return DEFAULT_COMPANY; }
}

/** Everyone who fills in the form needs to see whose name, TIN and address the invoice must carry. */
companyRouter.get('/', async (_req, res) => {
  res.json({ company: await getCompany() });
});

companyRouter.put('/', requirePerm('settings.manage'), async (req, res) => {
  const c = companySchema.parse(req.body);
  const before = await getCompany();
  await prisma.setting.upsert({ where: { key: KEY }, update: { value: JSON.stringify(c), updatedById: req.auth!.user.id }, create: { key: KEY, value: JSON.stringify(c), updatedById: req.auth!.user.id } });
  await audit(req, { action: 'settings.company_saved', entityType: 'settings', entityId: KEY, summary: 'changed the company name, TIN or address that invoices must show', before, after: c });
  res.json({ company: c });
});
