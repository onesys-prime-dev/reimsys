import { z } from 'zod';

/* ---------- roles ---------- */
export const ROLE_CODES = ['medref', 'checker', 'approver', 'admin'] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

export const DEFAULT_ROLES: { code: RoleCode; name: string; rank: number }[] = [
  { code: 'medref', name: 'Med Ref', rank: 10 },
  { code: 'checker', name: 'Checker', rank: 20 },
  { code: 'approver', name: 'Approver', rank: 30 },
  { code: 'admin', name: 'Super Admin', rank: 100 },
];

/* ---------- permissions ---------- */
export interface PermissionDef { code: string; label: string; group: string }

export const PERMISSIONS: PermissionDef[] = [
  { code: 'receipt.create', label: 'Create and edit own receipts', group: 'Receipts' },
  { code: 'receipt.view_all', label: 'View all receipts', group: 'Receipts' },
  { code: 'receipt.import', label: 'Import CSV or XLSX', group: 'Receipts' },
  { code: 'evidence.view', label: 'View evidence (logged)', group: 'Evidence' },
  { code: 'evidence.download', label: 'Download evidence', group: 'Evidence' },
  { code: 'evidence.print', label: 'Print evidence', group: 'Evidence' },
  { code: 'review.check', label: 'Check or return', group: 'Review' },
  { code: 'review.decide', label: 'Approve, disapprove, reserve, release', group: 'Review' },
  { code: 'report.generate', label: 'Generate liquidation reports', group: 'Reports' },
  { code: 'user.manage', label: 'Manage users', group: 'Administration' },
  { code: 'role.manage', label: 'Manage roles and permissions', group: 'Administration' },
  { code: 'audit.view', label: 'Browse the audit log', group: 'Administration' },
  { code: 'category.manage', label: 'Manage receipt categories', group: 'Administration' },
  { code: 'settings.manage', label: 'Manage email and system settings', group: 'Administration' },
];
export type PermissionCode = (typeof PERMISSIONS)[number]['code'];

const ALL: RoleCode[] = ['medref', 'checker', 'approver', 'admin'];
export const DEFAULT_GRANTS: Record<string, RoleCode[]> = {
  'receipt.create': ['medref'],
  'receipt.view_all': ['checker', 'admin'],
  'receipt.import': ['medref', 'admin'],
  'evidence.view': ALL,
  'evidence.download': ALL,
  'evidence.print': ALL,
  'review.check': ['checker'],
  'review.decide': ['approver'],
  'report.generate': ALL,
  'user.manage': ['admin'],
  'role.manage': ['admin'],
  'audit.view': ['admin'],
  'category.manage': ['admin'],
  'settings.manage': ['admin'],
};

/** Grants that can never be removed, so the system always has a review path and an administrator. */
export const LOCKED_GRANTS: { role: RoleCode; permission: string }[] = [
  { role: 'checker', permission: 'review.check' },
  { role: 'approver', permission: 'review.decide' },
  { role: 'admin', permission: 'user.manage' },
  { role: 'admin', permission: 'role.manage' },
  { role: 'admin', permission: 'settings.manage' },
];
export const isLockedGrant = (role: string, permission: string) =>
  LOCKED_GRANTS.some((g) => g.role === role && g.permission === permission);


/* ---------- validation ---------- */
export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters.')
  .max(128)
  .regex(/[A-Za-z]/, 'Include a letter.')
  .regex(/\d/, 'Include a number.');

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(128),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().max(30).nullish(),
  branch: z.string().trim().max(100).nullish(),
});

export const preferencesSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).optional(),
  dailyDigest: z.boolean().optional(),
  reservationReleased: z.boolean().optional(),
});

export const createUserSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email(),
  roleId: z.number().int().positive(),
});

export const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  roleId: z.number().int().positive().optional(),
  isActive: z.boolean().optional(),
  phone: z.string().trim().max(30).nullish(),
  branch: z.string().trim().max(100).nullish(),
});

export const createRoleSchema = z.object({
  code: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{2,29}$/, 'Use 3-30 lowercase letters, numbers or underscores.'),
  name: z.string().trim().min(2).max(60),
  rank: z.number().int().min(1).max(99),
});

export const updateRoleSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  rank: z.number().int().min(1).max(100).optional(),
});

export const rolePermissionsSchema = z.object({ codes: z.array(z.string()).max(200) });

/* ---------- API shapes ---------- */
export interface RoleSummary { id: number; code: string; name: string; rank: number; isSystem: boolean; userCount?: number }
export interface MeResponse {
  user: {
    id: number; name: string; email: string; phone: string | null; branch: string | null;
    hasPhoto: boolean; theme: 'light' | 'dark' | 'system'; mustChangePassword: boolean;
    prefs: { dailyDigest: boolean; reservationReleased: boolean };
    role: RoleSummary;
  };
  permissions: string[];
}
export * from './receipts';

export const mailSettingsSchema = z.object({
  host: z.string().trim().min(1, 'Enter the mail server address.').max(255).regex(/^[A-Za-z0-9.-]+$/, 'The server address should look like smtp.gmail.com.'),
  port: z.coerce.number().int().min(1, 'Enter a port between 1 and 65535.').max(65535, 'Enter a port between 1 and 65535.'),
  secure: z.boolean(),
  user: z.string().trim().max(200).default(''),
  /** Leave out or empty to keep the saved password. */
  pass: z.string().max(500).optional(),
  fromName: z.string().trim().max(80).default(''),
  fromAddress: z.string().trim().toLowerCase().email('Enter the address emails are sent from.'),
  /** Test mode: when set, every email goes to this address instead of its real recipient. */
  testRedirect: z.union([z.literal(''), z.string().trim().toLowerCase().email('Enter a valid test address.')]).default(''),
});
export type MailSettingsInput = z.infer<typeof mailSettingsSchema>;

export interface MailSettingsView {
  source: 'database' | 'environment' | 'none';
  host: string; port: number; secure: boolean; user: string; hasPassword: boolean; fromName: string; fromAddress: string; testRedirect: string;
}
