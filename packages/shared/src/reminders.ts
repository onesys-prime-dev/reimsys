/** Reminders for receipts that have waited too long. The days are settings; 0 switches that reminder off. */
export type ReminderStage = 'check' | 'decide' | 'pay' | 'fix';

export interface ReminderRules {
  reminderCheckDays: number;
  reminderDecideDays: number;
  reminderPayDays: number;
  reminderFixDays: number;
}

/** What a receipt in this status is waiting for, or null when nobody is expected to act on it. */
export function reminderStage(status: string): ReminderStage | null {
  switch (status) {
    case 'submitted': return 'check';
    case 'checked': return 'decide';
    case 'approved': return 'pay';
    case 'returned': return 'fix';
    default: return null;
  }
}

const RULE_FOR: Record<ReminderStage, keyof ReminderRules> = {
  check: 'reminderCheckDays', decide: 'reminderDecideDays', pay: 'reminderPayDays', fix: 'reminderFixDays',
};

/** The stage to remind about, when a receipt in this status has waited `ageDays` and that reminder is on. */
export function whoToRemind(status: string, ageDays: number, rules: ReminderRules): ReminderStage | null {
  const stage = reminderStage(status);
  if (!stage) return null;
  const limit = rules[RULE_FOR[stage]];
  return limit > 0 && ageDays >= limit ? stage : null;
}

/** How each waiting stage reads in a reminder line, e.g. "waiting to be checked for 3 days". */
export const REMINDER_LABEL: Record<ReminderStage, string> = {
  check: 'waiting to be checked',
  decide: 'waiting for a decision',
  pay: 'approved and waiting to be paid',
  fix: 'returned and waiting for a correction',
};

/** The right needed for each stage: who gets the reminder. `fix` goes to the person who encoded the receipt. */
export const REMINDER_PERMISSION: Record<Exclude<ReminderStage, 'fix'>, string> = {
  check: 'review.check', decide: 'review.decide', pay: 'payment.mark',
};
