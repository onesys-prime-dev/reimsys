import { describe, expect, it } from 'vitest';
import { cleanDeep, cleanText, isBlank } from '../src/text';

// The blank-looking characters reported by the testers, and the other ones that behave the same way
const BLANKS: [string, string][] = [
  ['U+3164 Hangul filler', 'ㅤ'], ['U+2800 Braille blank', '⠀'], ['U+200B zero-width space', '​'], ['U+0020 space', ' '], ['U+00A0 no-break space', ' '],
  ['U+200C zero-width non-joiner', '‌'], ['U+200D zero-width joiner', '‍'], ['U+2060 word joiner', '⁠'], ['U+FEFF byte order mark', '﻿'], ['U+00AD soft hyphen', '­'],
  ['U+115F Hangul choseong filler', 'ᅟ'], ['U+1160 Hangul jungseong filler', 'ᅠ'], ['U+FFA0 halfwidth Hangul filler', 'ﾠ'], ['U+3000 ideographic space', '　'],
  ['U+2003 em space', ' '], ['U+202F narrow no-break space', ' '], ['U+034F combining grapheme joiner', '͏'], ['U+2028 line separator', ' '], ['tab', '\t'], ['new line', '\n'], ['U+200E left-to-right mark', '‎'],
];

describe('text that only looks empty', () => {
  for (const [name, ch] of BLANKS) {
    it(`${name} on its own, however many, is blank`, () => {
      expect(isBlank(ch)).toBe(true);
      expect(isBlank(ch.repeat(6))).toBe(true);
      expect(cleanText(ch.repeat(6))).toBe('');
    });
  }
  it('a mix of all of them is blank', () => {
    const all = BLANKS.map(([, c]) => c).join('');
    expect(isBlank(all)).toBe(true);
    expect(cleanText(all)).toBe('');
  });
  it('is blank for nothing at all', () => {
    expect(isBlank('')).toBe(true);
    expect(isBlank(null)).toBe(true);
    expect(isBlank(undefined)).toBe(true);
  });
  it('removes them from both ends and keeps what a person wrote', () => {
    expect(cleanText('ㅤ​  Photo is cut off ⠀ ')).toBe('Photo is cut off');
    expect(isBlank('ㅤ x ㅤ')).toBe(false);
  });
  it('leaves blank-looking characters in the middle alone (they separate words)', () => {
    expect(cleanText('Cebu North')).toBe('Cebu North');
    expect(cleanText('a​b')).toBe('a​b');
  });
  it('keeps real text, including other languages and emoji', () => {
    for (const t of ['Ok', 'Kulang ang resibo', '領収書', 'Quittung 54,50', '👍', 'Привет']) { expect(cleanText(t)).toBe(t); expect(isBlank(t)).toBe(false); }
  });
  it('does not treat a full stop, a dash or zero as blank', () => {
    for (const t of ['.', '-', '0', '_']) expect(isBlank(t)).toBe(false);
  });
  it('cleanDeep cleans every text in a request, and leaves other values and the named keys alone', () => {
    const out = cleanDeep({ note: 'ㅤxㅤ', n: 5, ok: true, nested: { list: ['​', ' y '] }, password: ' ​ keep ​ ' }, ['password']);
    expect(out).toEqual({ note: 'x', n: 5, ok: true, nested: { list: ['', 'y'] }, password: ' ​ keep ​ ' });
  });
});
