/**
 * Finding a receipt by its EDGES: look for strong edges, find the straight lines in them (Hough transform), then pick the
 * four lines that best make a receipt-shaped four-sided shape, judged by how much real edge lies along each side.
 * Because the corners come from where lines meet, a corner hidden by a finger or lost in shadow is still found.
 * Works on a small grey picture (about 320 pixels across). Plain functions, no browser objects.
 */
export interface P { x: number; y: number }
export type Corners = [P, P, P, P];

interface Edges { w: number; h: number; strongCount: number; xs: Int16Array; ys: Int16Array; ang: Uint8Array; near: Uint16Array }
interface Line { theta: number; rho: number; votes: number } // theta in degrees 0..179, the direction the edge's brightness changes in
/** "no edge here" in `near`, which otherwise holds the edge's brightness direction in degrees, 0..359. */
const NONE = 65535;
const angleGap = (a: number, b: number) => { const d = Math.abs(a - b) % 180; return Math.min(d, 180 - d); };
const RAD = Math.PI / 180;

/** Smooths the picture a little so that grain does not look like edges. */
function blur(gray: Uint8Array, w: number, h: number): Float32Array {
  const k = [1, 4, 6, 4, 1], tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let d = -2; d <= 2; d++) s += gray[y * w + Math.min(w - 1, Math.max(0, x + d))]! * k[d + 2]!;
    tmp[y * w + x] = s / 16;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let d = -2; d <= 2; d++) s += tmp[Math.min(h - 1, Math.max(0, y + d)) * w + x]! * k[d + 2]!;
    out[y * w + x] = s / 16;
  }
  return out;
}

/** `sensitive` also keeps fainter edges (a white receipt on a light desk); used only for the live camera's second look. */
function findEdges(gray: Uint8Array, w: number, h: number, sensitive = false): Edges {
  const p = blur(gray, w, h), n = w * h;
  const mag = new Float32Array(n), angf = new Float32Array(n);
  let maxMag = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = p[i - w + 1]! + 2 * p[i + 1]! + p[i + w + 1]! - p[i - w - 1]! - 2 * p[i - 1]! - p[i + w - 1]!;
    const gy = p[i + w - 1]! + 2 * p[i + w]! + p[i + w + 1]! - p[i - w - 1]! - 2 * p[i - w]! - p[i - w + 1]!;
    const m = Math.hypot(gx, gy);
    mag[i] = m; angf[i] = Math.atan2(gy, gx);
    if (m > maxMag) maxMag = m;
  }
  // How noisy the picture is: the typical gradient in the flat parts (edges are too few to move the median).
  const bins = new Uint32Array(512);
  for (let i = 0; i < n; i++) bins[Math.min(511, Math.floor((mag[i]! / (maxMag || 1)) * 511))]!++;
  let med = 0;
  for (let b = 0, a = 0; b < 512; b++) { a += bins[b]!; if (a >= n * 0.5) { med = (b / 511) * maxMag; break; } }
  // An edge counts when it is clearly above the picture's own noise. This must NOT depend on how many strong edges there
  // are (a receipt full of black print would otherwise push the bar so high that its faint border is thrown away).
  // Weak edges (down to Tlow) are kept only when they join up with a strong one.
  const Tlow = sensitive ? Math.max(4, 1.8 * med) : Math.max(6, 2.5 * med);
  const T = sensitive ? Math.max(9, 1.7 * Tlow) : Math.max(14, 2.2 * Tlow);

  // the thin ridge of every edge (compare with the two neighbours along the direction the edge mostly runs)
  const cand: number[] = [], strong: boolean[] = [];
  const slot = new Int32Array(n).fill(-1);
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
    const i = y * w + x, m = mag[i]!;
    if (m < Tlow) continue;
    const mostlyAcross = Math.abs(Math.cos(angf[i]!)) >= Math.abs(Math.sin(angf[i]!));
    const step = mostlyAcross ? 1 : w;
    if (m < mag[i + step]! || m <= mag[i - step]!) continue;
    slot[i] = cand.length; cand.push(i); strong.push(m >= T);
  }
  // keep the strong ones, and any weak ones chained to them (within 2 pixels of each other)
  const keep = new Uint8Array(cand.length), queue: number[] = [];
  for (let c = 0; c < cand.length; c++) if (strong[c]) { keep[c] = 1; queue.push(c); }
  while (queue.length) {
    const c = queue.pop()!, i = cand[c]!, x = i % w, y = (i - x) / w;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const yy = y + dy, xx = x + dx;
      if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue;
      const o = slot[yy * w + xx]!;
      if (o >= 0 && !keep[o] && angleGap(Math.round(angf[cand[o]!]! / RAD), Math.round(angf[i]! / RAD)) <= 30) { keep[o] = 1; queue.push(o); }
    }
  }
  const xs: number[] = [], ys: number[] = [], angs: number[] = [], dirs: number[] = [];
  const near = new Uint16Array(n).fill(NONE);
  for (let c = 0; c < cand.length; c++) {
    if (!keep[c]) continue;
    const i = cand[c]!, x = i % w, y = (i - x) / w;
    let a = Math.round(angf[i]! / RAD); a = ((a % 180) + 180) % 180;
    xs.push(x); ys.push(y); angs.push(a);
    dirs.push(((Math.round(angf[i]! / RAD) % 360) + 360) % 360);
  }
  const ang = Uint8Array.from(angs);
  for (let e = 0; e < xs.length; e++) {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const yy = ys[e]! + dy, xx = xs[e]! + dx;
      if (yy >= 0 && yy < h && xx >= 0 && xx < w) near[yy * w + xx] = dirs[e]!;
    }
  }
  return { w, h, strongCount: xs.length, xs: Int16Array.from(xs), ys: Int16Array.from(ys), ang, near };
}

