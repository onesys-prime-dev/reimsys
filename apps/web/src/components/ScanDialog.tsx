import { useEffect, useMemo, useRef, useState } from 'react';
import { detectQuad, enhance, warpToRect, type Pt, type Quad, type Raster, type ScanMode } from '../scan';

const CORNERS = ['Top left corner', 'Top right corner', 'Bottom right corner', 'Bottom left corner'];
const MODES: { key: ScanMode; label: string }[] = [{ key: 'document', label: 'Document' }, { key: 'original', label: 'Original' }, { key: 'bw', label: 'Black & white' }];
const SOURCE_SIDE = 2400;
const OUTPUT_SIDE = 2000;

/** Reads the photo into pixels, shrunk so a 12-megapixel phone photo does not eat the phone's memory. Phone rotation is applied. */
async function readPhoto(file: File): Promise<Raster | null> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const k = Math.min(1, SOURCE_SIDE / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    const d = g.getImageData(0, 0, c.width, c.height);
    return { data: d.data, width: d.width, height: d.height };
  } catch {
    return null;
  }
}

const toBlob = (c: HTMLCanvasElement, quality: number) => new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', quality));

/**
 * The scanner: shows the photo with four corner dots (placed by itself, draggable) and what the cleaned-up page will look like.
 * "Use scan" hands back a straightened JPEG.
 */
export function ScanDialog({ file, maxBytes, onCancel, onRetake, onUse, onUnreadable }: {
  file: File; maxBytes: number;
  onCancel: () => void; onRetake: () => void;
  onUse: (scan: File, scanAnother: boolean) => void; onUnreadable: () => void;
}) {
  const [raster, setRaster] = useState<Raster | null>(null);
  const [quad, setQuad] = useState<Quad | null>(null);
  const [mode, setMode] = useState<ScanMode>('document');
  const [busy, setBusy] = useState(false);
  const photoCanvas = useRef<HTMLCanvasElement>(null);
  const resultCanvas = useRef<HTMLCanvasElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);

  useEffect(() => {
    let live = true;
    readPhoto(file).then((r) => {
      if (!live) return;
      if (!r) { onUnreadable(); return; }
      setRaster(r); setQuad(detectQuad(r));
    });
    return () => { live = false; };
  }, [file]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onCancel]);

  useEffect(() => {
    if (!raster || !photoCanvas.current) return;
    photoCanvas.current.width = raster.width; photoCanvas.current.height = raster.height;
    photoCanvas.current.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(raster.data), raster.width, raster.height), 0, 0);
  }, [raster]);

  // What the page will look like, redrawn as the corners or the look change.
  useEffect(() => {
    if (!raster || !quad || !resultCanvas.current) return;
    const id = requestAnimationFrame(() => {
      const out = enhance(warpToRect(raster, quad, 700), mode);
      const c = resultCanvas.current!;
      c.width = out.width; c.height = out.height;
      c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(out.data), out.width, out.height), 0, 0);
    });
    return () => cancelAnimationFrame(id);
  }, [raster, quad, mode]);

  const dot = useMemo(() => (raster ? Math.max(raster.width, raster.height) / 38 : 10), [raster]);
  const at = (e: React.PointerEvent): Pt => {
    const r = svg.current!.getBoundingClientRect();
    return { x: Math.min(raster!.width - 1, Math.max(0, ((e.clientX - r.left) / r.width) * raster!.width)), y: Math.min(raster!.height - 1, Math.max(0, ((e.clientY - r.top) / r.height) * raster!.height)) };
  };

  async function use(another: boolean) {
    if (!raster || !quad) return;
    setBusy(true);
    await new Promise((r) => setTimeout(r, 20)); // let the button show "Working…" before the heavy part
    const out = enhance(warpToRect(raster, quad, OUTPUT_SIDE), mode);
    const c = document.createElement('canvas');
    c.width = out.width; c.height = out.height;
    c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(out.data), out.width, out.height), 0, 0);
    let blob = await toBlob(c, 0.88);
    // A big photo can be over the file limit: take the quality down a little until it fits.
    for (let q = 0.8; blob && blob.size > maxBytes && q > 0.4; q -= 0.1) blob = await toBlob(c, q);
    setBusy(false);
    if (!blob) { onUnreadable(); return; }
    onUse(new File([blob], `scan-${Date.now().toString(36).slice(-5)}.jpg`, { type: 'image/jpeg' }), another);
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal scan" role="dialog" aria-modal="true" aria-label="Scan receipt">
        <h2>Scan receipt</h2>
        <div className="scan-body">
        <p>Drag the four dots to the corners of the receipt. The page next to it (or below it, on a phone) is what will be saved.</p>
        {!raster || !quad ? <div className="empty">Reading the photo…</div> : (
          <div className="scan-grid">
            <div className="scan-photo">
              <canvas ref={photoCanvas} aria-hidden="true" />
              <svg ref={svg} viewBox={`0 0 ${raster.width} ${raster.height}`} aria-label="Corners of the receipt"
                onPointerMove={(e) => { if (drag.current === null) return; const p = at(e); setQuad((q) => q && (q.map((c, i) => (i === drag.current ? p : c)) as Quad)); }}
                onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
                <polygon points={quad.map((p) => `${p.x},${p.y}`).join(' ')} className="scan-poly" />
                {quad.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={dot} role="button" tabIndex={0} aria-label={CORNERS[i]} className="scan-dot"
                    onPointerDown={(e) => { drag.current = i; (e.target as Element).setPointerCapture(e.pointerId); e.preventDefault(); }}
                    onKeyDown={(e) => {
                      const step = e.shiftKey ? 20 : 4, dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
                      if (!dx && !dy) return;
                      e.preventDefault();
                      setQuad((q) => q && (q.map((c, j) => (j === i ? { x: Math.min(raster.width - 1, Math.max(0, c.x + dx)), y: Math.min(raster.height - 1, Math.max(0, c.y + dy)) } : c)) as Quad));
                    }} />
                ))}
              </svg>
            </div>
            <div className="scan-out"><canvas ref={resultCanvas} className="result" aria-label="The page as it will be saved" /></div>
          </div>
        )}
        <div className="seg" role="radiogroup" aria-label="Look" style={{ marginTop: 12 }}>
          {MODES.map((m) => <button key={m.key} type="button" role="radio" aria-checked={mode === m.key} className={mode === m.key ? 'on' : ''} onClick={() => setMode(m.key)}>{m.label}</button>)}
        </div>
        </div>
        <div className="btns">
          <button className="btn" onClick={onRetake}>Retake</button>
          <button className="btn" disabled={!quad || busy} onClick={() => use(true)}>Use and scan another</button>
          <button className="btn pri" disabled={!quad || busy} onClick={() => use(false)}>{busy ? 'Working…' : 'Use scan'}</button>
        </div>
      </div>
    </div>
  );
}
