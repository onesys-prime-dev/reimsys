import type { Pt, Quad, Raster } from '../src/scan';

/* ---- made-up photos of a receipt on a table, from easy to nasty ---- */

export const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
export const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());

export const inside = (q: Pt[], x: number, y: number) => {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i]!, b = q[(i + 1) % 4]!;
    const c = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (c !== 0) { if (sign && Math.sign(c) !== sign) return false; sign = Math.sign(c); }
  }
  return true;
};

/** A rectangle w x h centred at (cx, cy), turned by `deg`, with a little perspective squeeze on the far side. */
export const receipt = (cx: number, cy: number, w: number, h: number, deg: number, squeeze = 0): Quad => {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const pts = [[-w / 2 + squeeze, -h / 2], [w / 2 - squeeze, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
  return pts.map(([x, y]) => ({ x: Math.round(cx + x! * c - y! * s), y: Math.round(cy + x! * s + y! * c) })) as Quad;
};

export interface Scene {
  w: number; h: number; quad: Quad;
  table: (x: number, y: number) => number;
  paper: (x: number, y: number) => number;
  /** dark text lines on the receipt */
  text?: boolean;
  /** things drawn on top of everything (a hand, a pen): a brightness, or null where there is nothing */
  overlay?: (x: number, y: number) => number | null;
  /** the receipt's real outline when it is not a straight-sided shape (a curled receipt) */
  shape?: (x: number, y: number) => boolean;
  blur?: number; noise?: number; seed?: number;
}

export const make = (s: Scene): Raster => {
  const r = rng(s.seed ?? 1);
  const g = new Float32Array(s.w * s.h);
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    const onPaper = s.shape ? s.shape(x, y) : inside(s.quad, x, y);
    let v = onPaper ? s.paper(x, y) : s.table(x, y);
    if (s.text && onPaper && (Math.floor(y / 11) % 2 === 0) && Math.floor(y / 11) % 5 !== 0) {
      // text-like rows inside the receipt, only in its middle part
      const cx = s.quad.reduce((t, p) => t + p.x, 0) / 4;
      if (Math.abs(x - cx) < 50 && Math.abs(y - s.h / 2) < 120) v -= 130;
    }
    const o = s.overlay?.(x, y);
    g[y * s.w + x] = o ?? v;
  }
  // soften the edges the way a lens does
  const rad = Math.round(s.blur ?? 1);
  const out = new Float32Array(g);
  if (rad > 0) {
    const tmp = new Float32Array(g.length);
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) { let a = 0, n = 0; for (let d = -rad; d <= rad; d++) { const xx = Math.min(s.w - 1, Math.max(0, x + d)); a += g[y * s.w + xx]!; n++; } tmp[y * s.w + x] = a / n; }
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) { let a = 0, n = 0; for (let d = -rad; d <= rad; d++) { const yy = Math.min(s.h - 1, Math.max(0, y + d)); a += tmp[yy * s.w + x]!; n++; } out[y * s.w + x] = a / n; }
  }
  const data = new Uint8ClampedArray(s.w * s.h * 4);
  for (let i = 0; i < out.length; i++) {
    const v = out[i]! + (s.noise ? gauss(r) * s.noise : 0);
    data[i * 4] = v; data[i * 4 + 1] = v * 0.98; data[i * 4 + 2] = v * 0.94; data[i * 4 + 3] = 255;
  }
  return { data, width: s.w, height: s.h };
};

export const flat = (v: number) => () => v;
export const worstCorner = (found: Quad, truth: Quad) => Math.max(...found.map((p, i) => Math.hypot(p.x - truth[i]!.x, p.y - truth[i]!.y)));
/** Each corner within 3% of the picture's diagonal. */
export const tolerance = (w: number, h: number) => 0.03 * Math.hypot(w, h);

/** Smooth patchy brightness, like clutter and uneven light on a table. */
export const clouds = (base: number, amp: number, seed: number) => {
  const r = rng(seed); const f = Array.from({ length: 6 }, () => [r() * 0.05 + 0.01, r() * 0.05 + 0.01, r() * 6.28, r() * 6.28]);
  return (x: number, y: number) => base + amp * f.reduce((t, [a, b, p, q]) => t + Math.sin(x * a! + p!) * Math.sin(y * b! + q!), 0) / 3;
};
export const finger = (cx: number, cy: number, rx: number, ry: number) => (x: number, y: number) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 1;
export const handQuad = receipt(240, 170, 230, 290, 6, 8);
export const bowQuad = receipt(240, 180, 240, 290, 4, 0);

