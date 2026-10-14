/**
 * The REIMSYS mark: a "Y" on a tile with a folded paper corner.
 * The Y is the fork every receipt reaches (approve or send back), and its right arm is shaped like an approval stroke.
 * One definition, so the app, the favicon, the PDFs and the emails always match.
 * All coordinates are on a 64 x 64 grid.
 */
export const BRAND = {
  name: 'REIMSYS',
  teal: '#0c7480',
  tealLight: '#14909d',
  tealDark: '#095964',
  mint: '#9ff0d4',
  white: '#ffffff',
} as const;

export const LOGO = {
  size: 64,
  /** The tile. The top right corner is cut off like a page that has been folded over. */
  tile: 'M16 0 H50 L64 14 V48 Q64 64 48 64 H16 Q0 64 0 48 V16 Q0 0 16 0 Z',
  /** The folded-over corner, drawn lighter on top of the tile. */
  fold: { d: 'M50 0 V10 Q50 14 54 14 H64 Z', opacity: 0.28 },
  strokeWidth: 7,
  /** The Y. The right arm is longer and mint, like an approval stroke; the rest is white. Drawn in this order. */
  strokes: [
    { d: 'M45 16.5 L30 38', color: BRAND.mint },
    { d: 'M17 22 L30 38 L30 51', color: BRAND.white },
  ],
} as const;
