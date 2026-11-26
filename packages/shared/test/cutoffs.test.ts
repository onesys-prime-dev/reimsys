import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GRANTS, PERMISSIONS, TEMPLATE_KEYS, batchCreateWithCutoffSchema, batchCutoffSchema, batchScheduleSchema, canUseCutoffRule, cutoffBatchName, cutoffRuleSchema, cutoffState,
  describeCutoffRule, describeScheduleTiming, fmtCutoff, isLateBatch, lateAddSchema, nextCutoff, parseCutoffRule, parseScheduleDays, schedulesOverlap, zonedTime,
} from '../src/index';

const M = 'Asia/Manila';
// 2026-11-20 is a Friday. Manila is UTC+8 all year.
const at = (local: string) => new Date(`${local}+08:00`);
const weekly = (days: string, time = '17:00', timeZone = M) => ({ repeat: 'weekly', days, time, timeZone });
const monthly = (days: string, time = '17:00', timeZone = M) => ({ repeat: 'monthly', days, time, timeZone });
const iso = (d: Date | null) => d?.toISOString() ?? null;

describe('the next cutoff of a schedule', () => {
  it('every Friday at 5 PM: later the same day, then a week on', () => {
    expect(iso(nextCutoff(weekly('5'), at('2026-11-19T10:00:00')))).toBe(at('2026-11-20T17:00:00').toISOString());
    expect(iso(nextCutoff(weekly('5'), at('2026-11-20T16:59:00')))).toBe(at('2026-11-20T17:00:00').toISOString());
    expect(iso(nextCutoff(weekly('5'), at('2026-11-20T17:00:00')))).toBe(at('2026-11-27T17:00:00').toISOString());
  });
  it('several weekdays', () => {
    expect(iso(nextCutoff(weekly('1,5'), at('2026-11-23T18:00:00')))).toBe(at('2026-11-27T17:00:00').toISOString());
    expect(iso(nextCutoff(weekly('1,5'), at('2026-11-21T09:00:00')))).toBe(at('2026-11-23T17:00:00').toISOString());
  });
  it('the 15th and the last day of the month', () => {
    expect(iso(nextCutoff(monthly('15,L'), at('2026-11-15T17:00:00')))).toBe(at('2026-11-30T17:00:00').toISOString());
    expect(iso(nextCutoff(monthly('15,L'), at('2026-11-30T17:00:00')))).toBe(at('2026-12-15T17:00:00').toISOString());
    expect(iso(nextCutoff(monthly('15,L'), at('2026-12-15T17:30:00')))).toBe(at('2026-12-31T17:00:00').toISOString());
  });
  it('the 31st means the last day of a shorter month, counted once', () => {
    expect(iso(nextCutoff(monthly('31'), at('2026-11-01T00:00:00')))).toBe(at('2026-11-30T17:00:00').toISOString());
    expect(iso(nextCutoff(monthly('31'), at('2027-02-01T00:00:00')))).toBe(at('2027-02-28T17:00:00').toISOString());
    expect(iso(nextCutoff(monthly('31'), at('2028-02-01T00:00:00')))).toBe(at('2028-02-29T17:00:00').toISOString());
    expect(iso(nextCutoff(monthly('30,31'), at('2026-11-30T17:00:00')))).toBe(at('2026-12-30T17:00:00').toISOString());
    expect(iso(nextCutoff(monthly('29'), at('2027-02-01T00:00:00')))).toBe(at('2027-02-28T17:00:00').toISOString());
  });
  it('crosses the year end', () => {
    expect(iso(nextCutoff(weekly('5'), at('2026-12-26T00:00:00')))).toBe(at('2027-01-01T17:00:00').toISOString());
    expect(iso(nextCutoff(monthly('1', '08:00'), at('2026-12-01T09:00:00')))).toBe(at('2027-01-01T08:00:00').toISOString());
  });
  it('reads the clock in the schedule time zone, whatever the server says (New York, around daylight saving)', () => {
    const ny = (d: string) => nextCutoff(weekly('0', '09:00', 'America/New_York'), new Date(d));
    expect(iso(ny('2026-02-28T12:00:00Z'))).toBe('2026-03-01T14:00:00.000Z'); // winter, UTC-5
    expect(iso(ny('2026-03-02T12:00:00Z'))).toBe('2026-03-08T13:00:00.000Z'); // the day the clocks go forward, UTC-4
    expect(iso(ny('2026-10-26T12:00:00Z'))).toBe('2026-11-01T14:00:00.000Z'); // the day they go back
    expect(zonedTime(2026, 11, 20, 17 * 60, M).toISOString()).toBe('2026-11-20T09:00:00.000Z');
  });
  it('a schedule that does not read has no next cutoff', () => {
    expect(nextCutoff(weekly('7'), new Date())).toBeNull();
    expect(nextCutoff(monthly('0'), new Date())).toBeNull();
    expect(nextCutoff(weekly('5', '25:00'), new Date())).toBeNull();
    expect(nextCutoff(weekly('5', '17:00', 'Mars/Base'), new Date())).toBeNull();
  });
  it('reads the stored days', () => {
    expect(parseScheduleDays('weekly', '5,1')).toEqual([1, 5]);
    expect(parseScheduleDays('weekly', 'L')).toBeNull();
    expect(parseScheduleDays('monthly', 'L,15')).toEqual([15, 'L']);
    expect(parseScheduleDays('monthly', '32')).toBeNull();
    expect(parseScheduleDays('monthly', '15,15')).toBeNull();
  });
});

