import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { detectQuad, findQuadLive, type Quad } from '../scan';
import { pageThumb, rasterOfCanvas, snapshotVideo, type ScanPage } from '../scanPage';
import { Icon } from '../ui';
import { ScanDialog } from './ScanDialog';

const LOOK_SIDE = 300; // the short side of the small picture the receipt is looked for in
const MIN_GAP_MS = 70; // shortest pause between two looks; slower phones get a longer one (see below)
const CLOSER_AREA = 0.12; // below this, suggest moving closer
const KEEP_MISSES = 3; // keep showing the outline through this many looks that miss it, so it does not flicker
const SAVE_TRIM = 0.026; // the saved page is cut this much further inside the outline, past the receipt's soft edge

const area = (q: Quad) => Math.abs(q.reduce((s, p, i) => s + (p.x * q[(i + 1) % 4]!.y - q[(i + 1) % 4]!.x * p.y), 0)) / 2;
const moved = (a: Quad, b: Quad) => Math.max(...a.map((p, i) => Math.hypot(p.x - b[i]!.x, p.y - b[i]!.y)));
const scale = (q: Quad, k: number) => q.map((p) => ({ x: p.x * k, y: p.y * k })) as Quad;
const pullIn = (q: Quad, t: number) => {
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4, cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  return q.map((p) => ({ x: p.x + (cx - p.x) * t, y: p.y + (cy - p.y) * t })) as Quad;
};
let nextPage = 1;
const thumbCache = new WeakMap<ScanPage, string>();
const thumbOf = (p: ScanPage) => { let t = thumbCache.get(p); if (!t) { t = pageThumb(p); thumbCache.set(p, t); } return t; };

