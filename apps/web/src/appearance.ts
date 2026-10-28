import { ACCENTS, DEFAULT_APPEARANCE, resolveAccent, type AccentKey, type Appearance } from '@reimsys/shared';

const SCALE = { small: 0.93, medium: 1, large: 1.14 } as const;

/** Is the screen drawing in the dark theme right now? */
export const isDark = (theme: string | undefined) => theme === 'dark' || ((theme ?? 'light') === 'system' && typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches);

/** Puts a person's theme, text size, spacing and accent colour on the page. Nothing here can fail the page: a bad value just means the default look. */
export function applyAppearance(theme: string | undefined, a: Appearance | undefined, company: AccentKey | undefined) {
  const root = document.documentElement;
  const look = a ?? DEFAULT_APPEARANCE;
  const t = theme ?? 'light';
  if (t === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t);
  root.setAttribute('data-density', look.density);
  root.style.setProperty('--tscale', String(SCALE[look.textSize] ?? 1));
  const c = ACCENTS[resolveAccent(look.accent, company ?? 'teal')];
  const dark = isDark(t);
  const v = dark ? c.dark : c.light;
  root.style.setProperty('--accent', v.accent);
  root.style.setProperty('--accent-soft', v.soft);
  root.style.setProperty('--accent-ink', dark ? '#06181b' : '#ffffff');
}