export const SCENES: { name: string; scene: Scene }[] = [
  { name: 'a bright receipt on a dark table', scene: { w: 480, h: 360, quad: receipt(240, 180, 250, 290, 12, 10), table: flat(35), paper: flat(225), blur: 1, noise: 3 } },
  { name: 'a white receipt on a light table (low contrast)', scene: { w: 480, h: 360, quad: receipt(240, 180, 230, 280, -9, 8), table: flat(205), paper: flat(240), blur: 2, noise: 4 } },
  { name: 'a receipt with print on a striped wooden table', scene: { w: 480, h: 360, quad: receipt(240, 180, 220, 290, -18), table: (x, y) => 135 + 22 * Math.sin(y * 0.55 + x * 0.04), paper: flat(236), text: true, blur: 1, noise: 4 } },
  { name: 'a receipt in shadow, darker on one side', scene: { w: 480, h: 360, quad: receipt(240, 180, 250, 290, 7, 6), table: flat(70), paper: (x) => 235 - (x - 120) * 0.38, blur: 1, noise: 3 } },
  { name: 'a long narrow shop receipt on a grey desk', scene: { w: 360, h: 560, quad: receipt(180, 280, 120, 480, 8, 4), table: flat(165), paper: flat(242), text: true, blur: 1, noise: 4 } },
  { name: 'a receipt on a checked tablecloth', scene: { w: 480, h: 360, quad: receipt(240, 180, 230, 280, 15), table: (x, y) => 188 + 9 * ((Math.floor(x / 16) + Math.floor(y / 16)) % 2 ? 1 : -1), paper: flat(244), blur: 1, noise: 3 } },
  { name: 'a noisy photo taken in poor light', scene: { w: 480, h: 360, quad: receipt(240, 180, 240, 280, -6, 6), table: flat(50), paper: flat(150), blur: 2, noise: 11 } },
  { name: 'a receipt under uneven light: bright table on one side, dark on the other', scene: { w: 480, h: 360, quad: receipt(240, 180, 230, 290, -8, 6), table: (x) => 80 + x * 0.27, paper: flat(238), blur: 1, noise: 4 } },
  { name: 'a receipt on a cluttered table with patchy brightness', scene: { w: 480, h: 360, quad: receipt(240, 180, 230, 290, 10, 6), table: clouds(125, 70, 5), paper: flat(236), text: true, blur: 1, noise: 4 } },
  { name: 'a receipt held by fingers that cover two of its corners', scene: { w: 480, h: 360, quad: handQuad, table: flat(60), paper: flat(240), blur: 1, noise: 3, overlay: (() => { const a = finger(handQuad[3].x + 8, handQuad[3].y - 4, 34, 30), b = finger(handQuad[2].x - 8, handQuad[2].y - 4, 34, 30); return (x: number, y: number) => (a(x, y) || b(x, y) ? 172 : null); })() } },
  { name: 'a curled receipt whose sides bow outwards', scene: { w: 480, h: 360, quad: bowQuad, table: flat(70), paper: flat(236), blur: 1, noise: 3, shape: (x, y) => { const q = bowQuad; if (!inside(q, x, y)) { const cx = (q[0].x + q[2].x) / 2, cy = (q[0].y + q[2].y) / 2; const dx = x - cx, dy = y - cy; return Math.abs(dx) < 122 + 6 * Math.cos((dy / 150) * 1.4) * Math.cos((dy / 150) * 1.4) && Math.abs(dy) < 146 && inside(q.map((p) => ({ x: p.x + Math.sign(p.x - cx) * 5, y: p.y + Math.sign(p.y - cy) * 5 })), x, y); } return true; } } },
  { name: 'a very faint white receipt on a light table', scene: { w: 480, h: 360, quad: receipt(240, 180, 230, 290, -9, 8), table: flat(226), paper: flat(240), blur: 2, noise: 5 } },
  // The real clip that exposed it: the desk and the receipt are nearly the same tone on the left, and compression makes vertical stripes.
  { name: 'a white receipt on a light desk where one side almost disappears, with compression stripes', scene: { w: 640, h: 360, quad: receipt(320, 180, 225, 270, 4, 5), table: (x) => Math.round((214 * (1 - 0.35 * (x / 640))) / 8) * 8, paper: (x) => Math.round((243 * (1 - 0.35 * (x / 640))) / 5) * 5 - 6, blur: 1, noise: 2.5 } },
  { name: 'a receipt turned diagonally', scene: { w: 480, h: 360, quad: receipt(240, 180, 190, 280, 38, 4), table: flat(55), paper: flat(232), blur: 1, noise: 4 } },
  { name: 'a receipt that nearly fills the picture', scene: { w: 480, h: 360, quad: receipt(240, 180, 400, 330, 2, 6), table: flat(60), paper: flat(236), blur: 1, noise: 4 } },
  { name: 'a receipt photographed at a steep angle (strong perspective)', scene: { w: 480, h: 360, quad: receipt(240, 180, 270, 280, -4, 55), table: flat(95), paper: flat(238), blur: 1, noise: 4 } },
  { name: 'a receipt on ruled notebook paper', scene: { w: 480, h: 360, quad: receipt(240, 180, 220, 290, 9), table: (_x: number, y: number) => 205 + (y % 12 < 2 ? -22 : 0), paper: flat(248), blur: 1, noise: 3 } },
  { name: 'a receipt on a strongly grained wooden table', scene: { w: 480, h: 360, quad: receipt(240, 180, 230, 290, -12), table: (x: number, y: number) => 120 + 38 * Math.sin(x * 0.12 + Math.sin(y * 0.05) * 3) * Math.sin(y * 0.4), paper: flat(240), text: true, blur: 1, noise: 5 } },
  { name: 'a receipt with a soft shadow of the phone across the table', scene: { w: 480, h: 360, quad: receipt(250, 180, 220, 290, 5), table: (x) => 190 - Math.max(0, 120 - x) * 0.5, paper: flat(246), blur: 2, noise: 3 } },
];

