import { describe, expect, it } from 'vitest';
import { describeEmailSchedule, emailScheduleSchema, scheduleIsDue, type DueRules } from '../src';

// 2026-10-28 is a Wednesday. Manila is UTC+8.
const at = (hhmm: string, day = '2026-10-28') => new Date(`${day}T${hhmm}:00+08:00`);
const base: DueRules = { isOn: true, intervalMinutes: 60, startTime: '08:00', endTime: '18:00', days: '1,2,3,4,5,6', timeZone: 'Asia/Manila', lastSentAt: null };

describe('when a schedule is due', () => {
  it('is due inside its hours the first time, never outside them', () => {
    expect(scheduleIsDue(at('08:00'), base)).toBe(true);
    expect(scheduleIsDue(at('07:59'), base)).toBe(false);
    expect(scheduleIsDue(at('18:00'), base)).toBe(true);
    expect(scheduleIsDue(at('18:01'), base)).toBe(false);
    expect(scheduleIsDue(at('23:00'), base)).toBe(false);
  });
  it('waits the whole interval after a send', () => {
    expect(scheduleIsDue(at('10:00'), { ...base, lastSentAt: at('09:30') })).toBe(false);
    expect(scheduleIsDue(at('10:30'), { ...base, lastSentAt: at('09:30') })).toBe(true);
    expect(scheduleIsDue(new Date(at('10:30').getTime() - 20_000), { ...base, lastSentAt: at('09:30') })).toBe(true); // a few seconds of slack
    expect(scheduleIsDue(new Date(at('10:30').getTime() - 60_000), { ...base, lastSentAt: at('09:30') })).toBe(false);
    expect(scheduleIsDue(at('10:00'), { ...base, intervalMinutes: 30, lastSentAt: at('09:30') })).toBe(true);
  });
  it('skips days that are not chosen and a switched-off schedule', () => {
    expect(scheduleIsDue(at('09:00', '2026-11-01'), base)).toBe(false); // Sunday
    expect(scheduleIsDue(at('09:00', '2026-11-01'), { ...base, days: '0' })).toBe(true);
    expect(scheduleIsDue(at('09:00'), { ...base, isOn: false })).toBe(false);
  });
  it('once a day sends once per local day, and again the next morning', () => {
    const daily = { ...base, intervalMinutes: 1440 };
    expect(scheduleIsDue(at('08:05'), { ...daily, lastSentAt: at('08:00') })).toBe(false);
    expect(scheduleIsDue(at('17:00'), { ...daily, lastSentAt: at('08:00') })).toBe(false);
    expect(scheduleIsDue(at('08:00', '2026-10-29'), { ...daily, lastSentAt: at('08:10') })).toBe(true);
  });
  it('reads the hours in its own time zone', () => {
    const utc = new Date('2026-10-28T00:30:00Z'); // 08:30 in Manila
    expect(scheduleIsDue(utc, base)).toBe(true);
    expect(scheduleIsDue(utc, { ...base, days: '3', timeZone: 'America/Los_Angeles' })).toBe(false); // still Tuesday evening there, and only Wednesday is chosen
    expect(scheduleIsDue(utc, { ...base, days: '2', timeZone: 'America/Los_Angeles' })).toBe(true);
  });
});

describe('the schedule form', () => {
  const ok = { name: 'Boss hourly', steps: ['pay', 'check'], minDays: 1, roleIds: [], userIds: [3], intervalMinutes: 60, startTime: '08:00', endTime: '18:00', days: [1, 2, 3], timeZone: 'Asia/Manila' };
  const bad = (o: object) => emailScheduleSchema.safeParse({ ...ok, ...o });
  it('accepts a good one and tidies it', () => {
    const r = emailScheduleSchema.parse(ok);
    expect(r).toMatchObject({ steps: 'check,pay', days: '1,2,3', isOn: true, intervalMinutes: 60 });
  });
  it('needs a name, a step, someone to send to, and sensible hours', () => {
    expect(bad({ name: 'x' }).success).toBe(false);
    expect(bad({ steps: [] }).success).toBe(false);
    expect(bad({ roleIds: [], userIds: [] }).success).toBe(false);
    expect(bad({ roleIds: [2], userIds: [] }).success).toBe(true);
    expect(bad({ days: [] }).success).toBe(false);
    expect(bad({ endTime: '07:00' }).success).toBe(false);
    expect(bad({ startTime: '8am' }).success).toBe(false);
    expect(bad({ timeZone: 'Mars/Base' }).success).toBe(false);
    expect(bad({ minDays: -1 }).success).toBe(false);
  });
  it('never allows less than 30 minutes', () => {
    expect(bad({ intervalMinutes: 15 }).success).toBe(false);
    expect(bad({ intervalMinutes: 5 }).success).toBe(false);
    expect(bad({ intervalMinutes: 0 }).success).toBe(false);
    expect(bad({ intervalMinutes: 45 }).success).toBe(false);
    expect(bad({ intervalMinutes: 30 }).success).toBe(true);
    expect(bad({ intervalMinutes: 1440 }).success).toBe(true);
  });
  it('is described in plain words', () => {
    expect(describeEmailSchedule({ steps: 'check,pay', minDays: 1, intervalMinutes: 60, startTime: '08:00', endTime: '18:00', days: '1,2,3,4,5', timeZone: 'Asia/Manila' }))
      .toBe('Lists receipts waiting to be checked, approved and waiting to be paid, only receipts that have waited 1 day or more. Every hour, 08:00 to 18:00, Mon to Fri (Asia/Manila).');
  });
});
