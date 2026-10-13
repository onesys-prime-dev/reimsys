export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}
export const badRequest = (m: string, code = 'BAD_REQUEST') => new HttpError(400, code, m);
export const unauthorized = (m = 'Please sign in.', code = 'UNAUTHORIZED') => new HttpError(401, code, m);
export const forbidden = (m = 'You do not have access to this.', code = 'FORBIDDEN') => new HttpError(403, code, m);
export const notFound = (m = 'Not found.') => new HttpError(404, 'NOT_FOUND', m);
export const conflict = (m: string, code = 'CONFLICT') => new HttpError(409, code, m);