describe('a schedule in plain words', () => {
  it('says when', () => {
    expect(describeScheduleTiming(weekly('5'))).toBe('Every Friday at 5:00 PM (Asia/Manila)');
    expect(describeScheduleTiming(weekly('1,5', '09:30'))).toBe('Every Monday and Friday at 9:30 AM (Asia/Manila)');
    expect(describeScheduleTiming(weekly('1,2,3,4,5', '12:00'))).toBe('Every weekday at 12:00 PM (Asia/Manila)');
    expect(describeScheduleTiming(monthly('15,L'))).toBe('On the 15th and the last day of every month at 5:00 PM (Asia/Manila)');
    expect(describeScheduleTiming(monthly('31'))).toBe('On the 31st of every month at 5:00 PM (Asia/Manila) (the last day in shorter months)');
  });
  it('says what it takes', () => {
    const r = cutoffRuleSchema.parse({ statuses: 'approved', chargeLocationIds: [3] });
    expect(describeCutoffRule(r, { locations: ['Pasig'] })).toBe('Takes approved receipts approved before then, charged to Pasig, that are in no other batch.');
    expect(describeCutoffRule(cutoffRuleSchema.parse({ statuses: 'in_progress', date: 'receipt', encoderIds: [1, 2] }))).toBe('Takes receipts in progress (submitted, checked or approved) dated on or before that day, from 2 chosen people, that are in no other batch.');
  });
  it('dates for the screen and the batch name', () => {
    expect(fmtCutoff(at('2026-11-20T17:00:00'), M)).toBe('Fri 20 Nov, 5:00 PM');
    expect(cutoffBatchName('Weekly run Pasig', at('2026-11-20T17:00:00'), M)).toBe('Weekly run Pasig · 20 Nov');
    expect(cutoffBatchName('Weekly run Pasig', at('2026-11-20T17:00:00'), M, 2)).toBe('Weekly run Pasig · 20 Nov (part 2)');
    expect(cutoffBatchName('x'.repeat(60), at('2026-11-20T17:00:00'), M, 12).length).toBeLessThanOrEqual(80);
  });
});

describe('the fill rule', () => {
  it('takes the approval date for approved receipts and the submitted date otherwise', () => {
    expect(cutoffRuleSchema.parse({ statuses: 'approved' })).toEqual({ statuses: 'approved', date: 'approved', chargeLocationIds: [], encoderIds: [] });
    expect(cutoffRuleSchema.parse({ statuses: 'in_progress' }).date).toBe('submitted');
    expect(cutoffRuleSchema.parse({ statuses: 'approved', encoderIds: [5, 2, 5] }).encoderIds).toEqual([2, 5]);
  });
  it('refuses an approval date for receipts not yet approved, and unknown choices', () => {
    expect(cutoffRuleSchema.safeParse({ statuses: 'in_progress', date: 'approved' }).success).toBe(false);
    expect(cutoffRuleSchema.safeParse({ statuses: 'returned' }).success).toBe(false);
    expect(cutoffRuleSchema.safeParse({}).success).toBe(false);
  });
  it('a stored rule that no longer reads is treated as none', () => {
    expect(parseCutoffRule('{"statuses":"approved"}')?.date).toBe('approved');
    expect(parseCutoffRule('not json')).toBeNull();
    expect(parseCutoffRule('{"statuses":"x"}')).toBeNull();
    expect(parseCutoffRule(null)).toBeNull();
  });
  it('only people who see every receipt may take receipts still in progress', () => {
    expect(canUseCutoffRule(new Set(['batch.manage', 'payment.mark']), { statuses: 'approved' })).toBe(true);
    expect(canUseCutoffRule(new Set(['batch.manage', 'payment.mark']), { statuses: 'in_progress' })).toBe(false);
    expect(canUseCutoffRule(new Set(['batch.manage', 'receipt.view_all']), { statuses: 'in_progress' })).toBe(true);
  });
});

