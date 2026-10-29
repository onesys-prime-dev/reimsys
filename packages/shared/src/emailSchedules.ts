import { z } from 'zod';
import { isTimeOfDay, isTimeZone, localParts, parseDays } from './emailSchedule';
import { REMINDER_LABEL, type ReminderStage } from './reminders';

/** Your own reminder emails: who gets a list of the receipts waiting, how often, and during which hours. */

export const MIN_INTERVAL_MINUTES = 30;
/** The choices offered for "how often". 1440 means once a day. */
export const INTERVAL_CHOICES: { minutes: number; label: string }[] = [
  { minutes: 30, label: 'Every 30 minutes' }, { minutes: 60, label: 'Every hour' }, { minutes: 120, label: 'Every 2 hours' }, { minutes: 180, label: 'Every 3 hours' },
  { minutes: 240, label: 'Every 4 hours' }, { minutes: 360, label: 'Every 6 hours' }, { minutes: 720, label: 'Every 12 hours' }, { minutes: 1440, label: 'Once a day' },
];
export const SCHEDULE_STEPS = ['check', 'decide', 'pay', 'fix'] as const;
const parseSteps = (v: string) => { const p = v.split(',').filter(Boolean); return p.length && p.every((x) => (SCHEDULE_STEPS as readonly string[]).includes(x)) && new Set(p).size === p.length ? p : null; };
export const stepsOf = (v: string) => (parseSteps(v) ?? []) as ReminderStage[];

const ids = z.array(z.number().int().positive()).max(200);

export const emailScheduleSchema = z.object({
  name: z.string().trim().min(2, 'Give the schedule a name.').max(80, 'The name is too long (80 characters at most).'),
  isOn: z.boolean().default(true),
  steps: z.array(z.enum(SCHEDULE_STEPS)).min(1, 'Choose at least one step to list.').transform((a) => SCHEDULE_STEPS.filter((s) => a.includes(s)).join(',')),
  minDays: z.coerce.number({ error: 'The minimum wait must be a number.' }).min(0, 'The minimum wait cannot be below 0.').max(60, 'The minimum wait cannot be above 60 days.'),
  roleIds: ids.default([]),
  userIds: ids.default([]),
  intervalMinutes: z.coerce.number().int().refine((n) => INTERVAL_CHOICES.some((c) => c.minutes === n), `Choose how often: at least ${MIN_INTERVAL_MINUTES} minutes.`),
  startTime: z.string().trim().refine(isTimeOfDay, 'Use a time like 08:00.'),
  endTime: z.string().trim().refine(isTimeOfDay, 'Use a time like 18:00.'),
  days: z.array(z.number().int().min(0).max(6)).min(1, 'Choose at least one day.').transform((a) => [...new Set(a)].sort((x, y) => x - y).join(',')),
  timeZone: z.string().trim().refine(isTimeZone, 'That is not a time zone. Use a name like Asia/Manila.'),
}).superRefine((v, ctx) => {
  if (!v.roleIds.length && !v.userIds.length) ctx.addIssue({ code: 'custom', path: ['userIds'], message: 'Choose who gets it: at least one role or one person.' });
  if (isTimeOfDay(v.startTime) && isTimeOfDay(v.endTime) && v.endTime <= v.startTime) ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'The end time must be after the start time.' });
});
export type EmailScheduleInput = z.input<typeof emailScheduleSchema>;

export interface DueRules { isOn: boolean; intervalMinutes: number; startTime: string; endTime: string; days: string; timeZone: string; lastSentAt: Date | null }

/** Is this schedule due now? Inside its hours on a chosen day, and the interval has passed since the last send (once a day: not yet sent today). */
export function scheduleIsDue(now: Date, r: DueRules): boolean {
  if (!r.isOn) return false;
  const days = parseDays(r.days);
  const at = localParts(now, r.timeZone);
  if (!days || !days.includes(at.weekday)) return false;
  const [sh, sm] = r.startTime.split(':').map(Number), [eh, em] = r.endTime.split(':').map(Number);
  if (at.minutes < sh! * 60 + sm! || at.minutes > eh! * 60 + em!) return false;
  if (!r.lastSentAt) return true;
  if (r.intervalMinutes >= 1440) return localParts(r.lastSentAt, r.timeZone).date !== at.date;
  // A little slack so a send that ran a few seconds late never makes the next one wait a whole extra tick.
  return now.getTime() - r.lastSentAt.getTime() >= r.intervalMinutes * 60_000 - 30_000;
}

export const intervalLabel = (m: number) => INTERVAL_CHOICES.find((c) => c.minutes === m)?.label ?? `Every ${m} minutes`;

/** One line for the list: what it does in plain words. */
export function describeEmailSchedule(s: { steps: string; minDays: number; intervalMinutes: number; startTime: string; endTime: string; days: string; timeZone: string }): string {
  const what = stepsOf(s.steps).map((x) => REMINDER_LABEL[x]).join(', ') || 'nothing chosen';
  const d = parseDays(s.days) ?? [];
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayText = d.length === 7 ? 'every day' : d.join(',') === '1,2,3,4,5' ? 'Mon to Fri' : d.join(',') === '1,2,3,4,5,6' ? 'Mon to Sat' : d.map((x) => names[x]).join(', ');
  const wait = s.minDays > 0 ? `, only receipts that have waited ${s.minDays} day${s.minDays === 1 ? '' : 's'} or more` : '';
  return `Lists receipts ${what}${wait}. ${intervalLabel(s.intervalMinutes)}, ${s.startTime} to ${s.endTime}, ${dayText} (${s.timeZone}).`;
}
