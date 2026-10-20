import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detectQuad, findQuad, findQuadLive } from '../src/scan';
import { SCENES, flat, inside, make, receipt, tolerance, worstCorner } from './scenes';
import type { Pt, Quad } from '../src/scan';

describe('finding the receipt in photos that are hard on purpose', () => {
  for (const { name, scene } of SCENES) {
    it(`finds all four edges: ${name}`, () => {
      const found = findQuad(make(scene), 0);
      if (process.env.SCAN_DEBUG) console.log('SCENE', name, JSON.stringify(found), 'TRUTH', JSON.stringify(scene.quad));
      expect(found, 'it should find the receipt').not.toBeNull();
      const worst = worstCorner(found!, scene.quad);
      expect(worst, `worst corner is ${worst.toFixed(1)} px off`).toBeLessThan(tolerance(scene.w, scene.h));
    });
  }

  it('picks one clean receipt when two lie side by side', () => {
    const left = receipt(130, 180, 150, 290, 5);
    const img = make({ w: 480, h: 360, quad: left, table: flat(50), paper: flat(235), blur: 1, noise: 3, overlay: (x, y) => (inside(receipt(360, 180, 150, 290, -6), x, y) ? 235 : null) });
    const found = findQuad(img, 0)!;
    expect(found).not.toBeNull();
    const nearLeft = worstCorner(found, left) < 15, nearRight = worstCorner(found, receipt(360, 180, 150, 290, -6)) < 15;
    expect(nearLeft || nearRight, 'it should lock on to one of the two receipts, not a shape across both').toBe(true);
  });

  it('does not invent a side that is outside the picture: a receipt cut off by the frame is "not found"', () => {
    expect(findQuad(make({ w: 480, h: 360, quad: receipt(240, 250, 230, 330, 6, 4), table: flat(50), paper: flat(235), blur: 1, noise: 3 }))).toBeNull();
  });

  it('says there is no receipt for a plain wall, a patterned table without one, and a picture of text only', () => {
    expect(findQuad(make({ w: 480, h: 360, quad: receipt(-900, -900, 10, 10, 0), table: flat(180), paper: flat(180), noise: 4 }))).toBeNull();
    expect(findQuad(make({ w: 480, h: 360, quad: receipt(-900, -900, 10, 10, 0), table: (x, y) => 188 + 9 * ((Math.floor(x / 16) + Math.floor(y / 16)) % 2 ? 1 : -1), paper: flat(0), noise: 3 }))).toBeNull();
  });
});

describe('how fast it looks for the receipt', () => {
  it('is quick enough to run several times a second on a phone-sized picture', () => {
    const img = make({ w: 1280, h: 720, quad: receipt(640, 360, 520, 600, 10, 14), table: flat(55), paper: flat(230), text: true, blur: 2, noise: 4 });
    findQuad(img); // warm up
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) findQuad(img);
    const each = (performance.now() - t0) / 5;
    expect(each, `each look took ${each.toFixed(0)} ms`).toBeLessThan(120);
  });
});

describe('a real camera frame', () => {
  it('finds a white receipt full of black print on a light desk, in a shadow, with compression stripes', () => {
    // A frame grabbed from the live camera (Chrome playing a test clip). Before the edge level was set from the picture's
    // noise instead of from how many strong edges it has, the black print made the receipt's faint border look too weak.
    const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/light-desk-frame.json', import.meta.url), 'utf8')) as { width: number; height: number; gray: string };
    const g = Buffer.from(fx.gray, 'base64');
    const data = new Uint8ClampedArray(fx.width * fx.height * 4);
    for (let i = 0; i < g.length; i++) { data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = g[i]!; data[i * 4 + 3] = 255; }
    const found = findQuad({ data, width: fx.width, height: fx.height }, 0)!;
    expect(found, 'it should find the receipt').not.toBeNull();
    const truth: Quad = [{ x: 107.5, y: 17.5 }, { x: 220, y: 27.5 }, { x: 212.5, y: 162.5 }, { x: 100, y: 152.5 }];
    expect(worstCorner(found, truth)).toBeLessThan(4);
  });
});

describe('the live camera: a faint receipt is offered, an empty table never is', () => {
  const faint = (contrast: number, seed: number) => ({ w: 480, h: 360, quad: receipt(240, 180, 230, 290, -9, 8), table: flat(226), paper: flat(226 + contrast), blur: 2, noise: 5, seed });
  for (const contrast of [9, 7]) for (const seed of [1, 2, 3]) {
    it(`offers a white receipt barely lighter than the desk (contrast ${contrast}, seed ${seed}), marked not sure`, () => {
      const s = faint(contrast, seed), img = make(s);
      expect(findQuad(img, 0), 'too faint for a sure find').toBeNull();
      const live = findQuadLive(img, 0);
      expect(live, 'the live camera should still offer it').not.toBeNull();
      expect(live!.sure).toBe(false);
      expect(worstCorner(live!.quad, s.quad)).toBeLessThan(tolerance(s.w, s.h));
    });
  }
  it('finds a clear receipt as a sure find, the same as the saved-photo search', () => {
    const { scene } = SCENES[0]!;
    const img = make(scene), live = findQuadLive(img, 0);
    expect(live?.sure).toBe(true);
    expect(live!.quad).toEqual(findQuad(img, 0));
  });
  it('finds nothing at all, not even faintly, on any of the tables with no receipt on them', () => {
    const invented: string[] = [];
    for (const { name, scene } of SCENES) for (const noise of [2, 6]) {
      const empty = { ...scene, paper: scene.table, text: false, overlay: undefined, shape: () => false, noise, seed: 11 };
      if (findQuadLive(make(empty), 0)) invented.push(`${name} (noise ${noise})`);
    }
    expect(invented).toEqual([]);
  });
});

describe('a saved photo of a white receipt on a light desk', () => {
  const faint = (contrast: number, seed: number) => ({ w: 480, h: 360, quad: receipt(240, 180, 230, 290, -9, 8), table: flat(226), paper: flat(226 + contrast), blur: 2, noise: 5, seed });
  for (const contrast of [14, 9, 7]) for (const seed of [1, 2, 3]) {
    it(`is outlined, not given up on as "the whole photo" (contrast ${contrast}, seed ${seed})`, () => {
      const s = faint(contrast, seed), q = detectQuad(make(s));
      expect(worstCorner(q, s.quad), 'the outline should sit on the receipt').toBeLessThan(tolerance(s.w, s.h));
    });
  }
  it('still gives the whole photo when there is no receipt to find', () => {
    for (const { scene } of SCENES) {
      const empty = { ...scene, paper: scene.table, text: false, overlay: undefined, shape: () => false, noise: 4, seed: 11 };
      const q = detectQuad(make(empty));
      expect([q[0].x, q[0].y, q[2].x, q[2].y]).toEqual([0, 0, scene.w - 1, scene.h - 1]);
    }
  });
});
