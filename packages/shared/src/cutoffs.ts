import { z } from 'zod';
import { BATCH_MAX, batchCreateSchema } from './batches';
import { WEEKDAYS, isTimeOfDay, isTimeZone } from './emailSchedule';
import type { ReceiptStatus } from './receipts';

/**
 * Cutoffs: a batch can carry a time at which it fills itself with the receipts that match its rule and closes. A repeating
 * schedule ("every Friday at 5:00 PM") only makes the next such batch. See "Batch cutoffs" in docs/PLAN.md.
 */

/* ---------- the fill rule ---------- */

export const CUTOFF_STATUS_CHOICES = ['approved', 'in_progress'] as const;
export type CutoffStatusChoice = (typeof CUTOFF_STATUS_CHOICES)[number];
/** Returned and reserved receipts are never pulled in: they wait on the Med Ref or are on hold on purpose. */
export const CUTOFF_STATUSES: Record<CutoffStatusChoice, readonly ReceiptStatus[]> = { approved: ['approved'], in_progress: ['submitted', 'checked', 'approved'] };
export const CUTOFF_DATE_CHOICES = ['approved', 'submitted', 'receipt'] as const;
export type CutoffDateChoice = (typeof CUTOFF_DATE_CHOICES)[number];
export const CUTOFF_STATUS_LABEL: Record<CutoffStatusChoice, string> = { approved: 'Approved receipts only', in_progress: 'Anything in progress (submitted, checked or approved)' };
export const CUTOFF_DATE_LABEL: Record<CutoffDateChoice, string> = { approved: 'Approved before the cutoff', submitted: 'Submitted before the cutoff', receipt: 'Dated on or before the cutoff day' };
export const LATE_NOTE_MAX = 300;
export const SCHEDULE_NAME_MAX = 60;
/** A run that started more than this long ago without finishing is taken over by the next tick. */
export const CUTOFF_CLAIM_MS = 10 * 60_000;

const idList = (max: number) => z.array(z.number().int().positive().max(2_147_483_647)).max(max).default([]).transform((a) => [...new Set(a)].sort((x, y) => x - y));

export const cutoffRuleSchema = z.object({
  statuses: z.enum(CUTOFF_STATUS_CHOICES, { error: 'Choose which receipts to take.' }),
  date: z.enum(CUTOFF_DATE_CHOICES).optional(),
  chargeLocationIds: idList(200),
  encoderIds: idList(500),
}).transform((r) => ({ ...r, date: r.date ?? (r.statuses === 'approved' ? 'approved' : 'submitted') }) as CutoffRule)
  .refine((r) => !(r.statuses === 'in_progress' && r.date === 'approved'), { message: 'Receipts that are not approved yet have no approval date. Choose the submitted date or the receipt date.', path: ['date'] });
export interface CutoffRule { statuses: CutoffStatusChoice; date: CutoffDateChoice; chargeLocationIds: number[]; encoderIds: number[] }
export type CutoffRuleInput = z.input<typeof cutoffRuleSchema>;

/** The stored rule, or null when there is none or it no longer reads (a damaged value never breaks a screen or the worker). */
export function parseCutoffRule(v: string | null | undefined): CutoffRule | null {
  if (!v) return null;
  try { const r = cutoffRuleSchema.safeParse(JSON.parse(v)); return r.success ? r.data : null; } catch { return null; }
}

/** "Anything in progress" fills a batch with receipts at steps only people who see every receipt can see. */
export const canUseCutoffRule = (perms: ReadonlySet<string>, rule: Pick<CutoffRule, 'statuses'>) => rule.statuses === 'approved' || perms.has('receipt.view_all');

/* ---------- schedules ---------- */

export const SCHEDULE_REPEATS = ['weekly', 'monthly'] as const;
export type ScheduleRepeat = (typeof SCHEDULE_REPEATS)[number];
/** Month days 1 to 31, and L for the last day of the month. */
export type MonthDay = number | 'L';

/** "5" or "1,5" for weekly (0 = Sunday), "15,L" for monthly. Null when it does not read. */
export function parseScheduleDays(repeat: string, v: string): MonthDay[] | null {
  const parts = v.split(',').map((x) => x.trim()).filter(Boolean);
  if (!parts.length || new Set(parts).size !== parts.length) return null;
  if (repeat === 'weekly') return parts.every((p) => /^[0-6]$/.test(p)) ? parts.map(Number).sort((a, b) => a - b) : null;
  if (repeat === 'monthly') {
    if (!parts.every((p) => p === 'L' || (/^\d{1,2}$/.test(p) && Number(p) >= 1 && Number(p) <= 31))) return null;
    const nums = parts.filter((p) => p !== 'L').map(Number).sort((a, b) => a - b);
    return parts.includes('L') ? [...nums, 'L'] : nums;
  }
  return null;
}

const daysField = z.array(z.union([z.number().int(), z.literal('L')])).min(1, 'Choose at least one day.').max(32);

