import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, appSettingsSchema, describeSchedule, isTimeOfDay, isTimeZone, localParts, parseDays, scheduleDecision } from '../src';

const rules = { on: true, time: '08:00', emailDays: '1,2,3,4,5,6', emailTimeZone: 'Asia/Manila', emailLateHours: 3 };
// 2026-10-28 is a Wednesday. Manila is UTC+8, so 08:00 there is 00:00 UTC.
const at = (hhmmManila: string, day = '2026-10-28') => new Date(`${day}T${hhmmManila}:00+08:00`);

describe('when the daily emails go out', () => {
  it('waits before the time, sends at it, and keys the day by the time zone', () => {
    expect(scheduleDecision(at('07:59'), rules)).toEqual({ action: 'wait' });
    expect(scheduleDecision(at('08:00'), rules)).toEqual({ action: 'send', dayKey: '2026-10-28' });
    expect(scheduleDecision(at('09:30'), rules)).toEqual({ action: 'send', dayKey: '2026-10-28' });
  });
  it('sends late for the window only, then skips the day', () => {
    expect(scheduleDecision(at('11:00'), rules)).toEqual({ action: 'send', dayKey: '2026-10-28' });
    expect(scheduleDecision(at('11:01'), rules)).toEqual({ action: 'skip', why: 'late' });
    expect(scheduleDecision(at('16:00'), rules)).toEqual({ action: 'skip', why: 'late' });
    expect(scheduleDecision(at('08:01'), { ...rules, emailLateHours: 0 })).toEqual({ action: 'skip', why: 'late' });
    expect(scheduleDecision(at('08:00'), { ...rules, emailLateHours: 0 })).toEqual({ action: 'send', dayKey: '2026-10-28' });
  });
  it('skips days that are not chosen, and when switched off', () => {
    expect(scheduleDecision(at('09:00', '2026-11-01'), rules)).toEqual({ action: 'skip', why: 'day' }); // a Sunday
    expect(scheduleDecision(at('09:00', '2026-11-01'), { ...rules, emailDays: '0,1' })).toEqual({ action: 'send', dayKey: '2026-11-01' });
    expect(scheduleDecision(at('09:00'), { ...rules, on: false })).toEqual({ action: 'skip', why: 'off' });
  });
  it('reads the time in the chosen time zone, not the server clock', () => {
    const utcMidnight = new Date('2026-10-28T00:00:00Z'); // 08:00 in Manila, 09:00 in Tokyo, 17:00 the day before in Los Angeles
    expect(scheduleDecision(utcMidnight, rules).action).toBe('send');
    expect(scheduleDecision(utcMidnight, { ...rules, emailTimeZone: 'Asia/Tokyo' }).action).toBe('send');
    expect(scheduleDecision(utcMidnight, { ...rules, emailTimeZone: 'America/Los_Angeles' }).action).toBe('skip'); // 17:00 the evening before: too late
    expect(localParts(utcMidnight, 'America/Los_Angeles').date).toBe('2026-10-27');
    expect(localParts(new Date('2026-10-27T16:30:00Z'), 'Asia/Manila')).toMatchObject({ date: '2026-10-28', minutes: 30 });
  });
  it('is not confused by midnight', () => {
    expect(localParts(new Date('2026-10-27T16:00:00Z'), 'Asia/Manila')).toMatchObject({ date: '2026-10-28', minutes: 0, weekday: 3 });
    expect(scheduleDecision(at('00:00'), { ...rules, time: '00:00' })).toEqual({ action: 'send', dayKey: '2026-10-28' });
    expect(scheduleDecision(at('23:59'), { ...rules, time: '23:30', emailLateHours: 0 })).toEqual({ action: 'skip', why: 'late' });
  });
});

describe('the settings', () => {
  it('check the time, the days and the time zone', () => {
    expect(isTimeOfDay('08:00') && isTimeOfDay('23:59') && isTimeOfDay('00:00')).toBe(true);
    expect(['8:00', '24:00', '08:60', '', '0800', 'ab:cd'].some(isTimeOfDay)).toBe(false);
    expect(parseDays('1,2,3')).toEqual([1, 2, 3]);
    expect(parseDays('3,1')).toEqual([1, 3]);
    expect(['', '7', '1,1', 'a', '1,,'].map(parseDays)).toEqual([null, null, null, null, [1]].map((x, i) => (i === 4 ? [1] : x)));
    expect(isTimeZone('Asia/Manila') && isTimeZone('UTC')).toBe(true);
    expect(isTimeZone('Mars/Base') || isTimeZone('')).toBe(false);
  });
  it('refuse bad values and keep the defaults valid', () => {
    expect(appSettingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
    const bad = (o: object) => appSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...o }).success;
    expect(bad({ digestTime: '25:00' })).toBe(false);
    expect(bad({ reminderTime: 'soon' })).toBe(false);
    expect(bad({ emailDays: '' })).toBe(false);
    expect(bad({ emailTimeZone: 'Nowhere/Land' })).toBe(false);
    expect(bad({ emailLateHours: 13 })).toBe(false);
    expect(bad({ emailLateHours: -1 })).toBe(false);
    expect(bad({ digestTime: '17:30', emailDays: '0,1,2,3,4,5,6', emailLateHours: 0 })).toBe(true);
  });
  it('are described in plain words', () => {
    expect(describeSchedule('The daily summary', rules)).toBe('The daily summary goes out at 8:00 AM (Asia/Manila), Monday to Saturday. If the server was down then, it is sent when it returns, up to 3 hours later; after that the day is skipped.');
    expect(describeSchedule('X', { ...rules, time: '13:05', emailDays: '0,1,2,3,4,5,6', emailLateHours: 0 })).toContain('1:05 PM (Asia/Manila), every day. If the server is down at that time, that day is skipped.');
    expect(describeSchedule('X', { ...rules, on: false })).toBe('X is switched off.');
    expect(describeSchedule('X', { ...rules, emailDays: '1,3' })).toContain('Mon, Wed');
  });
});
