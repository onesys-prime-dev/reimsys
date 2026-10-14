import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { MulterError } from 'multer';
import { ZodError } from 'zod';
import { HttpError } from '../lib/errors.js';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return void res.status(err.status).json({ error: { code: err.code, message: err.message } });
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