describe('schedule requests', () => {
  const base = { name: 'Weekly run', repeat: 'weekly', days: [5], time: '17:00', timeZone: M, rule: { statuses: 'approved' } };
  it('stores the days as a list', () => {
    expect(batchScheduleSchema.parse(base).days).toBe('5');
    expect(batchScheduleSchema.parse({ ...base, repeat: 'monthly', days: ['L', 15] }).days).toBe('15,L');
  });
  it('refuses days that do not fit the repeat, a bad time, zone or name', () => {
    expect(batchScheduleSchema.safeParse({ ...base, days: ['L'] }).success).toBe(false);
    expect(batchScheduleSchema.safeParse({ ...base, repeat: 'monthly', days: [32] }).success).toBe(false);
    expect(batchScheduleSchema.safeParse({ ...base, days: [] }).success).toBe(false);
    expect(batchScheduleSchema.safeParse({ ...base, time: '5pm' }).success).toBe(false);
    expect(batchScheduleSchema.safeParse({ ...base, timeZone: 'Nowhere' }).success).toBe(false);
    expect(batchScheduleSchema.safeParse({ ...base, name: 'x'.repeat(61) }).success).toBe(false);
    expect(batchScheduleSchema.safeParse({ ...base, name: ' ' }).success).toBe(false);
  });
  it('only admins set up repeating cutoffs by default', () => {
    expect(PERMISSIONS.some((p) => p.code === 'batch.schedule')).toBe(true);
    expect(DEFAULT_GRANTS['batch.schedule']).toEqual(['manager', 'admin']);
  });
  it('has its own editable email', () => expect(TEMPLATE_KEYS).toContain('batch_cutoff'));
});

describe('one batch’s cutoff', () => {
  it('a time and a rule, or none', () => {
    const v = batchCutoffSchema.parse({ cutoffAt: '2026-11-20T17:00:00+08:00', cutoffRule: { statuses: 'approved' } });
    expect(v.cutoffAt?.toISOString()).toBe('2026-11-20T09:00:00.000Z');
    expect(batchCutoffSchema.parse({ cutoffAt: null }).cutoffAt).toBeNull();
    expect(batchCutoffSchema.safeParse({ cutoffAt: 'friday' }).success).toBe(false);
    expect(batchCutoffSchema.safeParse({ cutoffAt: new Date(Date.now() + 500 * 86_400_000).toISOString() }).success).toBe(false);
    expect(batchCreateWithCutoffSchema.parse({ name: 'x', cutoffAt: '2026-11-20T09:00:00Z' }).cutoffAt).toBeInstanceOf(Date);
    expect(batchCreateWithCutoffSchema.parse({}).cutoffAt).toBeUndefined();
  });
  it('knows where the cutoff stands', () => {
    const t = new Date();
    expect(cutoffState({ cutoffAt: null, cutoffDoneAt: null })).toBe('none');
    expect(cutoffState({ cutoffAt: t, cutoffDoneAt: null })).toBe('pending');
    expect(cutoffState({ cutoffAt: t, cutoffDoneAt: t })).toBe('ran');
    expect(cutoffState({ cutoffAt: null, cutoffDoneAt: t })).toBe('cancelled');
  });
  it('adding is late once the batch is closed or its cutoff ran, even if reopened', () => {
    const t = new Date();
    expect(isLateBatch({ closedAt: null, cutoffAt: null, cutoffDoneAt: null })).toBe(false);
    expect(isLateBatch({ closedAt: null, cutoffAt: t, cutoffDoneAt: null })).toBe(false);
    expect(isLateBatch({ closedAt: t, cutoffAt: null, cutoffDoneAt: null })).toBe(true);
    expect(isLateBatch({ closedAt: null, cutoffAt: t, cutoffDoneAt: t })).toBe(true);
    expect(isLateBatch({ closedAt: null, cutoffAt: null, cutoffDoneAt: t })).toBe(false);
  });
  it('a late reason is trimmed and limited', () => {
    expect(lateAddSchema.parse({ lateReason: '  approved 20 min late  ' })).toEqual({ lateReason: 'approved 20 min late', move: false });
    expect(lateAddSchema.parse({ lateReason: ' ' }).lateReason).toBeNull();
    expect(lateAddSchema.safeParse({ lateReason: 'x'.repeat(301) }).success).toBe(false);
  });
});

describe('overlapping schedules', () => {
  it('meet when their places and people meet; empty means all', () => {
    expect(schedulesOverlap({ chargeLocationIds: [], encoderIds: [] }, { chargeLocationIds: [2], encoderIds: [] })).toBe(true);
    expect(schedulesOverlap({ chargeLocationIds: [1], encoderIds: [] }, { chargeLocationIds: [2], encoderIds: [] })).toBe(false);
    expect(schedulesOverlap({ chargeLocationIds: [1, 2], encoderIds: [7] }, { chargeLocationIds: [2], encoderIds: [8] })).toBe(false);
    expect(schedulesOverlap({ chargeLocationIds: [1, 2], encoderIds: [7] }, { chargeLocationIds: [2], encoderIds: [] })).toBe(true);
  });
});
