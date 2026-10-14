import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRAND, LOGO } from '../src/index';

const favicon = fs.readFileSync(path.resolve(__dirname, '../../../apps/web/public/favicon.svg'), 'utf8');

describe('the logo', () => {
  it('is the same in the favicon file as in the shared definition', () => {
    expect(favicon).toContain(`d="${LOGO.receipt}"`);
    const pts = LOGO.check.points.map(([x, y]) => `${x},${y}`).join(' ');
    expect(favicon).toContain(`points="${pts}"`);
    for (const [x1, y1, x2, y2] of LOGO.lines.segments) expect(favicon).toContain(`x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"`);
    expect(favicon).toContain(BRAND.tealLight);
    expect(favicon).toContain(BRAND.tealDark);
  });

  it('keeps everything inside the square with room to breathe', () => {
    const nums = [...LOGO.receipt.matchAll(/-?\d+(\.\d+)?/g)].map((m) => Number(m[0]));
    expect(Math.min(...nums)).toBeGreaterThanOrEqual(6);
    expect(Math.max(...nums)).toBeLessThanOrEqual(LOGO.size - 6);
  });
});
