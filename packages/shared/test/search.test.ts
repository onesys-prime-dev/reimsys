import { describe, expect, it } from 'vitest';
import { SEARCH_MAX_TERMS, amountTerm, batchChoiceSchema, dateTerm, labelMatches, likeSafe, listQuerySchema, searchTerms } from '../src/index';

describe('what someone types in the search box', () => {
  it('splits it into words, each searched on its own', () => {
    expect(searchTerms('mercury  1284')).toEqual(['mercury', '1284']);
    expect(searchTerms('  ')).toEqual([]);
    expect(searchTerms(undefined)).toEqual([]);
  });
  it('keeps "quoted words" together', () => {
    expect(searchTerms('"mercury drug" pasig')).toEqual(['mercury drug', 'pasig']);
  });
  it('drops marks around words and repeats, and keeps it short', () => {
    expect(searchTerms('fuel, (pasig) Fuel')).toEqual(['fuel', 'pasig']);
    expect(searchTerms(Array.from({ length: 20 }, (_, i) => `w${i}`).join(' '))).toHaveLength(SEARCH_MAX_TERMS);
    expect(searchTerms('x'.repeat(200))[0]).toHaveLength(60);
  });
  it('keeps codes whole', () => {
    expect(searchTerms('RC-2026-000123 B-2026-000004 REIM-2026-000045')).toEqual(['RC-2026-000123', 'B-2026-000004', 'REIM-2026-000045']);
  });
  it('the list still accepts what the box sends', () => {
    expect(listQuerySchema.parse({ q: 'mercury 1,284.50' }).q).toBe('mercury 1,284.50');
  });
});

describe('amounts, dates and names in a search', () => {
  it('an amount with centavos is that amount; without, the whole peso', () => {
    expect(amountTerm('1,284.50')).toEqual({ gte: 1284.5, lt: 1284.505 });
    expect(amountTerm('₱1284.5')).toEqual({ gte: 1284.5, lt: 1284.505 });
    expect(amountTerm('PHP600')).toEqual({ gte: 600, lt: 601 });
    expect(amountTerm('1284')).toEqual({ gte: 1284, lt: 1285 });
  });
  it('words and codes are not amounts', () => {
    for (const t of ['mercury', 'RC-2026-000123', '12.345', '1.2.3', '', '12a']) expect(amountTerm(t)).toBeNull();
  });
  it('a date is written as 2026-11-20', () => {
    expect(dateTerm('2026-11-20')).toBe('2026-11-20');
    expect(dateTerm('20/11/2026')).toBeNull();
    expect(dateTerm('2026-13-45')).toBeNull();
  });
  it('status, type and classification words find receipts with them', () => {
    expect(labelMatches('approved').statuses).toEqual(['approved']); // not "Disapproved"
    expect(labelMatches('Paid').statuses).toEqual(['paid']);
    expect(labelMatches('meal').classifications).toEqual(['meal_personal', 'representation_meal']);
    expect(labelMatches('serv').types).toEqual(['service']);
    expect(labelMatches('ab')).toEqual({ statuses: [], classifications: [], types: [] });
  });
});

describe('a Med Ref choosing the batch', () => {
  it('a batch, or none', () => {
    expect(batchChoiceSchema.parse({ batchId: 4 }).batchId).toBe(4);
    expect(batchChoiceSchema.parse({ batchId: null }).batchId).toBeNull();
    expect(batchChoiceSchema.safeParse({}).success).toBe(false);
    expect(batchChoiceSchema.safeParse({ batchId: 0 }).success).toBe(false);
  });
});

describe('characters the database reads as "anything"', () => {
  it('% and _ (and the escape mark itself) are searched as they are', () => {
    expect(likeSafe('50%')).toBe('50\\%');
    expect(likeSafe('meal_personal')).toBe('meal\\_personal');
    expect(likeSafe('a\\b')).toBe('a\\\\b');
    expect(likeSafe('mercury')).toBe('mercury');
  });
});