/** Every edge point votes for the lines it could lie on; lines with many votes are real straight edges. */
export function findLines(e: Edges, maxLines: number, minVotesOverride?: number): Line[] {
  const { w, h } = e, diag = Math.ceil(Math.hypot(w, h)), nRho = 2 * diag + 1;
  const acc = new Float32Array(180 * nRho);
  const cos = new Float32Array(360), sin = new Float32Array(360);
  for (let t = 0; t < 360; t++) { cos[t] = Math.cos((t - 90) * RAD); sin[t] = Math.sin((t - 90) * RAD); } // t = degrees + 90, so -90..269 is covered
  const vote = (x: number, y: number, deg: number, weight: number) => {
    const c = cos[deg + 90]!, s = sin[deg + 90]!;
    let rho = x * c + y * s, t = deg;
    if (t < 0) { t += 180; rho = -rho; } else if (t >= 180) { t -= 180; rho = -rho; }
    acc[t * nRho + Math.round(rho) + diag] += weight;
  };
  for (let i = 0; i < e.xs.length; i++) {
    const x = e.xs[i]!, y = e.ys[i]!, a = e.ang[i]!;
    // An edge's measured direction is noisy by a few degrees, so a point votes for every direction near its own.
    // Only the true direction makes all the points of one straight edge agree on the same line.
    for (let d = -3; d <= 3; d++) vote(x, y, a + d, 1);
  }
  // One straight edge never falls exactly into one cell: it spreads over a few neighbouring ones. Add them up (+-2 pixels).
  const sum = new Float32Array(acc.length);
  for (let t = 0; t < 180; t++) for (let ri = 0; ri < nRho; ri++) {
    let s = 0;
    for (let d = -2; d <= 2; d++) { const r = ri + d; if (r >= 0 && r < nRho) s += acc[t * nRho + r]!; }
    sum[t * nRho + ri] = s;
  }
  const at = (t: number, r: number) => {
    let tt = t, rr = r;
    if (tt < 0) { tt += 180; rr = -rr; } else if (tt >= 180) { tt -= 180; rr = -rr; }
    const ri = rr + diag;
    return ri < 0 || ri >= nRho ? 0 : sum[tt * nRho + ri]!;
  };
  const minVotes = minVotesOverride ?? Math.max(20, 0.07 * Math.min(w, h));
  const found: Line[] = [];
  for (let t = 0; t < 180; t++) for (let ri = 0; ri < nRho; ri++) {
    const v = sum[t * nRho + ri]!;
    if (v < minVotes) continue;
    const rho = ri - diag;
    let best = true;
    for (let dt = -3; dt <= 3 && best; dt++) for (let dr = -4; dr <= 4; dr++) {
      if (!dt && !dr) continue;
      const o = at(t + dt, rho + dr);
      if (o > v || (o === v && (dt < 0 || (dt === 0 && dr < 0)))) { best = false; break; }
    }
    if (best) {
      // put the line at the centre of its votes, not at the cell that happened to hold the most
      let num = 0, den = 0;
      for (let d = -2; d <= 2; d++) { const r = ri + d; if (r >= 0 && r < nRho) { const a = acc[t * nRho + r]!; num += (r - diag) * a; den += a; } }
      found.push({ theta: t, rho: den ? num / den : rho, votes: v });
    }
  }
  return found.sort((a, b) => b.votes - a.votes).slice(0, maxLines);
}

