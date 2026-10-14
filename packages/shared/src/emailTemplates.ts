import { z } from 'zod';

/** Every email the system can send. */
export const TEMPLATE_KEYS = ['returned', 'approved', 'disapproved', 'reserved', 'released', 'reversed', 'digest', 'reset', 'invite', 'test'] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export interface EmailTemplate {
  subject: string;
  heading: string;
  /** Plain text. A blank line starts a new paragraph. A line starting with "> " becomes a highlighted note box. */
  body: string;
  /** Text on the button. Leave empty for no button. */
  buttonLabel: string;
  /** Add a small table with the receipt's details under the message. */
  showDetails: boolean;
}

export interface PlaceholderDef { key: string; label: string; example: string }

/** Things that can be dropped into a template as {{name}}. */
export const PLACEHOLDERS: PlaceholderDef[] = [
  { key: 'recipientName', label: 'Name of the person receiving the email', example: 'Ana' },
  { key: 'actorName', label: 'Person who made the change', example: 'Paolo Villanueva' },
  { key: 'refNo', label: 'Receipt number', example: 'RC-2026-000123' },
  { key: 'payee', label: 'Who was paid', example: 'Mercury Drug - Mandaue' },
  { key: 'amount', label: 'Amount', example: 'PHP 1,284.50' },
  { key: 'category', label: 'Category', example: 'Medicine' },
  { key: 'date', label: 'Receipt date', example: 'Oct 12, 2026' },
  { key: 'status', label: 'Status of the receipt', example: 'Approved' },
  { key: 'note', label: 'Reason or note that was written', example: 'The receipt photo is blurry.' },
  { key: 'docNo', label: 'Reimbursement document number', example: 'REIM-2026-000045' },
  { key: 'summary', label: 'List of what is waiting (daily summary only)', example: '2 receipts waiting to be checked.' },
  { key: 'orgName', label: 'Your organisation name', example: 'Your Organisation' },
  { key: 'minutes', label: 'How long a reset link works, in minutes', example: '60' },
  { key: 'hours', label: 'How long an invitation link works, in hours', example: '72' },
];

const RECEIPT_VARS = ['recipientName', 'actorName', 'refNo', 'payee', 'amount', 'category', 'date', 'status', 'note', 'orgName'];

export interface TemplateMeta {
  label: string;
  /** When the email goes out. */
  when: string;
  /** Who gets it. */
  to: string;
  /** Placeholders that make sense in this email. */
  allowed: string[];
  /** Whether the receipt details table makes sense here. */
  hasReceipt: boolean;
}

export const TEMPLATE_META: Record<TemplateKey, TemplateMeta> = {
  returned: { label: 'Receipt returned for correction', when: 'A checker sends a receipt back', to: 'The Med Ref who encoded it', allowed: RECEIPT_VARS, hasReceipt: true },
  approved: { label: 'Receipt approved', when: 'An approver approves a receipt', to: 'The Med Ref and the checker', allowed: [...RECEIPT_VARS, 'docNo'], hasReceipt: true },
  disapproved: { label: 'Receipt disapproved', when: 'An approver disapproves a receipt', to: 'The Med Ref and the checker', allowed: RECEIPT_VARS, hasReceipt: true },
  reserved: { label: 'Receipt put on hold', when: 'An approver puts a receipt on hold', to: 'The Med Ref and the checker', allowed: RECEIPT_VARS, hasReceipt: true },
  released: { label: 'Hold released', when: 'An approver releases a hold', to: 'The Med Ref, if they turned this on in their profile', allowed: RECEIPT_VARS, hasReceipt: true },
  reversed: { label: 'Decision reversed', when: 'An approver undoes an approval or disapproval within ten minutes', to: 'The Med Ref and the checker', allowed: RECEIPT_VARS, hasReceipt: true },
  digest: { label: 'Daily summary', when: 'About 8am, only if something is waiting', to: 'Anyone who has the summary turned on', allowed: ['recipientName', 'summary', 'orgName'], hasReceipt: false },
  reset: { label: 'Forgot password', when: 'Someone asks to reset their password on the sign-in page', to: 'The person who asked', allowed: ['recipientName', 'orgName', 'minutes'], hasReceipt: false },
  invite: { label: 'Invitation to a new user', when: 'An administrator creates a new user', to: 'The new user', allowed: ['recipientName', 'actorName', 'orgName', 'hours'], hasReceipt: false },
  test: { label: 'Test email', when: 'An administrator presses "Send test email"', to: 'The address the administrator typed', allowed: ['actorName', 'orgName'], hasReceipt: false },
};

