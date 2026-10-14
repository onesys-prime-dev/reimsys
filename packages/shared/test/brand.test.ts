import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRAND, LOGO } from '../src/index';

const favicon = fs.readFileSync(path.resolve(__dirname, '../../../apps/web/public/favicon.svg'), 'utf8');

describe('the logo', () => {
  it('is the same in the favicon file as in the shared definition', () => {
    expect(favicon).toContain(`d="${LOGO.ring.d}"`);
    expect(favicon).toContain(`points="${LOGO.head.points.map(([x, y]) => `${x},${y}`).join(' ')}"`);
    expect(favicon).toContain(`d="${LOGO.peso.stem}"`);
    expect(favicon).toContain(`d="${LOGO.peso.bars}"`);
    expect(favicon).toContain(`stroke-width="${LOGO.ring.width}"`);
    expect(favicon).toContain(BRAND.tealLight);
    expect(favicon).toContain(BRAND.tealDark);
  });

  it('keeps the arrow head and ring inside the square with room to breathe', () => {
    for (const [x, y] of LOGO.head.points) {
      expect(Math.min(x, y)).toBeGreaterThanOrEqual(6);
      expect(Math.max(x, y)).toBeLessThanOrEqual(LOGO.size - 6);
    }
  });

  it('is called REIMSYS', () => {
    expect(BRAND.name).toBe('REIMSYS');
  });
});
