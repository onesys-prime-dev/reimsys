import { isActive } from './activity';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

interface Options {
  method?: string;
  body?: unknown;
  form?: FormData;
}

/** What to say when the server's answer has no message of its own (a proxy page, a crash, a timeout). */
const fallbackMessage = (status: number) => (status >= 502 && status <= 504 ? 'The server is not available right now. Please try again in a moment.' : status >= 500 ? 'The server had a problem. Please try again.' : 'Something went wrong. Please try again.');

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const headers: Record<string, string> = { 'x-requested-with': 'reimsys' };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  // Marks the request as coming from a person at the keyboard, not the page refreshing itself.
  if (isActive(45_000)) headers['x-user-activity'] = '1';
  let res: Response;
  try {
    res = await fetch('/api' + path, {
      method: opts.method ?? 'GET',
      credentials: 'same-origin',
      headers,
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and try again.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? 'ERROR', data?.error?.message ?? fallbackMessage(res.status));
  return data as T;
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Please try again.');

export const fmtDateTime = (iso: string | null | undefined) => {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return d.toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

/** Short device label from a user agent string. */
export function deviceName(ua: string | null) {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

export const money = (n: number | string) => '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtDate = (d: string) => { const [y, m, day] = d.split('-'); return `${MONTHS[Number(m) - 1]} ${Number(day)}, ${y}`; };
export const todayIso = () => new Date().toISOString().slice(0, 10);
/** Today on this device. Use it for dates people pick: in Manila the UTC date is still yesterday until 8am. */
export const localToday = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10); };

/** Time ago in words for queue items. */
export function ago(iso: string | null) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

/** Loads a file in a hidden frame and opens the browser print dialog. Same-origin only. */
export function printUrl(url: string) {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  f.src = url;
  f.onload = () => {
    try { f.contentWindow?.focus(); f.contentWindow?.print(); } catch { window.open(url, '_blank'); }
    setTimeout(() => f.remove(), 60_000);
  };
  document.body.appendChild(f);
}
