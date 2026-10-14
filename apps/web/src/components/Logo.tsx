import { useId } from 'react';
import { BRAND, LOGO } from '@reimsis/shared';

/** The REIMSYS mark. Size is in pixels. It carries its own background, so it looks right on light and dark pages. */
export function LogoMark({ size = 32 }: { size?: number }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox={`0 0 ${LOGO.size} ${LOGO.size}`} role="img" aria-label={BRAND.name} style={{ display: 'block', flex: 'none' }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={BRAND.tealLight} />
          <stop offset="1" stopColor={BRAND.tealDark} />
        </linearGradient>
      </defs>
      <path d={LOGO.tile} fill={`url(#${id})`} />
      <path d={LOGO.fold.d} fill={BRAND.white} fillOpacity={LOGO.fold.opacity} />
      <g fill="none" strokeWidth={LOGO.strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        {LOGO.strokes.map((s) => <path key={s.d} d={s.d} stroke={s.color} />)}
      </g>
    </svg>
  );
}

/** The name. In REIMSYS the Y is picked out in the brand colour, echoing the mark. */
export function Wordmark({ name = BRAND.name, size = 18 }: { name?: string; size?: number }) {
  const yAt = name === BRAND.name ? name.lastIndexOf('Y') : -1;
  return (
    <b style={{ font: `700 ${size}px var(--display)`, letterSpacing: '.03em', color: 'var(--ink)' }}>
      {yAt < 0 ? name : <>{name.slice(0, yAt)}<span style={{ color: 'var(--accent)' }}>Y</span>{name.slice(yAt + 1)}</>}
    </b>
  );
}

/** Mark plus the name. */
export function Logo({ size = 32, name = BRAND.name }: { size?: number; name?: string }) {
  return (
    <span className="brand-lockup" style={{ display: 'inline-flex', alignItems: 'center', gap: Math.round(size * 0.32) }}>
      <LogoMark size={size} />
      <Wordmark name={name} size={Math.round(size * 0.56)} />
    </span>
  );
}