const intersect = (a: Line, b: Line): P | null => {
  const ca = Math.cos(a.theta * RAD), sa = Math.sin(a.theta * RAD), cb = Math.cos(b.theta * RAD), sb = Math.sin(b.theta * RAD);
  const det = ca * sb - sa * cb;
  if (Math.abs(det) < 0.2) return null;
  return { x: (a.rho * sb - b.rho * sa) / det, y: (b.rho * ca - a.rho * cb) / det };
};
const distanceToLine = (p: P, l: Line) => Math.abs(p.x * Math.cos(l.theta * RAD) + p.y * Math.sin(l.theta * RAD) - l.rho);
const pointOn = (l: Line): P => ({ x: l.rho * Math.cos(l.theta * RAD), y: l.rho * Math.sin(l.theta * RAD) });

/**
 * Picks the lines worth trying. Many lines with similar votes (the rows of printed text, folds, a tablecloth's pattern) must
 * not push out the receipt's real borders, so lines are grouped by the direction they run in, and each group keeps its few
 * strongest lines AND the lines furthest out on either side, which is where a border always is.
 */
export function chooseLines(lines: Line[]): Line[] {
  const groups: Line[][] = [];
  for (const l of [...lines].sort((a, b) => b.votes - a.votes)) {
    const g = groups.find((grp) => angleGap(grp[0]!.theta, l.theta) <= 12);
    if (g) g.push(l); else groups.push([l]);
  }
  const chosen = new Set<Line>();
  for (const g of groups) {
    // the group's average direction (angles repeat every 180 degrees, so average them doubled)
    let sx = 0, sy = 0;
    for (const l of g) { sx += Math.cos(2 * l.theta * RAD); sy += Math.sin(2 * l.theta * RAD); }
    const mean = Math.atan2(sy, sx) / 2, nx = Math.cos(mean), ny = Math.sin(mean);
    const offset = (l: Line) => { const p = pointOn(l); return p.x * nx + p.y * ny; };
    const byOffset = [...g].sort((a, b) => offset(a) - offset(b));
    for (const l of g.slice(0, 10)) chosen.add(l);
    for (const l of byOffset.slice(0, 3)) chosen.add(l);
    for (const l of byOffset.slice(-3)) chosen.add(l);
  }
  return [...chosen];
}

/** The straight line that best fits the edge points lying along `line` (within 3 pixels and running the same way), or the line itself when too few. */
function refineLine(l: Line, e: Edges): Line {
  const c = Math.cos(l.theta * RAD), s = Math.sin(l.theta * RAD);
  let n = 0, mx = 0, my = 0;
  const hit: number[] = [];
  for (let i = 0; i < e.xs.length; i++) {
    if (Math.abs(e.xs[i]! * c + e.ys[i]! * s - l.rho) <= 3 && angleGap(e.ang[i]!, l.theta) <= 25) { hit.push(i); mx += e.xs[i]!; my += e.ys[i]!; n++; }
  }
  if (n < 15) return l;
  mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const i of hit) { const dx = e.xs[i]! - mx, dy = e.ys[i]! - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  // the line runs along the long axis of the points; its normal is across it
  const along = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let theta = ((along + Math.PI / 2) / RAD) % 180;
  if (theta < 0) theta += 180;
  return { theta, rho: mx * Math.cos(theta * RAD) + my * Math.sin(theta * RAD), votes: l.votes };
}