export const batchScheduleSchema = z.object({
  name: z.string().trim().min(2, 'Give the schedule a name.').max(SCHEDULE_NAME_MAX, `Keep the name to ${SCHEDULE_NAME_MAX} characters.`),
  isOn: z.boolean().default(true),
  repeat: z.enum(SCHEDULE_REPEATS, { error: 'Choose weekly or monthly.' }),
  days: daysField,
  time: z.string().trim().refine(isTimeOfDay, 'Use a time like 17:00.'),
  timeZone: z.string().trim().max(60).refine(isTimeZone, 'That is not a time zone. Use a name like Asia/Manila.'),
  rule: cutoffRuleSchema,
}).transform((v, ctx) => {
  const days = parseScheduleDays(v.repeat, v.days.map(String).join(','));
  if (!days) { ctx.addIssue({ code: 'custom', path: ['days'], message: v.repeat === 'weekly' ? 'Choose days of the week.' : 'Choose days of the month (1 to 31, or the last day).' }); return z.NEVER; }
  return { ...v, days: days.join(',') };
});
export type BatchScheduleInput = z.input<typeof batchScheduleSchema>;
/** What to do when a change puts this run's cutoff in the past: run it within the minute, or skip to the next one. */
export const PAST_CHOICES = ['run', 'skip'] as const;
export const batchScheduleUpdateSchema = z.object({ isOn: z.boolean().optional(), whenPast: z.enum(PAST_CHOICES).optional() });

/* ---------- time ---------- */

