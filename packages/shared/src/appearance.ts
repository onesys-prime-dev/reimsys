import { z } from 'zod';

/** How the app looks for one person. Kept on their account, so it follows them to another device. */
export const TEXT_SIZES = ['small', 'medium', 'large'] as const;
export const DENSITIES = ['comfortable', 'compact'] as const;
/** The colour of buttons, links and highlights. `default` follows the company's choice. */
export const ACCENT_KEYS = ['default', 'teal', 'blue', 'green', 'purple', 'rose', 'amber'] as const;

export type TextSize = (typeof TEXT_SIZES)[number];
export type Density = (typeof DENSITIES)[number];
export type AccentKey = (typeof ACCENT_KEYS)[number];

export const appearanceSchema = z.object({
  textSize: z.enum(TEXT_SIZES).default('medium'),
  density: z.enum(DENSITIES).default('comfortable'),
  accent: z.enum(ACCENT_KEYS).default('default'),
});
export type Appearance = z.infer<typeof appearanceSchema>;
export const DEFAULT_APPEARANCE: Appearance = { textSize: 'medium', density: 'comfortable', accent: 'default' };

/** Reads what is stored (text), falling back to the defaults for anything missing or no longer valid. */
export function parseAppearance(raw: string | null | undefined): Appearance {
  if (!raw) return { ...DEFAULT_APPEARANCE };
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const one = <K extends keyof Appearance>(k: K) => { const r = appearanceSchema.shape[k].safeParse(v[k]); return r.success ? r.data : DEFAULT_APPEARANCE[k]; };
    return { textSize: one('textSize'), density: one('density'), accent: one('accent') } as Appearance;
  } catch { return { ...DEFAULT_APPEARANCE }; }
}

export interface AccentColours { label: string; light: { accent: string; soft: string }; dark: { accent: string; soft: string } }
/** `ink` is the text on a button of that colour: white on the light colours, near-black on the dark theme's lighter ones. */
export const ACCENTS: Record<Exclude<AccentKey, 'default'>, AccentColours> = {
  teal: { label: 'Teal', light: { accent: '#0c7480', soft: '#dff1f3' }, dark: { accent: '#4fc0cc', soft: '#123239' } },
  blue: { label: 'Blue', light: { accent: '#2457c5', soft: '#e3ecfc' }, dark: { accent: '#8fb0f5', soft: '#17284a' } },
  green: { label: 'Green', light: { accent: '#1b7b4a', soft: '#dff3e7' }, dark: { accent: '#5cc791', soft: '#133323' } },
  purple: { label: 'Purple', light: { accent: '#6d45b8', soft: '#ece6f8' }, dark: { accent: '#b99cf0', soft: '#2a2045' } },
  rose: { label: 'Rose', light: { accent: '#b5355f', soft: '#fbe4ec' }, dark: { accent: '#f08fb0', soft: '#3b1a27' } },
  amber: { label: 'Amber', light: { accent: '#8a5a00', soft: '#fbf0d3' }, dark: { accent: '#e8b650', soft: '#3a2d0d' } },
};
export const ACCENT_LABEL: Record<AccentKey, string> = { default: 'Company colour', ...Object.fromEntries(Object.entries(ACCENTS).map(([k, v]) => [k, v.label])) } as Record<AccentKey, string>;

/** The colour to draw with: the person's own, else the company's, else teal. */
export const resolveAccent = (own: AccentKey, company: AccentKey): Exclude<AccentKey, 'default'> => (own !== 'default' ? own : company !== 'default' ? company : 'teal');
