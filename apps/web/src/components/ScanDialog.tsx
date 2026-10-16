import { useEffect, useMemo, useRef, useState } from 'react';
import { detectQuad, type Pt, type Quad, type ScanMode } from '../scan';
import { putRaster, readPhoto, renderPage, type ScanPage } from '../scanPage';

const CORNERS = ['Top left corner', 'Top right corner', 'Bottom right corner', 'Bottom left corner'];
const MODES: { key: ScanMode; label: string }[] = [{ key: 'document', label: 'Document' }, { key: 'original', label: 'Original' }, { key: 'bw', label: 'Black & white' }];
let nextId = 1;

/**
 * The page editor: the photo with four corner dots (placed by itself, draggable) and what the cleaned-up page will look like.
 * It is opened on a photo file (the phone's own camera) or on a page already scanned with the live camera.
 */
export function ScanDialog({ file, page, onCancel, onRetake, onApply, onDelete, onUnreadable }: {
  file?: File; page?: ScanPage;
  onCancel: () => void;
  /** Photo files only: take the picture again. */
  onRetake?: () => void;
  onApply: (page: ScanPage, scanAnother: boolean) => void;
  /** Pages already scanned only: remove the page. */
  onDelete?: () => void;
  onUnreadable: () => void;
}) {
  const [raster, setRaster] = useState(page?.raster ?? null);
  const [quad, setQuad] = useState<Quad | null>(page?.quad ?? null);
  const [mode, setMode] = useState<ScanMode>(page?.mode ?? 'document');
  const photoCanvas = useRef<HTMLCanvasElement>(null);
  const resultCanvas = useRef<HTMLCanvasElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);
  const editing = !!page;

  useEffect(() => {
    if (!file) return;
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

  useEffect(() => { if (raster && photoCanvas.current) putRaster(photoCanvas.current, raster); }, [raster]);

  // What the page will look like, redrawn as the corners or the look change.
  useEffect(() => {
    if (!raster || !quad || !resultCanvas.current) return;
    const id = requestAnimationFrame(() => putRaster(resultCanvas.current!, renderPage({ id: 0, raster, quad, mode }, 700)));
    return () => cancelAnimationFrame(id);
  }, [raster, quad, mode]);

  const dot = useMemo(() => (raster ? Math.max(raster.width, raster.height) / 38 : 10), [raster]);
  const at = (e: React.PointerEvent): Pt => {
    const r = svg.current!.getBoundingClientRect();
    return { x: Math.min(raster!.width - 1, Math.max(0, ((e.clientX - r.left) / r.width) * raster!.width)), y: Math.min(raster!.height - 1, Math.max(0, ((e.clientY - r.top) / r.height) * raster!.height)) };
  };
  const apply = (another: boolean) => raster && quad && onApply({ id: page?.id ?? nextId++, raster, quad, mode }, another);

  return (
    <div className="scrim" style={{ zIndex: 70 }} onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal scan" role="dialog" aria-modal="true" aria-label="Scan receipt">
        <h2>{editing ? 'Adjust page' : 'Scan receipt'}</h2>
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
          {editing ? (
            <>
              {onDelete && <button className="btn bad" onClick={onDelete}>Delete page</button>}
              <button className="btn" onClick={onCancel}>Cancel</button>
              <button className="btn pri" disabled={!quad} onClick={() => apply(false)}>Save page</button>
            </>
          ) : (
            <>
              <button className="btn" onClick={onRetake}>Retake</button>
              <button className="btn" disabled={!quad} onClick={() => apply(true)}>Use and scan another</button>
              <button className="btn pri" disabled={!quad} onClick={() => apply(false)}>Use scan</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
