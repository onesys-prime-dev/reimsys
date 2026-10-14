import { BRAND, LOGO } from '@reimsis/shared';

/** Draws the REIMSIS mark into a PDF as vector shapes, at the given top-left corner and size (in points). */
export function drawLogo(doc: PDFKit.PDFDocument, x: number, y: number, size: number) {
  doc.save();
  doc.translate(x, y).scale(size / LOGO.size);

  const g = doc.linearGradient(0, 0, LOGO.size, LOGO.size);
  g.stop(0, BRAND.tealLight).stop(1, BRAND.tealDark);
  doc.roundedRect(0, 0, LOGO.size, LOGO.size, LOGO.radius).fill(g);
  doc.path(LOGO.receipt).fill(BRAND.white);

  doc.save();
  doc.opacity(LOGO.lines.opacity).lineWidth(LOGO.lines.width).lineCap('round');
  for (const [x1, y1, x2, y2] of LOGO.lines.segments) doc.moveTo(x1, y1).lineTo(x2, y2).stroke(BRAND.teal);
  doc.restore();

  const [a, b, c] = LOGO.check.points;
  doc.lineWidth(LOGO.check.width).lineCap('round').lineJoin('round');
  doc.moveTo(a![0], a![1]).lineTo(b![0], b![1]).lineTo(c![0], c![1]).stroke(BRAND.teal);
  doc.restore();
}
