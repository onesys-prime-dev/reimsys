import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

interface View { s: number; x: number; y: number }
const MAX = 8;

/**
 * A picture you can look at closely: scroll the wheel or pinch to zoom, drag to move it around, double-click (or double-tap) to jump in and out,
 * and use the + / - / Fit buttons or the keys + - 0 and the arrows. At "Fit" the whole picture is in view. The content is anything that
 * fills the box (an image or a canvas).
 */
export function ZoomPan({ children, label = 'Picture', className = '' }: { children: ReactNode; label?: string; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ s: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; s: number } | null>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const tap = useRef(0);

  /** Keeps the picture from being dragged out of sight. */
  const fit = useCallback((v: View): View => {
    const el = box.current;
    if (!el) return v;
    const s = Math.min(MAX, Math.max(1, v.s));
    const w = el.clientWidth, h = el.clientHeight;
    return { s, x: Math.min(0, Math.max(w - w * s, v.x)), y: Math.min(0, Math.max(h - h * s, v.y)) };
  }, []);

  /** Zooms to `s`, keeping the point (cx, cy) of the box where it is. */
  const zoomAt = useCallback((s: number, cx: number, cy: number) => {
    setView((v) => {
      const ns = Math.min(MAX, Math.max(1, s));
      const k = ns / v.s;
      return fit({ s: ns, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k });
    });
  }, [fit]);

  const centre = () => { const el = box.current!; return { x: el.clientWidth / 2, y: el.clientHeight / 2 }; };
  const local = (e: { clientX: number; clientY: number }) => { const r = box.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  // The wheel zooms. This needs a real listener so that the page behind does not scroll at the same time.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      setView((v) => {
        const ns = Math.min(MAX, Math.max(1, v.s * Math.exp(-e.deltaY * 0.0015)));
        const k = ns / v.s;
        return fit({ s: ns, x: p.x - (p.x - v.x) * k, y: p.y - (p.y - v.y) * k });
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [fit]);

  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setView((v) => fit(v)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.zp-bar')) return;
    box.current!.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1, s: view.s };
    } else {
      last.current = local(e);
      setDragging(true);
      const now = Date.now();
      if (now - tap.current < 300) { const p = local(e); view.s > 1.05 ? setView({ s: 1, x: 0, y: 0 }) : zoomAt(2.5, p.x, p.y); tap.current = 0; } else tap.current = now;
    }
  };
  const onMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, local(e));
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1;
      zoomAt(pinch.current.s * (d / pinch.current.d), (a!.x + b!.x) / 2, (a!.y + b!.y) / 2);
    } else if (last.current) {
      const p = local(e);
      const dx = p.x - last.current.x, dy = p.y - last.current.y;
      last.current = p;
      setView((v) => fit({ ...v, x: v.x + dx, y: v.y + dy }));
    }
  };
  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (!pointers.current.size) { last.current = null; setDragging(false); } else { const [p] = [...pointers.current.values()]; last.current = p ?? null; }
  };
  const onKey = (e: React.KeyboardEvent) => {
    const c = centre(), step = 60;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomAt(view.s * 1.4, c.x, c.y); }
    else if (e.key === '-') { e.preventDefault(); zoomAt(view.s / 1.4, c.x, c.y); }
    else if (e.key === '0') { e.preventDefault(); setView({ s: 1, x: 0, y: 0 }); }
    else if (e.key.startsWith('Arrow') && view.s > 1) {
      e.preventDefault();
      setView((v) => fit({ ...v, x: v.x + (e.key === 'ArrowLeft' ? step : e.key === 'ArrowRight' ? -step : 0), y: v.y + (e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0) }));
    }
  };

  return (
    <div ref={box} className={`zp ${dragging ? 'dragging' : ''} ${view.s > 1 ? 'zoomed' : ''} ${className}`} tabIndex={0} role="group" aria-label={`${label}. Scroll or pinch to zoom, drag to move.`}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={onKey}>
      <div className="zp-in" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }}>{children}</div>
      <div className="zp-bar" role="toolbar" aria-label="Zoom">
        <button type="button" className="btn sm" aria-label="Zoom out" onClick={() => { const c = centre(); zoomAt(view.s / 1.4, c.x, c.y); }} disabled={view.s <= 1}>−</button>
        <button type="button" className="btn sm" aria-label="Zoom in" onClick={() => { const c = centre(); zoomAt(view.s * 1.4, c.x, c.y); }} disabled={view.s >= MAX}>+</button>
        <button type="button" className="btn sm" aria-label="Fit the whole picture" onClick={() => setView({ s: 1, x: 0, y: 0 })} disabled={view.s === 1}>Fit</button>
      </div>
    </div>
  );
}
