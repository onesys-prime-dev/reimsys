import { useId } from 'react';
import { BRAND, LOGO } from '@reimsis/shared';

/** The REIMSYS mark. Size is in pixels. It carries its own background, so it looks right on light and dark pages. */
export function LogoMark({ size = 32 }: { size?: number }) {
  const id = useId();
  const pts = LOGO.head.points.map(([x, y]) => `${x},${y}`).join(' ');
  return (
    <svg width={size} height={size} viewBox={`0 0 ${LOGO.size} ${LOGO.size}`} role="img" aria-label={BRAND.name} style={{ display: 'block', flex: 'none' }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={BRAND.tealLight} />
          <stop offset="1" stopColor={BRAND.tealDark} />
        </linearGradient>
      </defs>
      <rect width={LOGO.size} height={LOGO.size} rx={LOGO.radius} fill={`url(#${id})`} />
      <path d={LOGO.ring.d} fill="none" stroke={BRAND.white} strokeWidth={LOGO.ring.width} strokeLinecap="round" />
      <polygon points={pts} fill={BRAND.white} stroke={BRAND.white} strokeWidth={LOGO.head.width} strokeLinejoin="round" />
      <g fill="none" stroke={BRAND.white} strokeWidth={LOGO.peso.width} strokeLinecap="round" strokeLinejoin="round">
        <path d={LOGO.peso.stem} />
        <path d={LOGO.peso.bars} />
      </g>
    </svg>
  );
}

/** Mark plus the name. */
export function Logo({ size = 32, name = BRAND.name }: { size?: number; name?: string }) {
  return (
    <span className="brand-lockup" style={{ display: 'inline-flex', alignItems: 'center', gap: Math.round(size * 0.32) }}>
      <LogoMark size={size} />
      <b style={{ font: `700 ${Math.round(size * 0.56)}px var(--display)`, letterSpacing: '.03em', color: 'var(--ink)' }}>{name}</b>
    </span>
  );
}
