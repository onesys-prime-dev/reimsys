/**
 * Text that looks empty but is not. JavaScript's trim() removes ordinary spaces and the no-break space, but not zero-width characters, the Hangul
 * filler, the Braille blank and similar characters that show as nothing. Typing only those into a "required" box used to count as an answer.
 * `cleanText` removes all of them from both ends of a text, so "required" and "at least N characters" are judged on what a person can actually see.
 */
// Control, format (zero-width space/joiner, soft hyphen, bidi marks, BOM), line/paragraph separators and every space separator (Zs, including U+0020, U+00A0, U+3000),
// plus the blank-looking characters that are not in those categories: Hangul fillers (U+115F, U+1160, U+3164, U+FFA0), Braille blank (U+2800),
// combining grapheme joiner (U+034F), Khmer inherent vowels (U+17B4, U+17B5) and the Mongolian free variation selectors.
const BLANK = String.raw`[\p{Cc}\p{Cf}\p{Zs}\p{Zl}\p{Zp}\u115F\u1160\u3164\uFFA0\u2800\u034F\u17B4\u17B5\u180B-\u180F]`;
const ENDS = new RegExp(`^${BLANK}+|${BLANK}+$`, 'gu');
const ALL_BLANK = new RegExp(`^${BLANK}*$`, 'u');

/** The text without blank-looking characters at the start and end. A text made only of them becomes ''. */
export const cleanText = (s: string): string => s.replace(ENDS, '');

/** True when nothing a person could read is there. */
export const isBlank = (s: string | null | undefined): boolean => ALL_BLANK.test(s ?? '');

/** Cleans every text inside a value that came from a request (objects, lists), leaving numbers, booleans and the named keys (such as passwords) alone. */
export function cleanDeep<T>(value: T, skipKeys: readonly string[] = []): T {
  if (typeof value === 'string') return cleanText(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => cleanDeep(v, skipKeys)) as unknown as T;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = skipKeys.includes(k) ? v : cleanDeep(v, skipKeys);
    return out as T;
  }
  return value;
}
