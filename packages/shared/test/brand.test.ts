import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRAND, LOGO } from '../src/index';

const favicon = fs.readFileSync(path.resolve(__dirname, '../../../apps/web/public/favicon.svg'), 'utf8');

describe('the logo', () => {
  it('is the same in the favicon file as in the shared definition', () => {
    expect(favicon).toContain(`d="${LOGO.tile}"`);
    expect(favicon).toContain(`d="${LOGO.fold.d}"`);
    for (const s of LOGO.strokes) expect(favicon).toContain(`<path d="${s.d}" stroke="${s.color}"/>`);
    expect(favicon).toContain(`stroke-width="${LOGO.strokeWidth}"`);
    expect(favicon).toContain(BRAND.tealLight);
    expect(favicon).toContain(BRAND.tealDark);
  });

  it('keeps the Y inside the tile with room to breathe', () => {
    for (const s of LOGO.strokes) {
      const nums = [...s.d.matchAll(/-?\d+(\.\d+)?/g)].map((m) => Number(m[0]));
      expect(Math.min(...nums)).toBeGreaterThanOrEqual(8);
      expect(Math.max(...nums)).toBeLessThanOrEqual(LOGO.size - 8);
    }
  });

  it('keeps the ends of the Y clear of the folded corner', () => {
    // the fold starts at x=50 along the top edge; the right arm must end well to its left and below it
    const end = LOGO.strokes[0]!.d.match(/M(\d+(?:\.\d+)?) (\d+(?:\.\d+)?)/)!;
    expect(Number(end[1]) + LOGO.strokeWidth / 2).toBeLessThanOrEqual(50);
  });

  it('is called REIMSYS', () => {
    expect(BRAND.name).toBe('REIMSYS');
  });
});
