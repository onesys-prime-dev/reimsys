/**
 * The REIMSYS mark: a return arrow circling a peso sign, on a rounded teal square.
 * "Money coming back", which is what reimbursement is.
 * One definition, so the app, the favicon, the PDFs and the emails always match.
 * All coordinates are on a 64 x 64 grid.
 */
export const BRAND = {
  name: 'REIMSYS',
  teal: '#0c7480',
  tealLight: '#14909d',
  tealDark: '#095964',
  white: '#ffffff',
} as const;

export const LOGO = {
  size: 64,
  radius: 16,
  /** The circular arrow: almost a full turn, with a gap at the top right where the head points. */
  ring: { d: 'M48.44 26.01 A17.5 17.5 0 1 1 35.04 14.77', width: 5 },
  /** The arrow head at the end of the ring. */
  head: { points: [[41.6, 16.5], [32.2, 21.4], [34.4, 8.6]] as [number, number][], width: 1.4 },
  /** The peso sign in the middle: a stem with a round top, and two bars across it. */
  peso: { stem: 'M29 41 V23.5 H33.6 a5 5 0 0 1 0 10 H29', bars: 'M25 28.2 H37.5 M25 32 H37.5', width: 2.8 },
} as const;
