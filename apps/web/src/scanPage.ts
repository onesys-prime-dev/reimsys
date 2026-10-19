import { enhance, warpToRect, type Quad, type Raster, type ScanMode } from './scan';

/** One scanned page: the camera picture, where the receipt's four corners are in it, and which look was chosen. */
export interface ScanPage { id: number; raster: Raster; quad: Quad; mode: ScanMode }

const SOURCE_SIDE = 2400;
export const OUTPUT_SIDE = 2000;

const drawToCanvas = (src: CanvasImageSource, sw: number, sh: number, maxSide: number): HTMLCanvasElement => {
  const k = Math.min(1, maxSide / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * k)); c.height = Math.max(1, Math.round(sh * k));
  c.getContext('2d', { willReadFrequently: true })!.drawImage(src, 0, 0, c.width, c.height);
  return c;
};
/** The pixels of a canvas. */
export const rasterOfCanvas = (c: HTMLCanvasElement): Raster => {
  const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height);
  return { data: d.data, width: d.width, height: d.height };
};
const drawToRaster = (src: CanvasImageSource, sw: number, sh: number, maxSide: number): Raster => rasterOfCanvas(drawToCanvas(src, sw, sh, maxSide));

/** Reads a photo file into pixels, shrunk so a 12-megapixel phone photo does not eat the phone's memory. Phone rotation is applied. Null if it cannot be read. */
export async function readPhoto(file: File): Promise<Raster | null> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const r = drawToRaster(bmp, bmp.width, bmp.height, SOURCE_SIDE);
    bmp.close?.();
    return r;
  } catch {
    return null;
  }
}

/** A quick copy of the camera's picture right now, read into pixels later with rasterOfCanvas (so the button reacts at once). */
export const snapshotVideo = (v: HTMLVideoElement, maxSide = SOURCE_SIDE) => drawToCanvas(v, v.videoWidth, v.videoHeight, maxSide);

export function putRaster(canvas: HTMLCanvasElement, r: Raster) {
  canvas.width = r.width; canvas.height = r.height;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.width, r.height), 0, 0);
}

/** The finished page as pixels: cut out, straightened, cleaned up. */
export const renderPage = (p: ScanPage, maxSide: number) => enhance(warpToRect(p.raster, p.quad, maxSide), p.mode);

const toBlob = (c: HTMLCanvasElement, quality: number) => new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', quality));

/** The finished page as a JPEG file, taking the quality down a little if a big photo would be over the file limit. */
export async function pageToFile(p: ScanPage, maxBytes: number): Promise<File | null> {
  const c = document.createElement('canvas');
  putRaster(c, renderPage(p, OUTPUT_SIDE));
  let blob = await toBlob(c, 0.88);
  for (let q = 0.8; blob && blob.size > maxBytes && q > 0.4; q -= 0.1) blob = await toBlob(c, q);
  return blob ? new File([blob], `scan-${Date.now().toString(36).slice(-4)}${p.id.toString(36)}.jpg`, { type: 'image/jpeg' }) : null;
}

/** A small picture of the finished page for the strip of pages at the bottom of the camera. */
export function pageThumb(p: ScanPage): string {
  const c = document.createElement('canvas');
  putRaster(c, renderPage(p, 140));
  return c.toDataURL('image/jpeg', 0.7);
}
