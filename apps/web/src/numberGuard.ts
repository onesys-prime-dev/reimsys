/**
 * Browsers let people type "e", "+" and "-" into a number box (scientific notation), and "." where only whole numbers make sense. This keeps every
 * number box in the app to digits (and a decimal point only where the box takes decimals), for typing and for pasting.
 */
const wholeNumber = (el: HTMLInputElement) => {
  const step = el.getAttribute('step');
  return step !== 'any' && Number(step ?? 1) % 1 === 0;
};

export function installNumberGuard() {
  document.addEventListener('keydown', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || el.type !== 'number' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (['e', 'E', '+', '-'].includes(e.key) || ((e.key === '.' || e.key === ',') && wholeNumber(el))) e.preventDefault();
  }, true);
  // Phone keyboards often send no key presses at all (the key is "Unidentified"), only the text being inserted, so the check above never sees an "e".
  // This one looks at the text itself, whichever way it arrives.
  document.addEventListener('beforeinput', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || el.type !== 'number' || e.inputType.startsWith('delete') || e.data == null) return;
    if (!(wholeNumber(el) ? /^\d+$/ : /^[\d.,]+$/).test(e.data)) e.preventDefault();
  }, true);
  // Last line of defence: if something other than digits still got in (a keyboard that cannot be cancelled), go back to the last good value.
  const lastGood = new WeakMap<HTMLInputElement, string>();
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || el.type !== 'number') return;
    if (el.validity.badInput) {
      el.value = lastGood.get(el) ?? '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else lastGood.set(el, el.value);
  }, true);
  document.addEventListener('paste', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || el.type !== 'number') return;
    const text = e.clipboardData?.getData('text') ?? '';
    if (!(wholeNumber(el) ? /^\d+$/ : /^\d*\.?\d*$/).test(text.trim())) e.preventDefault();
  }, true);
}
