import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { MulterError } from 'multer';
import { ZodError } from 'zod';
import { HttpError } from '../lib/errors.js';

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** A person who opens an address straight in the browser (a pasted file link, a link in an email) is not inside the app, so there is no toast: show a plain page instead of raw JSON. */
const isBrowserVisit = (req: Request) => req.method === 'GET' && !req.headers['x-requested-with'] && String(req.headers.accept ?? '').includes('text/html');

function friendlyPage(err: HttpError) {
  const signIn = err.status === 401;
  const title = signIn ? 'Please sign in' : err.status === 403 ? 'You do not have access' : err.status === 404 ? 'This file or page is not available' : 'Something went wrong';
  const text = signIn ? 'You need to sign in to REIMSYS to open this. Sign in, then open the link again.' : err.status === 403 || err.status === 404 ? 'It may have been removed, or your account is not allowed to see it.' : err.message;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · REIMSYS</title><meta name="robots" content="noindex"><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,sans-serif;background:#0e1a1f;color:#e6eef0}main{max-width:420px;margin:24px;padding:28px;border:1px solid #27414a;border-radius:14px;background:#13242b}h1{margin:0 0 8px;font-size:1.25rem}p{margin:0 0 18px;color:#a9bcc2}a{display:inline-block;padding:10px 18px;border-radius:10px;background:#2fb8c4;color:#04262b;font-weight:700;text-decoration:none}</style></head><body><main><h1>${esc(title)}</h1><p>${esc(text)}</p><a href="/">${signIn ? 'Go to sign in' : 'Back to REIMSYS'}</a></main></body></html>`;
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    if (isBrowserVisit(req)) return void res.status(err.status).type('html').setHeader('Cache-Control', 'no-store').send(friendlyPage(err));
    return void res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  // Requests the body parser could not accept (too big, or not valid JSON).
  const parsed = err as { type?: string; status?: number };
  if (parsed?.type === 'entity.too.large') return void res.status(413).json({ error: { code: 'TOO_LARGE', message: 'That request is too large.' } });
  if (parsed?.type === 'entity.parse.failed' || parsed?.type === 'encoding.unsupported' || parsed?.type === 'charset.unsupported') {
    return void res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'The request could not be read.' } });
  }
  // Upload limits: say what is wrong in plain words instead of a generic failure.
  if (err instanceof MulterError) {
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    const tooMany = err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE';
    return void res.status(tooBig ? 413 : 400).json({
      error: { code: tooBig ? 'FILE_TOO_BIG' : tooMany ? 'TOO_MANY_FILES' : 'BAD_UPLOAD', message: tooBig ? 'That file is too large. Photos and PDFs can be up to 10 MB each (profile photos up to 2 MB).' : tooMany ? 'Too many files in one go. Send up to 10 at a time.' : 'The upload could not be read. Try again.' },
    });
  }
  if (err instanceof ZodError) {
    const first = err.issues[0];
    return void res.status(400).json({
      error: { code: 'VALIDATION', message: first ? `${first.path.join('.') || 'Input'}: ${first.message}` : 'Invalid input.', issues: err.issues },
    });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    return void res.status(409).json({ error: { code: 'DUPLICATE', message: 'That value is already in use.' } });
  }
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } });
}
