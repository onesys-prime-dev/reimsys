import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { forbidden } from '../lib/errors.js';

/** True when the page that sent the request was loaded from the very address it is now talking to. */
export function isSameOrigin(origin: string, host: string | undefined) {
  if (!host) return false;
  try { return new URL(origin).host.toLowerCase() === host.toLowerCase(); } catch { return false; }
}

/**
 * CSRF defence for cookie auth: SameSite=Lax cookie, a custom header on every write,
 * and an Origin check when the browser sends one.
 *
 * The origin must be one we were told about, OR the same address the request was sent to. That second rule lets the app
 * be opened from any address that reaches it (localhost, 127.0.0.1, a Wi-Fi address that just changed) while still
 * refusing a request that comes from some other website, whose origin never matches our own address.
 */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'reimsys') return next(forbidden('Missing request header.', 'CSRF'));
  const origin = req.get('origin');
  if (origin && !config.webOrigins.includes(origin) && !isSameOrigin(origin, req.get('host'))) {
    return next(forbidden('This page was opened from an address the server does not recognise. Open REIMSYS from the address your administrator gave you.', 'CSRF'));
  }
  next();
}