/** Re-fits the four lines to the edge points, and returns the corners where the refitted lines meet (the old corners if that goes wrong). */
function refine(corners: Corners, lines: Line[], e: Edges): Corners {
  const fit = lines.map((l) => refineLine(l, e));
  const pts = [intersect(fit[0]!, fit[1]!), intersect(fit[0]!, fit[3]!), intersect(fit[2]!, fit[3]!), intersect(fit[2]!, fit[1]!)];
  if (pts.some((p) => !p)) return corners;
  // lines are [a, c, b, d]; the original corners were a∩c, a∩d, b∩d, b∩c
  const out = [intersect(fit[0]!, fit[1]!), intersect(fit[0]!, fit[3]!), intersect(fit[2]!, fit[3]!), intersect(fit[2]!, fit[1]!)] as Corners;
  return out.every((p, i) => Math.hypot(p.x - corners[i]!.x, p.y - corners[i]!.y) <= 8) ? out : corners;
}

/** For each of the four sides: the share of its length that really has an edge along it, running the right way. 0 to 1. */
export function sideSupport(c: Corners, e: Edges, step = 1.5): number[] {
  return sideReport(c, e, step).map((r) => r.support);
}

/**
 * Along each side: the share of its length that has an edge running the right way, and which way the picture gets brighter
 * across it (+1 brighter toward the inside, -1 darker toward the inside). Along a real border that never changes;
 * along a pattern (a tablecloth, tiles) it flips back and forth, and only the majority direction is counted.
 */
function sideReport(c: Corners, e: Edges, step = 1.5): { support: number; sign: number }[] {
  const out: { support: number; sign: number }[] = [];
  // which way round the corners go, so "inside" is known
  const orient = Math.sign(c.reduce((s, p, i) => s + p.x * c[(i + 1) % 4]!.y - c[(i + 1) % 4]!.x * p.y, 0)) || 1;
  for (let s = 0; s < 4; s++) {
    const a = c[s]!, b = c[(s + 1) % 4]!, dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    if (len < 4) { out.push({ support: 0, sign: 0 }); continue; }
    const normal = (((Math.atan2(dx, -dy) / RAD) % 180) + 180) % 180;
    const inx = (-dy / len) * orient, iny = (dx / len) * orient;
    let inside = 0, pos = 0, neg = 0;
    for (let t = 0; t <= len; t += step) {
      const x = Math.round(a.x + (dx * t) / len), y = Math.round(a.y + (dy * t) / len);
      if (x < 0 || y < 0 || x >= e.w || y >= e.h) continue;
      inside++;
      const v = e.near[y * e.w + x]!;
      if (v !== NONE && angleGap(v % 180, normal) <= 22) {
        if (Math.cos(v * RAD) * inx + Math.sin(v * RAD) * iny > 0) pos++; else neg++;
      }
    }
    // A side that is mostly outside the picture (the receipt runs off the edge) cannot be judged.
    const ok = inside >= 8 && inside * step >= 0.35 * len;
    // a side whose edges keep changing which way they brighten (a pattern) is not a border
    const consistent = pos + neg > 0 && Math.max(pos, neg) / (pos + neg) >= 0.75;
    out.push({ support: ok && consistent ? Math.max(pos, neg) / inside : 0, sign: pos >= neg ? 1 : -1 });
  }
  return out;
}

const cross = (o: P, a: P, b: P) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
const areaOf = (c: Corners) => Math.abs(c.reduce((s, p, i) => s + p.x * c[(i + 1) % 4]!.y - c[(i + 1) % 4]!.x * p.y, 0)) / 2;
const convex = (c: Corners) => { const s = [0, 1, 2, 3].map((i) => Math.sign(cross(c[i]!, c[(i + 1) % 4]!, c[(i + 2) % 4]!))); return s.every((v) => v === s[0] && v !== 0); };

/**
 * How good a four-cornered shape is as a receipt, 0 (not at all) to 1, judged by the edges along its sides.
 * `relaxed` accepts fainter borders. Alone that would also accept the odd pattern on a table, so the live camera only trusts a
 * relaxed find when it turns up in the same place twice in a row.
 */
