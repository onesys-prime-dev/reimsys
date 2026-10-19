/**
 * The maths behind "Scan receipt": find the receipt in a photo, cut it out straight, and clean it up.
 * Plain functions on pixel data (no browser objects), so they can be tested with made-up images.
 */
import { edgeQuad, findEdges, scoreCorners, type Corners } from './scanEdges';

export interface Pt { x: number; y: number }
/** Corners in reading order: top left, top right, bottom right, bottom left. */
export type Quad = [Pt, Pt, Pt, Pt];
/** RGBA pixels, like a canvas ImageData. */
export interface Raster { data: Uint8ClampedArray; width: number; height: number }
export type ScanMode = 'original' | 'document' | 'bw';

const wholePhoto = (w: number, h: number): Quad => [{ x: 0, y: 0 }, { x: w - 1, y: 0 }, { x: w - 1, y: h - 1 }, { x: 0, y: h - 1 }];

/** Brightness of each pixel, shrunk so that the biggest side is about `side` pixels. */
function smallGray(img: Raster, side: number) {
  const k = Math.max(1, Math.floor(Math.max(img.width, img.height) / side));
  const w = Math.max(1, Math.floor(img.width / k)), h = Math.max(1, Math.floor(img.height / k));
  const gray = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) {
      const i = ((y * k + dy) * img.width + (x * k + dx)) * 4;
      s += img.data[i]! * 0.299 + img.data[i + 1]! * 0.587 + img.data[i + 2]! * 0.114; n++;
    }
    gray[y * w + x] = Math.round(s / n);
  }
  return { gray, w, h, k };
}

/** The brightness that best splits the picture into "dark background" and "bright paper" (Otsu's method). */
function otsu(gray: Uint8Array) {
  const hist = new Array<number>(256).fill(0);
  for (const g of gray) hist[g]!++;
  const total = gray.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i]!;
  let wB = 0, sumB = 0, best = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]!;
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t]!;
    const between = wB * wF * (sumB / wB - (sumAll - sumB) / wF) ** 2;
    if (between > best) { best = between; threshold = t; }
  }
  return { threshold, best: best / (total * total) };
}

/**
 * Looks for the receipt: the biggest bright patch in the photo. Returns its four corners in the photo's own pixels.
 * When nothing stands out (a white receipt on a white desk, a photo of only the receipt) it returns the whole photo,
 * and the person drags the corners themselves.
 */
export function detectQuad(img: Raster): Quad {
  return findQuad(img) ?? wholePhoto(img.width, img.height);
}

/**
 * Like detectQuad, but says "nothing found" (null) instead of falling back to the whole photo. The live camera needs to know.
 * `trim` is how far (as a share of the way to the middle) the corners are pulled inside the receipt's edge: 0 hugs it.
 */
export function findQuad(img: Raster, trim = 0.03): Quad | null {
  return locate(img, trim, false)?.quad ?? null;
}

/**
 * For the live camera: the receipt, and whether it is a sure find. When no sure find is made, a fainter outline is offered
 * with `sure: false`; the camera shows it only when it is found again in about the same place (a pattern on the table does not
 * keep producing the same outline, a receipt does).
 */
export function findQuadLive(img: Raster, trim = 0.03): { quad: Quad; sure: boolean } | null {
  return locate(img, trim, true);
}

