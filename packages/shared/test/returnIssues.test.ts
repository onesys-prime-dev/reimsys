import { describe, expect, it } from 'vitest';
import { FIX_STEPS, RETURN_ISSUES, RETURN_ISSUE_CODES, actionBodySchema, fixStepFor, issueLabel, issuesText, joinIssues, parseIssues, resolveFixStep } from '../src/index';

describe('the list of problems', () => {
  it('has unique codes, plain labels and real form steps', () => {
    const codes = RETURN_ISSUES.map((i) => i.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const i of RETURN_ISSUES) {
      expect(i.label.length, i.code).toBeGreaterThan(8);
      expect(i.step === null || (FIX_STEPS as readonly string[]).includes(i.step), i.code).toBe(true);
    }
  });
  it('ends with "Something else", which has no step to fix', () => {
    const last = RETURN_ISSUES[RETURN_ISSUES.length - 1]!;
    expect(last.code).toBe('other');
    expect(last.step).toBeNull();
    expect(fixStepFor('other')).toBeNull();
  });
  it('sends photo problems to the proof step and amount problems to the invoice step', () => {
    expect(fixStepFor('photo_unclear')).toBe('evidence');
    expect(fixStepFor('photo_wrong')).toBe('evidence');
    expect(fixStepFor('amount_wrong')).toBe('invoice');
    expect(fixStepFor('vat_wrong')).toBe('vat');
    expect(fixStepFor('reason_unclear')).toBe('spend');
  });
});

describe('saving and reading the problems', () => {
  it('round-trips, in order, without repeats', () => {
    expect(joinIssues(['photo_unclear', 'amount_wrong'])).toBe('photo_unclear,amount_wrong');
    expect(joinIssues([])).toBeNull();
    expect(parseIssues('photo_unclear,amount_wrong')).toEqual(['photo_unclear', 'amount_wrong']);
    expect(parseIssues('amount_wrong,amount_wrong,photo_unclear')).toEqual(['amount_wrong', 'photo_unclear']);
  });
  it('ignores empty, missing and unknown values, so an old or damaged value never breaks a screen', () => {
    expect(parseIssues(null)).toEqual([]);
    expect(parseIssues(undefined)).toEqual([]);
    expect(parseIssues('')).toEqual([]);
    expect(parseIssues('nonsense,photo_unclear, ,<script>')).toEqual(['photo_unclear']);
  });
  it('fits in the database column even when every problem is ticked', () => {
    expect((joinIssues(RETURN_ISSUE_CODES) ?? '').length).toBeLessThanOrEqual(300);
  });
});

describe('the sentence people read', () => {
  it('lists the ticked labels, then the note', () => {
    expect(issuesText(['photo_unclear', 'amount_wrong'], 'The total on the photo is 1,284.50.'))
      .toBe(`${issueLabel('photo_unclear')}; ${issueLabel('amount_wrong')}. The total on the photo is 1,284.50.`);
  });
  it('works with ticks only, and with a note only', () => {
    expect(issuesText(['date_wrong'])).toBe(issueLabel('date_wrong'));
    expect(issuesText([], 'Please retake the photo.')).toBe('Please retake the photo.');
    expect(issuesText([], '')).toBe('');
  });
  it('does not print "Something else": the note carries it', () => {
    expect(issuesText(['other'], 'The vendor is not on the approved list.')).toBe('The vendor is not on the approved list.');
    expect(issuesText(['photo_unclear', 'other'], 'Also the date.')).toBe(`${issueLabel('photo_unclear')}. Also the date.`);
  });
});

describe('where Fix goes when the form has skipped steps', () => {
  const noBir = ['bir', 'invoice', 'spend', 'evidence'];
  const withBir = ['bir', 'underco', 'invoice', 'vat', 'spend', 'evidence'];
  it('uses the step when the form has it', () => {
    expect(resolveFixStep('vat', withBir)).toBe('vat');
    expect(resolveFixStep('evidence', noBir)).toBe('evidence');
  });
  it('falls back to the invoice step when the form skipped it (a VAT problem on a receipt with no BIR invoice)', () => {
    expect(resolveFixStep('vat', noBir)).toBe('invoice');
    expect(resolveFixStep('spend', ['bir', 'underco', 'invoice', 'vat', 'wht', 'evidence'])).toBe('invoice');
  });
  it('gives nothing for "no step", and the first step if even the invoice step is missing', () => {
    expect(resolveFixStep(null, withBir)).toBeNull();
    expect(resolveFixStep(undefined, withBir)).toBeNull();
    expect(resolveFixStep('vat', ['bir', 'evidence'])).toBe('bir');
    expect(resolveFixStep('vat', [])).toBeNull();
  });
});

describe('the return request', () => {
  const base = { version: 3 };
  it('accepts known problems and refuses unknown ones or more than ten', () => {
    expect(actionBodySchema.safeParse({ ...base, issues: ['photo_unclear', 'other'] }).success).toBe(true);
    expect(actionBodySchema.safeParse({ ...base, issues: ['made_up'] }).success).toBe(false);
    expect(actionBodySchema.safeParse({ ...base, issues: Array(11).fill('other') }).success).toBe(false);
    expect(actionBodySchema.safeParse(base).success).toBe(true);
  });
});