export function scoreCorners(c: Corners, e: Edges, relaxed = false): number {
  if (!convex(c)) return 0;
  const frame = e.w * e.h, area = areaOf(c);
  if (area < 0.08 * frame || area > 1.4 * frame) return 0;
  // a quick rough look first, so shapes that are plainly wrong are dropped cheaply
  const rough = sideSupport(c, e, 6);
  if (rough.reduce((s, v) => s + v, 0) / 4 < (relaxed ? 0.22 : 0.3) || Math.min(...rough) < (relaxed ? 0.06 : 0.1)) return 0;
  const rep = sideReport(c, e), sup = rep.map((r) => r.support), mean = sup.reduce((s, v) => s + v, 0) / 4, min = Math.min(...sup);
  if (mean < (relaxed ? 0.3 : 0.42) || min < (relaxed ? 0.12 : 0.2)) return 0;
  // a receipt is brighter (or darker) than what is around it all the way round, never brighter on one side and darker on another
  if (rep.some((r) => r.sign !== rep[0]!.sign)) return 0;
  // corners should be near square (a tilted camera squeezes them, but not past ~35 degrees)
  let worst = 0;
  for (let i = 0; i < 4; i++) {
    const a = c[(i + 3) % 4]!, o = c[i]!, b = c[(i + 1) % 4]!;
    const cosv = ((a.x - o.x) * (b.x - o.x) + (a.y - o.y) * (b.y - o.y)) / ((Math.hypot(a.x - o.x, a.y - o.y) * Math.hypot(b.x - o.x, b.y - o.y)) || 1);
    worst = Math.max(worst, Math.abs(Math.acos(Math.max(-1, Math.min(1, cosv))) / RAD - 90));
  }
  if (worst > 38) return 0;
  return mean * (0.35 + 0.65 * Math.sqrt(Math.min(1, area / frame))) * (1 - worst / 150);
}

/** Puts four corners in reading order: top left, top right, bottom right, bottom left. */
export function orderCorners(pts: P[]): Corners {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const round = [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  let start = 0;
  for (let i = 1; i < 4; i++) if (round[i]!.x + round[i]!.y < round[start]!.x + round[start]!.y) start = i;
  return [0, 1, 2, 3].map((i) => round[(start + i) % 4]!) as Corners;
}

export { findEdges };
export type { Edges };

/**
 * The receipt's four corners in the small picture, found from its edges, with a score; null when no receipt-shaped
 * outline has enough real edge along it.
 */
export function edgeQuad(gray: Uint8Array, w: number, h: number, edges = findEdges(gray, w, h), relaxed = false): { corners: Corners; score: number } | null {
  if (w < 40 || h < 40 || edges.strongCount < 30) return null;
  const lines = chooseLines(findLines(edges, 80));
  if (lines.length < 4) return null;
  const minGap = 0.12 * Math.min(w, h);
  // pairs of lines that run roughly the same way and are far enough apart to be two sides of a receipt
  const pairs: [number, number][] = [];
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
    if (angleGap(lines[i]!.theta, lines[j]!.theta) <= 24 && distanceToLine(pointOn(lines[i]!), lines[j]!) >= minGap) pairs.push([i, j]);
  }
  const found: { corners: Corners; score: number; area: number; lines: Line[] }[] = [];
  for (let p = 0; p < pairs.length; p++) for (let q = p + 1; q < pairs.length; q++) {
    const [a, b] = pairs[p]!, [c, d] = pairs[q]!;
    if (a === c || a === d || b === c || b === d) continue;
    const g = angleGap(lines[a]!.theta, lines[c]!.theta);
    if (g < 50) continue; // the two directions must cross at something like a right angle
    const pts = [intersect(lines[a]!, lines[c]!), intersect(lines[a]!, lines[d]!), intersect(lines[b]!, lines[d]!), intersect(lines[b]!, lines[c]!)];
    if (pts.some((v) => !v)) continue;
    const corners = pts as Corners;
    if (corners.some((v) => v.x < -0.12 * w || v.x > 1.12 * w || v.y < -0.12 * h || v.y > 1.12 * h)) continue;
    const score = scoreCorners(corners, edges, relaxed);
    if (score > 0) found.push({ corners, score, area: areaOf(corners), lines: [lines[a]!, lines[c]!, lines[b]!, lines[d]!] });
  }
  if (!found.length) return null;
  const top = found.reduce((a, b) => (b.score > a.score ? b : a));
  if (top.score < (relaxed ? 0.17 : 0.28)) return null;
  return { corners: orderCorners(refine(top.corners, top.lines, edges)), score: top.score };
}
