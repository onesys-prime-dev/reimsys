import { z } from 'zod';

/* ---------- roles ---------- */
export const ROLE_CODES = ['medref', 'checker', 'approver', 'accounting', 'manager', 'admin'] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

export const DEFAULT_ROLES: { code: RoleCode; name: string; rank: number }[] = [
  { code: 'medref', name: 'Med Ref', rank: 10 },
  { code: 'checker', name: 'Checker', rank: 20 },
  { code: 'approver', name: 'Approver', rank: 30 },
  { code: 'accounting', name: 'Accounting', rank: 25 },
  // The everyday administrator: looks after people and settings and sees everything, but cannot change roles, check, approve or pay.
  { code: 'manager', name: 'Admin', rank: 90 },
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
  { code: 'payment.mark', label: 'Mark approved receipts as paid', group: 'Payments' },
  { code: 'report.generate', label: 'Generate liquidation reports', group: 'Reports' },
  { code: 'user.manage', label: 'Manage users', group: 'Administration' },
  { code: 'role.manage', label: 'Manage roles and permissions', group: 'Administration' },
  { code: 'audit.view', label: 'Browse the audit log', group: 'Administration' },
  { code: 'category.manage', label: 'Manage receipt categories', group: 'Administration' },
  { code: 'settings.manage', label: 'Manage email and system settings', group: 'Administration' },
  { code: 'reminder.overview', label: 'Get a reminder email of every receipt waiting at any step', group: 'Administration' },
];
export type PermissionCode = (typeof PERMISSIONS)[number]['code'];

const ALL: RoleCode[] = ['medref', 'checker', 'approver', 'accounting', 'manager', 'admin'];
export const DEFAULT_GRANTS: Record<string, RoleCode[]> = {
  'receipt.create': ['medref'],
  'receipt.view_all': ['checker', 'manager', 'admin'],
  'receipt.import': ['medref', 'admin'],
  'evidence.view': ALL,
  'evidence.download': ALL,
  'evidence.print': ALL,
  'review.check': ['checker'],
  'review.decide': ['approver'],
  'payment.mark': ['accounting'],
  'report.generate': ALL,
  'user.manage': ['manager', 'admin'],
  'role.manage': ['admin'],
  'audit.view': ['manager', 'admin'],
  'category.manage': ['manager', 'admin'],
  'settings.manage': ['manager', 'admin'],
  'reminder.overview': ['manager'],
};

/** Grants that can never be removed, so the system always has a review path and an administrator. */
export const LOCKED_GRANTS: { role: RoleCode; permission: string }[] = [
  { role: 'checker', permission: 'review.check' },
  { role: 'approver', permission: 'review.decide' },
  { role: 'accounting', permission: 'payment.mark' },
  { role: 'admin', permission: 'user.manage' },
  { role: 'admin', permission: 'role.manage' },
  { role: 'admin', permission: 'settings.manage' },
];
export const isLockedGrant = (role: string, permission: string) =>
  LOCKED_GRANTS.some((g) => g.role === role && g.permission === permission);


/* ---------- validation ---------- */
/** Passwords people pick first, which attackers try first. Matched ignoring case and ignoring a trailing number or symbol. */
const COMMON = new Set([
  'password', 'passw0rd', 'qwerty', 'qwertyuiop', 'letmein', 'welcome', 'iloveyou', 'admin', 'administrator', 'changeme', 'secret',
  'abc', 'abcdef', 'monkey', 'dragon', 'football', 'baseball', 'sunshine', 'princess', 'login', 'master', 'shadow', 'superman',
  'trustno', 'starwars', 'whatever', 'pharmacy', 'reimsys', 'reimsis', 'medref', 'checker', 'approver', 'filipino', 'manila', 'cebu',
]);
export const isCommonPassword = (p: string) => {
  const base = p.toLowerCase().replace(/[^a-z]+$/g, '').replace(/^[^a-z]+/g, '');
  const oneKey = (x: string) => x.length > 1 && /^(.)\1+$/.test(x); // "aaaaaaaaaa" and the like
  return COMMON.has(base) || oneKey(p) || oneKey(base) || /^(0123456789|1234567890|12345678910|123456789|987654321)/.test(p);
};

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(128, 'Use at most 128 characters.')
  .regex(/[A-Za-z]/, 'Include a letter.')
  .regex(/\d/, 'Include a number.')
  .refine((p) => !isCommonPassword(p), 'That password is too easy to guess. Choose something less common.');

export const forgotSchema = z.object({ email: z.string().trim().toLowerCase().email() });
export const resetSchema = z.object({ token: z.string().min(20).max(200), password: passwordSchema });

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
    hasPhoto: boolean; photoV: number | null; theme: 'light' | 'dark' | 'system'; mustChangePassword: boolean;
    /** True until the person accepts the current privacy notice (shown after the password step). */
    privacyRequired: boolean;
    prefs: { dailyDigest: boolean; reservationReleased: boolean };
    role: RoleSummary;
  };
  permissions: string[];
  /** Present when the answer comes from a signed-in request. Times are ISO strings. */
  session?: SessionInfo;
}
export interface SessionInfo {
  /** When the session ends if nothing happens. */
  expiresAt: string;
  /** The latest it can ever last until, however busy the person is. */
  maxAt: string;
  idleMinutes: number;
  /** The server's clock, so the screen can allow for a wrong clock on the device. */
  serverNow: string;
}
export * from './receipts';
export * from './payments';
export * from './returnIssues';
export * from './privacy';
export * from './text';
export * from './reminders';
export * from './settings';
export * from './tax';

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
  /** A password is saved but this server cannot unlock it (the key it was locked with is missing). */
  passwordUnreadable?: boolean;
}
export * from './emailTemplates';
export * from './brand';
