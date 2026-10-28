/** When the daily emails (the summary and the waiting-receipt reminders) go out. The settings are the time, the days, the time zone and how late a send may be. */

export interface ScheduleRules {
  emailTimeZone: string;
  emailDays: string;
  emailLateHours: number;
}

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export const isTimeOfDay = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
export const isTimeZone = (v: string) => { try { new Intl.DateTimeFormat('en-US', { timeZone: v }); return v.length > 0; } catch { return false; } };
/** "1,2,3" (0 = Sunday ... 6 = Saturday), no repeats, at least one. */
export const parseDays = (v: string): number[] | null => {
  const parts = v.split(',').map((x) => x.trim()).filter(Boolean);
  if (!parts.length || parts.some((p) => !/^[0-6]$/.test(p)) || new Set(parts).size !== parts.length) return null;
  return parts.map(Number).sort((a, b) => a - b);
};

/** The date, time and weekday where the time zone is. */
export function localParts(now: Date, timeZone: string) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute), weekday: WEEKDAYS.indexOf(p.weekday as (typeof WEEKDAYS)[number]) };
}

export type ScheduleDecision = { action: 'send'; dayKey: string } | { action: 'wait' } | { action: 'skip'; why: 'off' | 'day' | 'late' };

/**
 * Is it time to send today's email? `send` once the time has come and while it is still within the late window (so a server that was down at the set
 * time sends when it returns, but never hours later); `wait` before the time; `skip` when it is switched off, today is not a send day, or it is too late.
 */
export function scheduleDecision(now: Date, o: { on: boolean; time: string } & ScheduleRules): ScheduleDecision {
  if (!o.on) return { action: 'skip', why: 'off' };
  const days = parseDays(o.emailDays);
  const at = localParts(now, o.emailTimeZone);
  if (!days || !days.includes(at.weekday)) return { action: 'skip', why: 'day' };
  const [h, m] = o.time.split(':').map(Number);
  const set = h! * 60 + m!;
  if (at.minutes < set) return { action: 'wait' };
  if (at.minutes - set > o.emailLateHours * 60) return { action: 'skip', why: 'late' };
  return { action: 'send', dayKey: at.date };
}

/** A sentence for the Settings screen. */
export function describeSchedule(what: string, o: { on: boolean; time: string } & ScheduleRules): string {
  if (!o.on) return `${what} is switched off.`;
  const days = parseDays(o.emailDays);
  if (!days) return `${what}: choose at least one day.`;
  const [h, m] = o.time.split(':').map(Number);
  const clock = `${h! % 12 || 12}:${String(m).padStart(2, '0')} ${h! < 12 ? 'AM' : 'PM'}`;
  const dayText = days.length === 7 ? 'every day' : days.join(',') === '1,2,3,4,5' ? 'Monday to Friday' : days.join(',') === '1,2,3,4,5,6' ? 'Monday to Saturday' : days.map((d) => WEEKDAYS[d]).join(', ');
  const late = o.emailLateHours > 0 ? `If the server was down then, it is sent when it returns, up to ${o.emailLateHours} hour${o.emailLateHours === 1 ? '' : 's'} later; after that the day is skipped.` : 'If the server is down at that time, that day is skipped.';
  return `${what} goes out at ${clock} (${o.emailTimeZone}), ${dayText}. ${late}`;
}
