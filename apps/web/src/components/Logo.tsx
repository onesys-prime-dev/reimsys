import { useId } from 'react';
import { BRAND, LOGO } from '@reimsis/shared';

/** The REIMSIS mark. Size is in pixels. It carries its own background, so it looks right on light and dark pages. */
export function LogoMark({ size = 32 }: { size?: number }) {
  const id = useId();
  const [a, b, c] = LOGO.check.points;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${LOGO.size} ${LOGO.size}`} role="img" aria-label="REIMSIS" style={{ display: 'block', flex: 'none' }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={BRAND.tealLight} />
          <stop offset="1" stopColor={BRAND.tealDark} />
        </linearGradient>
      </defs>
      <rect width={LOGO.size} height={LOGO.size} rx={LOGO.radius} fill={`url(#${id})`} />
      <path d={LOGO.receipt} fill={BRAND.white} />
      {LOGO.lines.segments.map(([x1, y1, x2, y2], i) => (
        <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={BRAND.teal} strokeOpacity={LOGO.lines.opacity} strokeWidth={LOGO.lines.width} strokeLinecap="round" />
      ))}
      <polyline points={`${a![0]},${a![1]} ${b![0]},${b![1]} ${c![0]},${c![1]}`} fill="none" stroke={BRAND.teal} strokeWidth={LOGO.check.width} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Mark plus the name. */
export function Logo({ size = 32, name = 'REIMSIS' }: { size?: number; name?: string }) {
  return (
    <span className="brand-lockup" style={{ display: 'inline-flex', alignItems: 'center', gap: Math.round(size * 0.32) }}>
      <LogoMark size={size} />
      <b style={{ font: `700 ${Math.round(size * 0.56)}px var(--display)`, letterSpacing: '.03em', color: 'var(--ink)' }}>{name}</b>
    </span>
  );
}