const PARTS = (timeZone: string) => new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
/** How far the time zone is ahead of UTC at that instant, in milliseconds. */
function offsetAt(t: number, timeZone: string) {
  const p = Object.fromEntries(PARTS(timeZone).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return asUtc - Math.floor(t / 1000) * 1000;
}
/** The instant when the clock in the time zone shows that date and minute. Checked twice, so a daylight-saving change on that day cannot shift it. */
export function zonedTime(y: number, m: number, d: number, minutes: number, timeZone: string): Date {
  const guess = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  const first = guess - offsetAt(guess, timeZone);
  const second = guess - offsetAt(first, timeZone);
  return new Date(second);
}
/** The calendar date (year, month, day) and weekday in the time zone. */
export function zonedDate(t: Date, timeZone: string) {
  const p = Object.fromEntries(PARTS(timeZone).formatToParts(t).map((x) => [x.type, x.value]));
  const y = Number(p.year), m = Number(p.month), d = Number(p.day);
  return { y, m, d, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay(), iso: `${p.year}-${p.month}-${p.day}` };
}
const lastDayOf = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Does the schedule run on this calendar date? Days past the end of a shorter month mean its last day. */
function runsOn(repeat: string, days: MonthDay[], y: number, m: number, d: number) {
  if (repeat === 'weekly') return days.includes(new Date(Date.UTC(y, m - 1, d)).getUTCDay());
  const last = lastDayOf(y, m);
  if (days.includes(d)) return true;
  return d === last && days.some((x) => x === 'L' || (typeof x === 'number' && x > last));
}

export interface ScheduleTiming { repeat: string; days: string; time: string; timeZone: string }

/** The first cutoff of the schedule strictly after `after`. Null when the schedule does not read or never comes round (cannot happen with valid days). */
export function nextCutoff(s: ScheduleTiming, after: Date): Date | null {
  const days = parseScheduleDays(s.repeat, s.days);
  if (!days || !isTimeOfDay(s.time) || !isTimeZone(s.timeZone)) return null;
  const [h, mi] = s.time.split(':').map(Number);
  const start = zonedDate(after, s.timeZone);
  for (let i = 0; i < 400; i++) {
    const c = new Date(Date.UTC(start.y, start.m - 1, start.d + i));
    const y = c.getUTCFullYear(), m = c.getUTCMonth() + 1, d = c.getUTCDate();
    if (!runsOn(s.repeat, days, y, m, d)) continue;
    const t = zonedTime(y, m, d, h! * 60 + mi!, s.timeZone);
    if (t.getTime() > after.getTime()) return t;
  }
  return null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const clock12 = (minutes: number) => `${Math.floor(minutes / 60) % 12 || 12}:${String(minutes % 60).padStart(2, '0')} ${minutes < 720 ? 'AM' : 'PM'}`;
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
const list = (a: string[]) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);

/** "Fri 20 Nov, 5:00 PM" in the time zone. */
export function fmtCutoff(t: Date | string, timeZone: string) {
  const at = typeof t === 'string' ? new Date(t) : t;
  const z = zonedDate(at, timeZone);
  const p = Object.fromEntries(PARTS(timeZone).formatToParts(at).map((x) => [x.type, x.value]));
  return `${WEEKDAYS[z.weekday]} ${z.d} ${MONTHS[z.m - 1]}, ${clock12(Number(p.hour) * 60 + Number(p.minute))}`;
}
/** "20 Nov": the date part of a schedule's batch name. */
export const shortDate = (t: Date, timeZone: string) => { const z = zonedDate(t, timeZone); return `${z.d} ${MONTHS[z.m - 1]}`; };

/** "Every Friday at 5:00 PM (Asia/Manila)" / "On the 15th and the last day of every month at 5:00 PM (Asia/Manila)". */
export function describeScheduleTiming(s: ScheduleTiming) {
  const days = parseScheduleDays(s.repeat, s.days);
  if (!days || !isTimeOfDay(s.time)) return 'Choose the days and the time.';
  const [h, m] = s.time.split(':').map(Number);
  const at = `at ${clock12(h! * 60 + m!)} (${s.timeZone})`;
  if (s.repeat === 'weekly') {
    const d = days as number[];
    const names = d.join(',') === '1,2,3,4,5' ? ['weekday'] : d.length === 7 ? ['day'] : d.map((x) => DAY_NAMES[x]!);
    return `Every ${list(names)} ${at}`;
  }
  const names = days.map((x) => (x === 'L' ? 'the last day' : `the ${ordinal(x)}`));
  const long = days.some((x) => typeof x === 'number' && x > 28) ? ' (the last day in shorter months)' : '';
  return `On ${list(names)} of every month ${at}${long}`;
}

/** "Takes receipts approved before then, charged to Pasig, of Ana Reyes." */
export function describeCutoffRule(r: CutoffRule, names: { locations?: string[]; people?: string[] } = {}) {
  const what = r.statuses === 'approved' ? 'approved receipts' : 'receipts in progress (submitted, checked or approved)';
  const when = r.date === 'approved' ? 'approved before then' : r.date === 'submitted' ? 'submitted before then' : 'dated on or before that day';
  const where = r.chargeLocationIds.length ? `, charged to ${list(names.locations?.length ? names.locations : [`${r.chargeLocationIds.length} chosen place${r.chargeLocationIds.length === 1 ? '' : 's'}`])}` : '';
  const who = r.encoderIds.length ? `, from ${list(names.people?.length ? names.people : [`${r.encoderIds.length} chosen ${r.encoderIds.length === 1 ? 'person' : 'people'}`])}` : '';
  return `Takes ${what} ${when}${where}${who}, that are in no other batch.`;
}

/** "Weekly run Pasig · 20 Nov", "... (part 2)". Fits the 80 characters of a batch name. */
export const cutoffBatchName = (scheduleName: string, cutoffAt: Date, timeZone: string, part = 1) =>
  `${scheduleName.slice(0, SCHEDULE_NAME_MAX)} · ${shortDate(cutoffAt, timeZone)}${part > 1 ? ` (part ${part})` : ''}`.slice(0, 80);

/** Two switched-on schedules can take the same receipt when their places and people meet (empty means all). The earlier cutoff takes it. */
export function schedulesOverlap(a: Pick<CutoffRule, 'chargeLocationIds' | 'encoderIds'>, b: Pick<CutoffRule, 'chargeLocationIds' | 'encoderIds'>) {
  const meet = (x: number[], y: number[]) => !x.length || !y.length || x.some((v) => y.includes(v));
  return meet(a.chargeLocationIds, b.chargeLocationIds) && meet(a.encoderIds, b.encoderIds);
}

/* ---------- a batch's own cutoff ---------- */

/** Where a batch's cutoff stands. Cancelled: a schedule's batch closed by hand before its cutoff. */
export type CutoffState = 'none' | 'pending' | 'ran' | 'cancelled';
export function cutoffState(b: { cutoffAt: Date | string | null; cutoffDoneAt: Date | string | null }): CutoffState {
  if (b.cutoffAt && !b.cutoffDoneAt) return 'pending';
  if (b.cutoffAt && b.cutoffDoneAt) return 'ran';
  return b.cutoffDoneAt ? 'cancelled' : 'none';
}
/** Adding to a batch is late once it is closed or its cutoff has run, open or not, so reopening is no way around it. */
export const isLateBatch = (b: { closedAt: Date | string | null; cutoffAt: Date | string | null; cutoffDoneAt: Date | string | null }) => !!b.closedAt || cutoffState(b) === 'ran';

const instant = z.iso.datetime({ offset: true, error: 'Choose a date and time.' }).transform((v) => new Date(v));
/** Setting, moving or removing one batch's cutoff. `runNow` confirms a time that is already past. */
export const batchCutoffSchema = z.object({
  cutoffAt: instant.nullable(),
  cutoffRule: cutoffRuleSchema.optional(),
  runNow: z.boolean().optional(),
}).refine((v) => !(v.cutoffAt instanceof Date) || v.cutoffAt.getTime() < Date.now() + 400 * 86_400_000, { message: 'Choose a cutoff within the next year.', path: ['cutoffAt'] });
export const lateAddSchema = z.object({
  lateReason: z.string().trim().max(LATE_NOTE_MAX, `Keep the reason to ${LATE_NOTE_MAX} characters.`).optional().transform((v) => v || null),
  move: z.boolean().default(false),
});

/** Making a batch, optionally with its own cutoff (the rule defaults to approved receipts). */
export const batchCreateWithCutoffSchema = batchCreateSchema.extend({ cutoffAt: instant.optional(), cutoffRule: cutoffRuleSchema.optional() });

/** How many receipts a run puts in each batch before it starts the next part. */
export const CUTOFF_PART_SIZE = BATCH_MAX;
