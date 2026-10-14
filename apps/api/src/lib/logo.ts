import { BRAND, LOGO } from '@reimsis/shared';

/** Draws the REIMSYS mark into a PDF as vector shapes, at the given top-left corner and size (in points). */
export function drawLogo(doc: PDFKit.PDFDocument, x: number, y: number, size: number) {
  doc.save();
  doc.translate(x, y).scale(size / LOGO.size);

  const g = doc.linearGradient(0, 0, LOGO.size, LOGO.size);
  g.stop(0, BRAND.tealLight).stop(1, BRAND.tealDark);
  doc.roundedRect(0, 0, LOGO.size, LOGO.size, LOGO.radius).fill(g);

  doc.lineCap('round').lineJoin('round');
  doc.lineWidth(LOGO.ring.width).path(LOGO.ring.d).stroke(BRAND.white);

  const [a, b, c] = LOGO.head.points;
  doc.lineWidth(LOGO.head.width).moveTo(a![0], a![1]).lineTo(b![0], b![1]).lineTo(c![0], c![1]).closePath().fillAndStroke(BRAND.white, BRAND.white);

  doc.lineWidth(LOGO.peso.width);
  doc.path(LOGO.peso.stem).stroke(BRAND.white);
  doc.path(LOGO.peso.bars).stroke(BRAND.white);
  doc.restore();
}
