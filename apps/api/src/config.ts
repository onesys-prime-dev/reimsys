import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

const env = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(4000),
    DATABASE_URL: z.string().min(1),
    WEB_ORIGIN: z.string().default('http://localhost:5173'),
    SESSION_DAYS: z.coerce.number().default(7),
    STORAGE_DIR: z.string().default('./storage'),
  })
  .parse(process.env);

export const config = {
  isProd: env.NODE_ENV === 'production',
  port: env.PORT,
  webOrigin: env.WEB_ORIGIN,
  sessionMs: env.SESSION_DAYS * 24 * 60 * 60 * 1000,
  storageDir: path.resolve(env.STORAGE_DIR),
  cookieName: 'reimsis_sid',
  maxFailedAttempts: 5,
  lockMinutes: 15,
};
