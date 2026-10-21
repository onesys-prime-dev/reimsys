import { z } from 'zod';

const num = (min: number, max: number, label: string) =>
  z.coerce.number({ invalid_type_error: `${label} must be a number.` }).min(min, `${label} cannot be below ${min}.`).max(max, `${label} cannot be above ${max}.`);

/**
 * Things an administrator may adjust without a code change. Every value has a safe default, and a bad value is refused
 * rather than saved, so a typo cannot lock people out.
 */
export const appSettingsSchema = z.object({
  /* the reimbursement form: rules */
  vatRate: num(0, 30, 'The VAT rate'),
  tolerance: num(0, 5, 'The tolerance'),
  warningsBlock: z.boolean(),
  allowNoBir: z.boolean(),
  /* the reimbursement form: questions */
  requireInvoiceNo: z.boolean(),
  requireVendorAddress: z.boolean(),
  requireVendorTin: z.boolean(),
  askWithholding: z.boolean(),
  showDescription: z.boolean(),
  /* limits */
  evidenceMaxFiles: num(1, 10, 'Files per receipt').transform(Math.round),
  evidenceMaxMb: num(1, 10, 'File size').transform(Math.round),
  undoMinutes: num(1, 120, 'The undo window').transform(Math.round),
  /* reminders for receipts that have waited too long (0 = off) */
  reminderCheckDays: num(0, 60, 'The check reminder').transform(Math.round),
  reminderDecideDays: num(0, 60, 'The decision reminder').transform(Math.round),
  reminderPayDays: num(0, 60, 'The payment reminder').transform(Math.round),
  reminderFixDays: num(0, 60, 'The correction reminder').transform(Math.round),
  /* sessions (people already signed in keep the limits they signed in with, except the idle limit, which applies at once) */
  sessionIdleMinutes: num(5, 1440, 'The idle limit').transform(Math.round),
  sessionMaxHours: num(1, 168, 'The maximum session').transform(Math.round),
  /* privacy notice: the two blanks in the wording, and the version (raising it makes everyone accept again) */
  privacyRetention: z.string().trim().max(200, 'The retention period is too long (200 characters at most).'),
  privacyContact: z.string().trim().max(300, 'The contact is too long (300 characters at most).'),
  privacyVersion: num(1, 999, 'The notice version').transform(Math.round),
});
export type AppSettings = z.infer<typeof appSettingsSchema>;

export const DEFAULT_SETTINGS: AppSettings = {
  vatRate: 12, tolerance: 0.02, warningsBlock: false, allowNoBir: true,
  requireInvoiceNo: true, requireVendorAddress: true, requireVendorTin: true, askWithholding: true, showDescription: true,
  evidenceMaxFiles: 10, evidenceMaxMb: 10, undoMinutes: 10, reminderCheckDays: 2, reminderDecideDays: 2, reminderPayDays: 3, reminderFixDays: 5, sessionIdleMinutes: 60, sessionMaxHours: 12,
  privacyRetention: '', privacyContact: '', privacyVersion: 1,
};

/** Plain-words description of each setting, in the order they are shown. Used by the Settings screen and the audit log. */
export const SETTINGS_SECTIONS: { title: string; help: string; items: { key: keyof AppSettings; label: string; help: string; kind: 'bool' | 'number' | 'text'; unit?: string; step?: number }[] }[] = [
  {
    title: 'Reimbursement form: checks',
    help: 'How strict the form is about the numbers.',
    items: [
      { key: 'vatRate', label: 'VAT rate', help: 'Used to check that the VAT amount is the right share of the vatable amount.', kind: 'number', unit: '%', step: 0.5 },
      { key: 'tolerance', label: 'Rounding tolerance', help: 'Numbers that differ by no more than this are treated as equal.', kind: 'number', unit: 'PHP', step: 0.01 },
      { key: 'warningsBlock', label: 'Stop submitting when the numbers do not add up', help: 'Off: the Med Ref sees a warning and can still submit. On: they must fix it first.', kind: 'bool' },
      { key: 'allowNoBir', label: 'Accept receipts without a BIR-registered invoice', help: 'Off: the "No" answer is not offered.', kind: 'bool' },
    ],
  },
  {
    title: 'Reimbursement form: questions',
    help: 'Which answers are needed when there is a BIR invoice.',
    items: [
      { key: 'requireInvoiceNo', label: 'Invoice number is required', help: '', kind: 'bool' },
      { key: 'requireVendorAddress', label: 'Vendor address is required', help: '', kind: 'bool' },
      { key: 'requireVendorTin', label: 'Vendor TIN is required', help: '', kind: 'bool' },
      { key: 'askWithholding', label: 'Ask about withholding tax', help: 'Off: the withholding question and step are left out and treated as "No".', kind: 'bool' },
      { key: 'showDescription', label: 'Show the optional description box', help: '', kind: 'bool' },
    ],
  },
  {
    title: 'Evidence and decisions',
    help: 'Limits for photos and PDFs, and how long a decision can be taken back.',
    items: [
      { key: 'evidenceMaxFiles', label: 'Files per receipt', help: 'Up to 10.', kind: 'number', unit: 'files', step: 1 },
      { key: 'evidenceMaxMb', label: 'Largest file', help: 'Up to 10.', kind: 'number', unit: 'MB', step: 1 },
      { key: 'undoMinutes', label: 'Time to take back an approval or disapproval', help: '', kind: 'number', unit: 'minutes', step: 1 },
    ],
  },
  {
    title: 'Reminders',
    help: 'A receipt that waits longer than this gets a reminder (a notice and one email a day per person). Set 0 to switch a reminder off.',
    items: [
      { key: 'reminderCheckDays', label: 'Waiting to be checked', help: 'Reminds the Checkers.', kind: 'number', unit: 'days', step: 1 },
      { key: 'reminderDecideDays', label: 'Waiting for a decision', help: 'Reminds the Approvers.', kind: 'number', unit: 'days', step: 1 },
      { key: 'reminderPayDays', label: 'Approved and waiting to be paid', help: 'Reminds Accounting.', kind: 'number', unit: 'days', step: 1 },
      { key: 'reminderFixDays', label: 'Returned and not corrected', help: 'Reminds the Med Ref who sent it.', kind: 'number', unit: 'days', step: 1 },
    ],
  },
  {
    title: 'Sign-in sessions',
    help: 'Active people are never signed out while they work. These limits protect an unattended screen.',
    items: [
      { key: 'sessionIdleMinutes', label: 'Sign out after no activity for', help: 'Applies to everyone straight away.', kind: 'number', unit: 'minutes', step: 5 },
      { key: 'sessionMaxHours', label: 'Longest a sign-in may last', help: 'Applies to new sign-ins.', kind: 'number', unit: 'hours', step: 1 },
    ],
  },
  {
    title: 'Privacy notice',
    help: 'Fills the two blanks in the notice people read when they sign in. Leave a box empty to show "To be confirmed".',
    items: [
      { key: 'privacyRetention', label: 'How long records are kept', help: 'For example: Receipts and their files are kept for 10 years.', kind: 'text' },
      { key: 'privacyContact', label: 'Data protection contact', help: 'Name, email and phone of the person people can ask.', kind: 'text' },
      { key: 'privacyVersion', label: 'Notice version', help: 'Raise this after changing the notice or these two boxes: everyone must then accept it again at their next action.', kind: 'number', unit: 'version', step: 1 },
    ],
  },
];