/**
 * The live scanner, like a document-scanner app: the camera fills the screen and the receipt is found and outlined as you hold
 * it in view. The person presses the button to take each page (nothing is taken by itself), taps a page to adjust it, then Done.
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
  const target = useRef<Quad | null>(null); // where the receipt is, in the camera's own pixels; the outline glides there
  const candidate = useRef<Quad | null>(null); // the last faint find, to confirm the next one against
  const misses = useRef(0);
  const poly = useRef<SVGPolygonElement>(null);
  const busy = useRef(false);
  const pagesRef = useRef<ScanPage[]>([]);
  const editingRef = useRef(false);

  const [size, setSize] = useState<{ w: number; h: number } | null>(null); // the camera's own picture size
  const [fit, setFit] = useState<{ w: number; h: number } | null>(null); // how big it is drawn
  const [found, setFound] = useState<'none' | 'far' | 'yes'>('none');
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [torch, setTorch] = useState<boolean | null>(null); // null: this camera has no flash
  const [editing, setEditing] = useState<ScanPage | null>(null);
  const [flash, setFlash] = useState(0);
  const [confirmClose, setConfirmClose] = useState(false);

  pagesRef.current = pages; editingRef.current = !!editing;
  const full = pages.length >= maxPages;

  /* open and close the camera */
  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }, audio: false })
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

  /* Taking a page: copy the camera frame at once (cheap), flash, and do the heavy pixel work a moment later so nothing freezes. */
  const capture = useCallback(() => {
    const v = video.current;
    if (!v || !v.videoWidth || busy.current || pagesRef.current.length >= maxPages) return;
    busy.current = true;
    const shot = snapshotVideo(v);
    const live = target.current;
    const vw = v.videoWidth;
    setFlash((n) => n + 1);
    setConfirmClose(false); // another picture means they changed their mind about leaving
    requestAnimationFrame(() => window.setTimeout(() => {
      const raster = rasterOfCanvas(shot);
      // the outline already on screen is where the receipt is; only look again when there was none
      const quad = live ? pullIn(scale(live, raster.width / vw), SAVE_TRIM) : detectQuad(raster);
      setPages((ps) => [...ps, { id: nextPage++, raster, quad, mode: 'document' }]);
      window.setTimeout(() => { busy.current = false; }, 250);
    }, 0));
  }, [maxPages]);

  /* The outline glides to the newest position on every screen frame, instead of jumping each time the receipt is looked for. */
  useEffect(() => {
    let raf = 0, last = performance.now(), shown: Quad | null = null;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const t = target.current, el = poly.current;
      const dt = now - last;
      last = now;
      if (!t || !el) { shown = null; return; }
      const a = 1 - Math.exp(-dt / 45);
      const diag = size ? Math.hypot(size.w, size.h) : 1;
      if (!shown || moved(t, shown) > 0.25 * diag) shown = t.map((p) => ({ ...p })) as Quad; // a big jump: go straight there
      else for (let i = 0; i < 4; i++) { shown[i]!.x += (t[i]!.x - shown[i]!.x) * a; shown[i]!.y += (t[i]!.y - shown[i]!.y) * a; }
      el.setAttribute('points', shown.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  /* Look for the receipt again and again. Each look waits a little after the last one finished, longer on a slow phone, so the camera picture never stutters. */
  useEffect(() => {
    if (!size) return;
    let timer = 0, stopped = false;
    const look = () => {
      if (stopped) return;
      const started = performance.now();
      const v = video.current;
      if (v && v.videoWidth && !editingRef.current && !busy.current && !document.hidden) {
        const k = LOOK_SIDE / Math.min(v.videoWidth, v.videoHeight);
        const w = Math.max(1, Math.round(v.videoWidth * k)), h = Math.max(1, Math.round(v.videoHeight * k));
        const c = (grab.current ??= document.createElement('canvas'));
        if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
        const g = c.getContext('2d', { willReadFrequently: true })!;
        g.drawImage(v, 0, 0, w, h);
        const d = g.getImageData(0, 0, w, h);
        const r = findQuadLive({ data: d.data, width: w, height: h }, 0.004); // hug the paper for the outline you see
        let q: Quad | null = r ? r.quad : null;
        // A faint find counts only when the last look found about the same outline: a receipt stays put, a table pattern does not.
        if (q && !r!.sure) {
          const prev = candidate.current;
          candidate.current = q;
          if (!prev || moved(q, prev) > 0.05 * Math.hypot(w, h)) q = null;
        } else candidate.current = q;
        if (q) {
          misses.current = 0;
          target.current = scale(q, 1 / k);
          setFound(area(q) < CLOSER_AREA * w * h ? 'far' : 'yes');
        } else if (++misses.current > KEEP_MISSES) {
          target.current = null;
          setFound('none');
        }
      }
      const took = performance.now() - started;
      timer = window.setTimeout(look, Math.max(MIN_GAP_MS, took * 1.5));
    };
    timer = window.setTimeout(look, 0);
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [size]);

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
    : found === 'yes' ? 'Receipt found. Press the button to take the picture.'
    : found === 'far' ? 'Move a little closer to the receipt.'
    : pages.length ? 'Show the next page, or press Done.'
    : 'Show the whole receipt';

  return (
    <div className="live-scan" role="dialog" aria-modal="true" aria-label="Scan receipt camera">
      <div className="live-top">
        <button type="button" className="live-btn" aria-label="Close camera" onClick={requestClose}><Icon name="x" /></button>
        {torch !== null ? <button type="button" className={`live-btn ${torch ? 'on' : ''}`} aria-pressed={torch} aria-label="Flash" onClick={toggleTorch}>Flash</button> : <span style={{ width: 48 }} />}
      </div>
      <div className="live-view" ref={holder}>
        <div className="live-stage" style={fit ? { width: fit.w, height: fit.h } : { width: 1, height: 1, overflow: 'hidden' }}>
          <video ref={video} playsInline muted />
          {size && (
            <svg className="live-svg" viewBox={`0 0 ${size.w} ${size.h}`} aria-hidden="true">
              {found !== 'none' && <polygon ref={poly} className={`live-poly ${found === 'yes' ? 'steady' : ''}`} points="" />}
            </svg>
          )}
          {flash > 0 && <div className="live-flash" key={flash} />}
        </div>
      </div>
      <div className="live-hint" role="status">{hint}</div>
      <div className="live-bottom">
        <div className="live-thumbs">
          {pages.map((p, i) => <button key={p.id} type="button" className="live-thumb" aria-label={`Page ${i + 1}`} onClick={() => { setConfirmClose(false); setEditing(p); }}><img src={thumbOf(p)} alt="" /><b>{i + 1}</b></button>)}
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