function locate(img: Raster, trim: number, allowFaint: boolean): { quad: Quad; sure: boolean } | null {
  const { gray, w, h, k } = smallGray(img, 320);
  const edges = findEdges(gray, w, h);
  // 1. By the receipt's edges: the lines that make its sides. Works on a light table, in shadow, with a finger over a corner.
  let corners: Corners | null = edgeQuad(gray, w, h, edges)?.corners ?? null;
  // 2. By "the biggest bright shape", only trusted when real edges run along all four of its sides.
  const blob = corners ? null : blobCorners(gray, w, h);
  if (!corners && blob && scoreCorners(blob, edges) > 0) corners = blob;
  let sure = true;
  // 3. Live only: a fainter outline, which the caller must see twice before trusting.
  if (!corners && allowFaint) {
    const faint = findEdges(gray, w, h, true);
    corners = edgeQuad(gray, w, h, faint, true)?.corners ?? (blob && scoreCorners(blob, faint, true) > 0 ? blob : null);
    sure = false;
  }
  if (!corners) return null;
  const up = (p: { x: number; y: number }): Pt => ({ x: Math.min(img.width - 1, Math.max(0, Math.round((p.x + 0.5) * k))), y: Math.min(img.height - 1, Math.max(0, Math.round((p.y + 0.5) * k))) });
  const q = corners.map(up) as Quad;
  // The edge of a photographed receipt is soft and ragged, so cut a little inside it rather than keep a rim of the table.
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4, cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  const pull = (p: Pt): Pt => ({ x: Math.round(p.x + (cx - p.x) * trim), y: Math.round(p.y + (cy - p.y) * trim) });
  return { quad: q.map(pull) as Quad, sure };
}

/** The older method: the biggest bright patch in the picture and its four extreme points. Returns corners in the small picture. */
function blobCorners(gray: Uint8Array, w: number, h: number): Corners | null {
  const { threshold, best } = otsu(gray);
  // Two clearly different brightnesses are needed; otherwise there is nothing to find.
  if (best < 18) return null;
  const bright = new Uint8Array(w * h);
  let count = 0;
  for (let i = 0; i < gray.length; i++) if (gray[i]! > threshold) { bright[i] = 1; count++; }
  if (count < w * h * 0.12 || count > w * h * 0.97) return null;

  // Keep only the biggest connected bright patch, so specks and a bright window do not count.
  const label = new Int32Array(w * h);
  let bestLabel = 0, bestSize = 0, next = 0;
  const stack: number[] = [];
  for (let s0 = 0; s0 < bright.length; s0++) {
    if (!bright[s0] || label[s0]) continue;
    next++;
    let size = 0;
    stack.push(s0); label[s0] = next;
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const x = p % w, y = (p - x) / w;
      if (x > 0 && bright[p - 1] && !label[p - 1]) { label[p - 1] = next; stack.push(p - 1); }
      if (x < w - 1 && bright[p + 1] && !label[p + 1]) { label[p + 1] = next; stack.push(p + 1); }
      if (y > 0 && bright[p - w] && !label[p - w]) { label[p - w] = next; stack.push(p - w); }
      if (y < h - 1 && bright[p + w] && !label[p + w]) { label[p + w] = next; stack.push(p + w); }
    }
    if (size > bestSize) { bestSize = size; bestLabel = next; }
  }
  if (bestSize < w * h * 0.12) return null;

  // The corners of a tilted rectangle are the points furthest along each diagonal.
  let tl = Infinity, br = -Infinity, tr = -Infinity, bl = Infinity;
  let pTL: Pt = { x: 0, y: 0 }, pBR: Pt = { x: 0, y: 0 }, pTR: Pt = { x: 0, y: 0 }, pBL: Pt = { x: 0, y: 0 };
  for (let p = 0; p < label.length; p++) {
    if (label[p] !== bestLabel) continue;
    const x = p % w, y = (p - x) / w;
    if (x + y < tl) { tl = x + y; pTL = { x, y }; }
    if (x + y > br) { br = x + y; pBR = { x, y }; }
    if (x - y > tr) { tr = x - y; pTR = { x, y }; }
    if (x - y < bl) { bl = x - y; pBL = { x, y }; }
  }
  return [pTL, pTR, pBR, pBL];
}

