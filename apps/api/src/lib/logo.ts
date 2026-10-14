import { BRAND, LOGO } from '@reimsys/shared';

/** Draws the REIMSYS mark into a PDF as vector shapes, at the given top-left corner and size (in points). */
export function drawLogo(doc: PDFKit.PDFDocument, x: number, y: number, size: number) {
  doc.save();
  doc.translate(x, y).scale(size / LOGO.size);

  const g = doc.linearGradient(0, 0, LOGO.size, LOGO.size);
  g.stop(0, BRAND.tealLight).stop(1, BRAND.tealDark);
  doc.path(LOGO.tile).fill(g);

  doc.save();
  doc.opacity(LOGO.fold.opacity).path(LOGO.fold.d).fill(BRAND.white);
  doc.restore();

  doc.lineWidth(LOGO.strokeWidth).lineCap('round').lineJoin('round');
  for (const s of LOGO.strokes) doc.path(s.d).stroke(s.color);
  doc.restore();
}
