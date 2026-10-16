import { describe, expect, it } from 'vitest';
import { detectQuad, enhance, quadMapper, warpToRect, type Pt, type Raster } from '../src/scan';

const raster = (width: number, height: number, fn: (x: number, y: number) => number | [number, number, number]): Raster => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const v = fn(x, y);
    const [r, g, b] = typeof v === 'number' ? [v, v, v] : v;
    const i = (y * width + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  return { data, width, height };
};
const px = (img: Raster, x: number, y: number) => img.data[(Math.round(y) * img.width + Math.round(x)) * 4]!;
/** Point inside a convex quad given clockwise from the top left. */
const inside = (q: Pt[], x: number, y: number) => {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i]!, b = q[(i + 1) % 4]!;
    const c = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (c !== 0) { if (sign && Math.sign(c) !== sign) return false; sign = Math.sign(c); }
  }
  return true;
};
const near = (a: Pt, b: Pt, tol: number) => Math.hypot(a.x - b.x, a.y - b.y) <= tol;

describe('finding the receipt in a photo', () => {
  const truth: Pt[] = [{ x: 90, y: 40 }, { x: 330, y: 70 }, { x: 305, y: 270 }, { x: 60, y: 245 }];

  it('finds the four corners of a tilted receipt on a dark table, in order', () => {
    const img = raster(400, 300, (x, y) => (inside(truth, x, y) ? 225 : 35));
    const q = detectQuad(img);
    q.forEach((p, i) => expect(near(p, truth[i]!, 8), `corner ${i}: ${JSON.stringify(p)}`).toBe(true));
  });

  it('is not pulled off by a bright speck far from the receipt', () => {
    const img = raster(400, 300, (x, y) => (inside(truth, x, y) || (x > 380 && x < 384 && y > 5 && y < 9) ? 225 : 35));
    const q = detectQuad(img);
    q.forEach((p, i) => expect(near(p, truth[i]!, 8), `corner ${i}`).toBe(true));
  });

  it('falls back to the whole photo when there is nothing to tell apart', () => {
    const img = raster(400, 300, () => 200);
    expect(detectQuad(img)).toEqual([{ x: 0, y: 0 }, { x: 399, y: 0 }, { x: 399, y: 299 }, { x: 0, y: 299 }]);
  });

  it('falls back to the whole photo when the "receipt" is only a small blob', () => {
    const img = raster(400, 300, (x, y) => (x > 100 && x < 130 && y > 100 && y < 130 ? 230 : 40));
    expect(detectQuad(img)[2]).toEqual({ x: 399, y: 299 });
  });
});

describe('straightening', () => {
  it('maps the corners of the page and its middle to the right places, even with perspective', () => {
    const quad: [Pt, Pt, Pt, Pt] = [{ x: 90, y: 40 }, { x: 330, y: 70 }, { x: 305, y: 270 }, { x: 60, y: 245 }];
    const m = quadMapper(quad);
    expect(m(0, 0)).toEqual({ x: 90, y: 40 });
    const tr = m(1, 0), br = m(1, 1), bl = m(0, 1);
    expect(near(tr, quad[1], 1e-6) && near(br, quad[2], 1e-6) && near(bl, quad[3], 1e-6)).toBe(true);
    // the middle of the page is where the two diagonals cross
    const d1 = { x: quad[2].x - quad[0].x, y: quad[2].y - quad[0].y }, d2 = { x: quad[3].x - quad[1].x, y: quad[3].y - quad[1].y };
    const t = ((quad[1].x - quad[0].x) * d2.y - (quad[1].y - quad[0].y) * d2.x) / (d1.x * d2.y - d1.y * d2.x);
    expect(near(m(0.5, 0.5), { x: quad[0].x + t * d1.x, y: quad[0].y + t * d1.y }, 1e-6)).toBe(true);
  });

  it('cuts a straight page out of a tilted photo', () => {
    // Pixel value = how far along the page (left to right) the point is. A correct straightening gives a clean left-to-right ramp.
    const quad: [Pt, Pt, Pt, Pt] = [{ x: 100, y: 50 }, { x: 300, y: 80 }, { x: 280, y: 250 }, { x: 80, y: 220 }];
    const m = quadMapper(quad);
    const src = raster(400, 300, (x, y) => {
      if (!inside(quad, x, y)) return 0;
      let best = 0, bestD = Infinity;
      for (let u = 0; u <= 1; u += 0.01) { const p = m(u, 0.5); const d = Math.hypot(p.x - x, p.y - y); if (d < bestD) { bestD = d; best = u; } }
      return Math.round(best * 255);
    });
    const out = warpToRect(src, quad, 400);
    expect(out.width).toBeGreaterThan(150);
    expect(out.height).toBeGreaterThan(150);
    const y = Math.floor(out.height / 2);
    expect(px(out, out.width * 0.1, y)).toBeLessThan(60);
    expect(Math.abs(px(out, out.width * 0.5, y) - 128)).toBeLessThan(40);
    expect(px(out, out.width * 0.9, y)).toBeGreaterThan(195);
  });

  it('never makes the page bigger than the limit', () => {
    const src = raster(300, 300, () => 255);
    const out = warpToRect(src, [{ x: 0, y: 0 }, { x: 299, y: 0 }, { x: 299, y: 299 }, { x: 0, y: 299 }], 120);
    expect(Math.max(out.width, out.height)).toBe(120);
  });
});

describe('cleaning up the page', () => {
  // grey paper that is darker on the right (a shadow), with a black line of "text" in the middle
  const page = () => raster(200, 100, (x, y) => (y >= 48 && y <= 51 && x > 20 && x < 180 ? 20 : 220 - Math.round(x * 0.5)));

  it('leaves the original alone', () => {
    const img = page();
    expect(enhance(img, 'original').data).toEqual(img.data);
  });

  it('"document" evens out the shadow and keeps the text dark', () => {
    const out = enhance(page(), 'document');
    expect(px(out, 10, 10)).toBeGreaterThan(225);
    expect(px(out, 190, 10)).toBeGreaterThan(225);
    expect(px(out, 100, 49)).toBeLessThan(110);
  });

  it('"black and white" gives only black and white, with the text black', () => {
    const out = enhance(page(), 'bw');
    const values = new Set<number>();
    for (let i = 0; i < out.data.length; i += 4) values.add(out.data[i]!);
    expect([...values].sort((a, b) => a - b)).toEqual([0, 255]);
    expect(px(out, 100, 49)).toBe(0);
    expect(px(out, 190, 10)).toBe(255);
  });

  it('keeps the size and does not change the input', () => {
    const img = page();
    const copy = img.data.slice();
    const out = enhance(img, 'document');
    expect([out.width, out.height]).toEqual([200, 100]);
    expect(img.data).toEqual(copy);
  });
});

describe('the cut-out page', () => {
  it('has no rim of the dark table around its edges', () => {
    const truth: Pt[] = [{ x: 90, y: 40 }, { x: 330, y: 70 }, { x: 305, y: 270 }, { x: 60, y: 245 }];
    const img = raster(400, 300, (x, y) => (inside(truth, x, y) ? 225 : 35));
    const out = warpToRect(img, detectQuad(img), 600);
    let darkest = 255;
    for (let x = 0; x < out.width; x++) darkest = Math.min(darkest, px(out, x, 0), px(out, x, out.height - 1));
    for (let y = 0; y < out.height; y++) darkest = Math.min(darkest, px(out, 0, y), px(out, out.width - 1, y));
    expect(darkest).toBeGreaterThan(200);
  });
});