/** Maps a point of the straight page, (0,0) top left to (1,1) bottom right, to where it is in the photo. Keeps perspective. */
export function quadMapper(q: Quad): (u: number, v: number) => Pt {
  const [p0, p1, p2, p3] = q;
  const sx = p0.x - p1.x + p2.x - p3.x, sy = p0.y - p1.y + p2.y - p3.y;
  let a: number, b: number, d: number, e: number, g = 0, h = 0;
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
    a = p1.x - p0.x; b = p3.x - p0.x; d = p1.y - p0.y; e = p3.y - p0.y;
  } else {
    const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dy1 = p1.y - p2.y, dy2 = p3.y - p2.y;
    const den = dx1 * dy2 - dx2 * dy1 || 1e-12;
    g = (sx * dy2 - dx2 * sy) / den;
    h = (dx1 * sy - sx * dy1) / den;
    a = p1.x - p0.x + g * p1.x; b = p3.x - p0.x + h * p3.x;
    d = p1.y - p0.y + g * p1.y; e = p3.y - p0.y + h * p3.y;
  }
  return (u, v) => {
    const w = g * u + h * v + 1;
    return { x: (a * u + b * v + p0.x) / w, y: (d * u + e * v + p0.y) / w };
  };
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Cuts the page out of the photo and straightens it. The result's longest side is at most `maxSide` pixels. */
export function warpToRect(img: Raster, q: Quad, maxSide = 2000): Raster {
  let w = Math.max(1, (dist(q[0], q[1]) + dist(q[3], q[2])) / 2), h = Math.max(1, (dist(q[0], q[3]) + dist(q[1], q[2])) / 2);
  const scale = Math.min(1, maxSide / Math.max(w, h));
  w = Math.max(1, Math.round(w * scale)); h = Math.max(1, Math.round(h * scale));
  const map = quadMapper(q);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = map(w > 1 ? x / (w - 1) : 0, h > 1 ? y / (h - 1) : 0);
    const fx = Math.min(img.width - 1, Math.max(0, p.x)), fy = Math.min(img.height - 1, Math.max(0, p.y));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(img.width - 1, x0 + 1), y1 = Math.min(img.height - 1, y0 + 1);
    const tx = fx - x0, ty = fy - y0;
    const o = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) {
      const top = img.data[(y0 * img.width + x0) * 4 + c]! * (1 - tx) + img.data[(y0 * img.width + x1) * 4 + c]! * tx;
      const bot = img.data[(y1 * img.width + x0) * 4 + c]! * (1 - tx) + img.data[(y1 * img.width + x1) * 4 + c]! * tx;
      out[o + c] = top * (1 - ty) + bot * ty;
    }
    out[o + 3] = 255;
  }
  return { data: out, width: w, height: h };
}

/** Average brightness around each pixel (a box of the given radius), via running sums. */
function localMean(gray: Float32Array, w: number, h: number, r: number) {
  const sum = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += gray[y * w + x]!; sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1]! + row; }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    const s = sum[y1 * (w + 1) + x1]! - sum[y0 * (w + 1) + x1]! - sum[y1 * (w + 1) + x0]! + sum[y0 * (w + 1) + x0]!;
    out[y * w + x] = s / ((x1 - x0) * (y1 - y0));
  }
  return out;
}

/**
 * "document": evens out shadows and uneven light so the paper is white and the print is dark, in grey tones.
 * "bw": the same, then pure black and white. "original": the photo as it is.
 */
export function enhance(img: Raster, mode: ScanMode): Raster {
  const out = new Uint8ClampedArray(img.data);
  if (mode === 'original') return { data: out, width: img.width, height: img.height };
  const { width: w, height: h } = img;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < gray.length; i++) gray[i] = img.data[i * 4]! * 0.299 + img.data[i * 4 + 1]! * 0.587 + img.data[i * 4 + 2]! * 0.114;
  // Paper brightness around each pixel; print is much darker than its surroundings, paper is about equal.
  const paper = localMean(gray, w, h, Math.max(8, Math.round(Math.max(w, h) / 12)));
  for (let i = 0; i < gray.length; i++) {
    const ratio = Math.min(1.15, gray[i]! / Math.max(1, paper[i]!));
    let v: number;
    if (mode === 'bw') v = ratio < 0.86 ? 0 : 255;
    else v = Math.max(0, Math.min(255, 255 * Math.min(1, Math.max(0, (ratio - 0.35) / 0.58))));
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v;
  }
  return { data: out, width: w, height: h };
}