export const DEFAULT_TEMPLATES: Record<TemplateKey, EmailTemplate> = {
  returned: {
    subject: '{{refNo}} needs a correction',
    heading: 'Please correct this receipt',
    body: 'Hi {{recipientName}},\n\n{{actorName}} sent {{refNo}} ({{payee}}) back to you.\n\nWhat needs to be fixed:\n> {{note}}\n\nOpen the receipt, make the change and submit it again.',
    buttonLabel: 'Open the receipt',
    showDetails: true,
  },
  approved: {
    subject: '{{refNo}} was approved',
    heading: 'Receipt approved',
    body: 'Hi {{recipientName}},\n\n{{actorName}} approved {{refNo}} ({{payee}}). Reimbursement document {{docNo}} has been created.\n> {{note}}',
    buttonLabel: 'View the document',
    showDetails: true,
  },
  disapproved: {
    subject: '{{refNo}} was disapproved',
    heading: 'Receipt disapproved',
    body: 'Hi {{recipientName}},\n\n{{actorName}} disapproved {{refNo}} ({{payee}}).\n\nReason:\n> {{note}}\n\nYou can copy it into a new draft if you need to resubmit.',
    buttonLabel: 'Open the receipt',
    showDetails: true,
  },
  reserved: {
    subject: '{{refNo}} is on hold',
    heading: 'Receipt on hold',
    body: 'Hi {{recipientName}},\n\n{{actorName}} put {{refNo}} ({{payee}}) on hold. No action is needed from you right now.\n\nNote:\n> {{note}}',
    buttonLabel: 'Open the receipt',
    showDetails: true,
  },
  released: {
    subject: 'Hold released on {{refNo}}',
    heading: 'The hold was lifted',
    body: 'Hi {{recipientName}},\n\n{{actorName}} released the hold on {{refNo}} ({{payee}}). It is back in review.\n> {{note}}',
    buttonLabel: 'Open the receipt',
    showDetails: true,
  },
  reversed: {
    subject: 'Correction: the decision on {{refNo}} was reversed',
    heading: 'Please disregard the earlier decision',
    body: 'Hi {{recipientName}},\n\n{{actorName}} reversed the earlier decision on {{refNo}} ({{payee}}). It is back with the approver and a new decision is coming.\n\nReason:\n> {{note}}',
    buttonLabel: 'Open the receipt',
    showDetails: true,
  },
  digest: {
    subject: '{{orgName}}: your daily summary',
    heading: 'Good morning, {{recipientName}}',
    body: "Here is what is waiting for you today:\n\n{{summary}}",
    buttonLabel: 'Open {{orgName}}',
    showDetails: false,
  },
  reset: {
    subject: '{{orgName}}: choose a new password',
    heading: 'Choose a new password',
    body: 'Hi {{recipientName}},\n\nWe received a request to reset your {{orgName}} password. Use the button below within {{minutes}} minutes.\n\nIf you did not ask for this, ignore this email. Your password stays the same.',
    buttonLabel: 'Choose a new password',
    showDetails: false,
  },
  invite: {
    subject: 'Welcome to {{orgName}}',
    heading: 'Your {{orgName}} account is ready',
    body: 'Hi {{recipientName}},\n\n{{actorName}} created an account for you. Use the button below to choose your password and sign in. The link works for {{hours}} hours.',
    buttonLabel: 'Choose my password',
    showDetails: false,
  },
  test: {
    subject: '{{orgName}}: test email',
    heading: 'Email is working',
    body: 'This is a test message from {{orgName}}, sent by {{actorName}}.\n\nIf you can read this, receipt updates will reach you.',
    buttonLabel: 'Open {{orgName}}',
    showDetails: false,
  },
};

