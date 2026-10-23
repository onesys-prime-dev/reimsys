import type { NextFunction, Request, Response } from 'express';
import { cleanDeep } from '@reimsys/shared';

/** Passwords are the one kind of text where every character counts, so they are left exactly as typed. */
const KEEP = ['password', 'currentPassword', 'newPassword', 'pass', 'token'];

/**
 * Every text that arrives in a JSON request is cleaned of blank-looking characters at both ends (zero-width spaces, the Hangul filler, the Braille
 * blank and the like) before any rule looks at it, so "required" and "at least N characters" are judged on what a person can see.
 */
export function cleanBodyText(req: Request, _res: Response, next: NextFunction) {
  if (req.body && typeof req.body === 'object') req.body = cleanDeep(req.body, KEEP);
  next();
}
