/**
 * The REIMSIS mark: a receipt with a check, on a rounded teal square.
 * One definition, so the app, the favicon, the PDFs and the emails always match.
 * All coordinates are on a 64 x 64 grid.
 */
export const BRAND = {
  teal: '#0c7480',
  tealLight: '#14909d',
  tealDark: '#095964',
  white: '#ffffff',
} as const;

export const LOGO = {
  size: 64,
  radius: 16,
  /** The receipt, with a torn zigzag bottom edge. */
  receipt: 'M18.56 8.6 H45.44 Q47.68 8.6 47.68 10.84 V52.28 L43.76 48.36 L39.84 52.28 L35.92 48.36 L32 52.28 L28.08 48.36 L24.16 52.28 L20.24 48.36 L16.32 52.28 V10.84 Q16.32 8.6 18.56 8.6 Z',
  /** The check mark drawn on the receipt. */
  check: { points: [[24.72, 24.28], [30.32, 29.88], [40.4, 18.12]] as [number, number][], width: 4.9 },
  /** Two faint text lines under the check, so it reads as a receipt even when small. */
  lines: { segments: [[23.04, 37.72, 40.96, 37.72], [23.04, 42.76, 34.24, 42.76]] as [number, number, number, number][], width: 2.5, opacity: 0.38 },
} as const;
