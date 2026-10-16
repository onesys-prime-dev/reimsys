import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { detectQuad, findQuad, steadyTracker, type Pt, type Quad } from '../scan';
import { pageThumb, rasterFromVideo, type ScanPage } from '../scanPage';
import { Icon } from '../ui';
import { ScanDialog } from './ScanDialog';

const LOOK_EVERY_MS = 200;
const STEADY_CHECKS = 6; // about a second and a quarter
const STEADY_TOLERANCE = 0.02;
const MIN_AREA = 0.2; // the receipt must fill at least a fifth of the picture

const area = (q: Quad) => Math.abs(q.reduce((s, p, i) => s + (p.x * q[(i + 1) % 4]!.y - q[(i + 1) % 4]!.x * p.y), 0)) / 2;
const moved = (a: Quad, b: Quad) => Math.max(...a.map((p, i) => Math.hypot(p.x - b[i]!.x, p.y - b[i]!.y)));
let nextPage = 1;

/**
 * The live scanner, like a document-scanner app: the camera fills the screen, the receipt is found and outlined as you hold it
 * in view, and the picture is taken by itself once it is held still. Keep going for more pages, tap a page to adjust it, then Done.
 */
export function LiveScanner({ maxPages, onDone, onClose, onUnavailable }: {
  maxPages: number;
  onDone: (pages: ScanPage[]) => void;
  onClose: () => void;
  onUnavailable: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const grab = useRef<HTMLCanvasElement | null>(null);
  const track = useRef<MediaStreamTrack | null>(null);
  const steady = useRef(steadyTracker({ frames: STEADY_CHECKS, tolerance: STEADY_TOLERANCE }));
  const liveQuad = useRef<Quad | null>(null);
  const lastShot = useRef<Quad | null>(null);
  const armed = useRef(true);
  const gone = useRef(0);
  const busy = useRef(false);
  const pagesRef = useRef<ScanPage[]>([]);
  const autoRef = useRef(true);
  const editingRef = useRef(false);

  const [size, setSize] = useState<{ w: number; h: number } | null>(null); // the camera's own picture size
  const [fit, setFit] = useState<{ w: number; h: number } | null>(null); // how big it is drawn
  const [quad, setQuad] = useState<Quad | null>(null);
  const [progress, setProgress] = useState(0);
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [auto, setAuto] = useState(true);
  const [torch, setTorch] = useState<boolean | null>(null); // null: this camera has no flash
  const [editing, setEditing] = useState<ScanPage | null>(null);
  const [flash, setFlash] = useState(0);
  const [confirmClose, setConfirmClose] = useState(false);

  pagesRef.current = pages; autoRef.current = auto; editingRef.current = !!editing;
  const full = pages.length >= maxPages;

  /* open and close the camera */
  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then(async (s) => {
        if (stopped) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        const t = s.getVideoTracks()[0]!;
        track.current = t;
        if ((t.getCapabilities?.() as { torch?: boolean } | undefined)?.torch) setTorch(false);
        const v = video.current!;
        v.srcObject = s;
        await v.play();
        setSize({ w: v.videoWidth, h: v.videoHeight });
      })
      .catch(() => { if (!stopped) onUnavailable(); });
    return () => { stopped = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* how big the picture is drawn: as large as fits, without stretching */
  useLayoutEffect(() => {
    if (!size || !holder.current) return;
    const el = holder.current;
    const calc = () => {
      const k = Math.min(el.clientWidth / size.w, el.clientHeight / size.h);
      setFit({ w: Math.floor(size.w * k), h: Math.floor(size.h * k) });
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [size]);

  const capture = useCallback(() => {
    const v = video.current;
    if (!v || !v.videoWidth || busy.current || pagesRef.current.length >= maxPages) return;
    busy.current = true;
    const raster = rasterFromVideo(v);
    const k = raster.width / v.videoWidth;
    const live = liveQuad.current;
    const q = findQuad(raster) ?? (live ? (live.map((p) => ({ x: p.x * k, y: p.y * k })) as Quad) : detectQuad(raster));
    lastShot.current = live;
    armed.current = false; gone.current = 0;
    steady.current.reset(); setProgress(0);
    setPages((ps) => [...ps, { id: nextPage++, raster, quad: q, mode: 'document' }]);
    setFlash((n) => n + 1);
    setConfirmClose(false); // another picture means they changed their mind about leaving
    window.setTimeout(() => { busy.current = false; }, 500);
  }, [maxPages]);

  /* look for the receipt a few times a second */
  useEffect(() => {
    if (!size) return;
    const id = window.setInterval(() => {
      const v = video.current;
      if (!v || !v.videoWidth || editingRef.current || busy.current) return;
      const w = 320, h = Math.max(1, Math.round((w * v.videoHeight) / v.videoWidth));
      const c = (grab.current ??= document.createElement('canvas'));
      c.width = w; c.height = h;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(v, 0, 0, w, h);
      const d = g.getImageData(0, 0, w, h);
      let q = findQuad({ data: d.data, width: w, height: h }, 0.004); // hug the paper for the outline you see
      if (q && area(q) < MIN_AREA * w * h) q = null;
      const kx = v.videoWidth / w;
      const scaled = q ? (q.map((p: Pt) => ({ x: p.x * kx, y: p.y * kx })) as Quad) : null;
      liveQuad.current = scaled;
      setQuad(scaled);
      // After a picture, wait until the receipt has gone or a different one is in view before taking the next.
      if (!armed.current) {
        gone.current = q ? 0 : gone.current + 1;
        if (gone.current >= 3 || (scaled && lastShot.current && moved(scaled, lastShot.current) > 0.15 * Math.hypot(v.videoWidth, v.videoHeight))) armed.current = true;
      }
      const hold = steady.current.push(armed.current ? q : null, w, h);
      setProgress(armed.current ? steady.current.progress() : 0);
      if (hold && autoRef.current && armed.current && pagesRef.current.length < maxPages) capture();
    }, LOOK_EVERY_MS);
    return () => window.clearInterval(id);
  }, [size, capture, maxPages]);

  const thumbs = useMemo(() => pages.map((p) => pageThumb(p)), [pages]);
  const requestClose = () => {
    if (pages.length && !confirmClose) { setConfirmClose(true); return; }
    onClose();
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !editingRef.current) requestClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  });
  const toggleTorch = async () => {
    try { await track.current?.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] }); setTorch(!torch); } catch { /* this camera would not switch it */ }
  };

  const hint = confirmClose ? `Discard ${pages.length} page${pages.length === 1 ? '' : 's'}? Press the cross again.`
    : full ? 'That is the most pages this receipt can have.'
    : !size ? 'Opening the camera…'
    : !auto ? (quad ? 'Press the button to take the picture' : 'Hold the receipt in view')
    : !armed.current && pages.length ? 'Got it. Show the next page, or press Done.'
    : !quad ? 'Hold the receipt in view' : progress > 0 ? 'Hold still…' : 'Receipt found';

  return (
    <div className="live-scan" role="dialog" aria-modal="true" aria-label="Scan receipt camera">
      <div className="live-top">
        <button type="button" className="live-btn" aria-label="Close camera" onClick={requestClose}><Icon name="x" /></button>
        <button type="button" className={`live-btn auto ${auto ? 'on' : ''}`} aria-pressed={auto} aria-label="Auto capture" onClick={() => setAuto((a) => !a)}>Auto {auto ? 'on' : 'off'}</button>
        {torch !== null ? <button type="button" className={`live-btn ${torch ? 'on' : ''}`} aria-pressed={torch} aria-label="Flash" onClick={toggleTorch}>Flash</button> : <span style={{ width: 48 }} />}
      </div>
      <div className="live-view" ref={holder}>
        <div className="live-stage" style={fit ? { width: fit.w, height: fit.h } : { width: 1, height: 1, overflow: 'hidden' }}>
          <video ref={video} playsInline muted />
          {size && (
            <svg className="live-svg" viewBox={`0 0 ${size.w} ${size.h}`} aria-hidden="true">
              {quad && <polygon className={`live-poly ${progress > 0 ? 'steady' : ''}`} points={quad.map((p) => `${p.x},${p.y}`).join(' ')} />}
            </svg>
          )}
          {flash > 0 && <div className="live-flash" key={flash} />}
        </div>
      </div>
      <div className="live-hint" role="status">{hint}</div>
      <div className="live-bar"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
      <div className="live-bottom">
        <div className="live-thumbs">
          {pages.map((p, i) => <button key={p.id} type="button" className="live-thumb" aria-label={`Page ${i + 1}`} onClick={() => { setConfirmClose(false); setEditing(p); }}><img src={thumbs[i]} alt="" /><b>{i + 1}</b></button>)}
        </div>
        <button type="button" className="live-shutter" aria-label="Take picture" disabled={!size || full} onClick={capture}><i /></button>
        <button type="button" className="live-done" disabled={!pages.length} onClick={() => onDone(pages)}>Done ({pages.length})</button>
      </div>
      {editing && (
        <ScanDialog
          page={editing}
          onCancel={() => setEditing(null)}
          onApply={(pg) => { setPages((ps) => ps.map((x) => (x.id === pg.id ? pg : x))); setEditing(null); }}
          onDelete={() => { setPages((ps) => ps.filter((x) => x.id !== editing.id)); setEditing(null); setConfirmClose(false); }}
          onUnreadable={() => setEditing(null)}
        />
      )}
    </div>
  );
}

