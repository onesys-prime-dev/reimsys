import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, appSettingsSchema, reminderStage, whoToRemind, REMINDER_LABEL } from '../src/index';

const rules = { reminderCheckDays: 2, reminderDecideDays: 2, reminderPayDays: 3, reminderFixDays: 5 };

describe('reminder stages', () => {
  it('maps a waiting status to what is being waited for', () => {
    expect(reminderStage('submitted')).toBe('check');
    expect(reminderStage('checked')).toBe('decide');
    expect(reminderStage('approved')).toBe('pay');
    expect(reminderStage('returned')).toBe('fix');
    for (const s of ['draft', 'reserved', 'disapproved', 'paid', 'withdrawn']) expect(reminderStage(s), s).toBeNull();
  });
  it('is overdue only once the days have passed', () => {
    expect(whoToRemind('submitted', 1.9, rules)).toBeNull();
    expect(whoToRemind('submitted', 2, rules)).toBe('check');
    expect(whoToRemind('approved', 2.9, rules)).toBeNull();
    expect(whoToRemind('approved', 3, rules)).toBe('pay');
    expect(whoToRemind('returned', 5, rules)).toBe('fix');
  });
  it('does nothing for a stage set to 0 (off)', () => {
    expect(whoToRemind('submitted', 30, { ...rules, reminderCheckDays: 0 })).toBeNull();
  });
  it('has a plain label for each stage', () => {
    expect(REMINDER_LABEL.check).toMatch(/check/i);
    expect(REMINDER_LABEL.fix).toMatch(/fix|correct/i);
  });
  it('has defaults and refuses nonsense', () => {
    expect(DEFAULT_SETTINGS).toMatchObject(rules);
    expect(appSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, reminderPayDays: -1 }).success).toBe(false);
    expect(appSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, reminderPayDays: 100 }).success).toBe(false);
    expect(appSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, reminderPayDays: 0 }).success).toBe(true);
  });
});
