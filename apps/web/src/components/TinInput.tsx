import { useRef, type KeyboardEvent } from 'react';
import { formatTinAt, TIN_FORMAT } from '@reimsys/shared';

/**
 * The vendor TIN box: numbers only, with the hyphens put in as the person types (000-000-000-00000).
 * Typing, deleting, editing in the middle and pasting all keep the caret where the person expects it.
 */
export function TinInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  /** Shows the formatted text and puts the caret back after the same digit once React has drawn it. */
  const apply = (raw: string, caret: number) => {
    const r = formatTinAt(raw, caret);
    onChange(r.value);
    const el = ref.current;
    requestAnimationFrame(() => { if (el && document.activeElement === el) el.setSelectionRange(r.caret, r.caret); });
  };
  // Deleting next to a hyphen would only bring the hyphen back, so the digit beside it is deleted instead.
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const el = e.currentTarget, a = el.selectionStart ?? 0, b = el.selectionEnd ?? 0;
    if (a !== b) return;
    if (e.key === 'Backspace' && el.value[a - 1] === '-') { e.preventDefault(); apply(el.value.slice(0, a - 2) + el.value.slice(a), a - 2); }
    else if (e.key === 'Delete' && el.value[a] === '-') { e.preventDefault(); apply(el.value.slice(0, a) + el.value.slice(a + 2), a); }
  };
  return (
    <input ref={ref} type="text" inputMode="numeric" autoComplete="off" value={value} placeholder={TIN_FORMAT} onKeyDown={onKeyDown}
      onChange={(ev) => apply(ev.target.value, ev.target.selectionStart ?? ev.target.value.length)} />
  );
}
