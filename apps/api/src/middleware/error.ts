import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { HttpError } from '../lib/errors.js';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return void res.status(err.status).json({ error: { code: err.code, message: err.message } });
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
