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
  document.addEventListener('paste', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || el.type !== 'number') return;
    const text = e.clipboardData?.getData('text') ?? '';
    if (!(wholeNumber(el) ? /^\d+$/ : /^\d*\.?\d*$/).test(text.trim())) e.preventDefault();
  }, true);
}
