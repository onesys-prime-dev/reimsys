import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { forbidden } from '../lib/errors.js';

/**
 * CSRF defence for cookie auth: SameSite=Lax cookie, a custom header on every write,
 * and an Origin check when the browser sends one.
 */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'reimsis') return next(forbidden('Missing request header.', 'CSRF'));
  const origin = req.get('origin');
  if (origin && !config.webOrigins.includes(origin)) return next(forbidden('Origin not allowed.', 'CSRF'));
  next();
}