/** Sample values for previews and test sends. */
export const SAMPLE_DATA: Record<string, string> = Object.fromEntries(PLACEHOLDERS.map((p) => [p.key, p.example]));

/** Each email is previewed with details that make sense for it, so a "returned" sample never shows an approval. */
const SAMPLE_OVERRIDES: Partial<Record<TemplateKey, Record<string, string>>> = {
  returned: { actorName: 'Liza Santos', status: 'Returned', note: 'The receipt photo is blurry. Please upload a clear copy.', docNo: '' },
  approved: { actorName: 'Paolo Villanueva', status: 'Approved', note: 'Approved.', docNo: 'REIM-2026-000045' },
  disapproved: { actorName: 'Paolo Villanueva', status: 'Disapproved', note: 'Snacks are not reimbursable under the current policy.', docNo: '' },
  reserved: { actorName: 'Paolo Villanueva', status: 'Reserved', note: 'Waiting for the regional office to confirm the room rate.', docNo: '' },
  released: { actorName: 'Paolo Villanueva', status: 'Checked', note: 'Rate confirmed.', docNo: '' },
  reversed: { actorName: 'Paolo Villanueva', status: 'Checked', note: 'Approved by mistake. Re-checking the amount.', docNo: '' },
  reset: { recipientName: 'Ana', minutes: '60' },
  invite: { recipientName: 'Ana', actorName: 'Admin User', hours: '72' },
  digest: { summary: '• 2 receipts waiting to be checked.\n• 1 draft not submitted yet.' },
  test: { actorName: 'Admin User' },
};
export const sampleFor = (key: TemplateKey): Record<string, string> => ({ ...SAMPLE_DATA, ...SAMPLE_OVERRIDES[key] });

const PLACEHOLDER_RE = /\{\{\s*([A-Za-z][A-Za-z0-9]*)\s*\}\}/g;

export function placeholdersIn(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER_RE)].map((m) => m[1]!);
}

/** Placeholders written in a template that this email does not know about. They would come out empty, so they are flagged. */
export function unknownPlaceholders(t: Pick<EmailTemplate, 'subject' | 'heading' | 'body' | 'buttonLabel'>, key: TemplateKey): string[] {
  const allowed = new Set(TEMPLATE_META[key].allowed);
  const used = [t.subject, t.heading, t.body, t.buttonLabel].flatMap(placeholdersIn);
  return [...new Set(used.filter((k) => !allowed.has(k)))];
}

/** Replaces {{name}} with its value. A missing value becomes empty text, never the raw {{name}}. */
export function fillPlaceholders(text: string, data: Record<string, string | undefined>): string {
  return text.replace(PLACEHOLDER_RE, (_m, k: string) => data[k] ?? '');
}

export const emailTemplateSchema = z.object({
  subject: z.string().trim().min(1, 'The subject cannot be empty.').max(150, 'Keep the subject under 150 characters.'),
  heading: z.string().trim().min(1, 'The heading cannot be empty.').max(100, 'Keep the heading under 100 characters.'),
  body: z.string().trim().min(1, 'The message cannot be empty.').max(2000, 'Keep the message under 2000 characters.'),
  buttonLabel: z.string().trim().max(40, 'Keep the button text under 40 characters.'),
  showDetails: z.boolean(),
});

export const emailBrandingSchema = z.object({
  orgName: z.string().trim().min(1, 'Enter your organisation name.').max(60),
  footer: z.string().trim().max(300, 'Keep the footer under 300 characters.'),
  accent: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #0c7480.'),
});
export type EmailBranding = z.infer<typeof emailBrandingSchema>;
export const DEFAULT_BRANDING_ACCENT = '#0c7480';

export interface TemplateView {
  key: TemplateKey;
  label: string; when: string; to: string; allowed: string[]; hasReceipt: boolean;
  template: EmailTemplate;
  defaults: EmailTemplate;
  isCustom: boolean;
}
