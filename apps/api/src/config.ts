import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

const env = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(4000),
    DATABASE_URL: z.string().min(1),
    WEB_ORIGIN: z.string().default('http://localhost:5173'),
    // A session ends after this long with no real activity (clicks and typing, not background refreshes)...
    SESSION_IDLE_MINUTES: z.coerce.number().min(5).max(1440).default(60),
    // ...and never lasts longer than this, however busy the person is.
    SESSION_MAX_HOURS: z.coerce.number().min(1).max(168).default(12),
    STORAGE_DIR: z.string().default('./storage'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().default(587),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    SMTP_SECURE: z.enum(['true', 'false']).default('false'),
    MAIL_FROM: z.string().default('REIMSYS <no-reply@example.com>'),
    ORG_NAME: z.string().default('REIMSYS'),
    WEB_DIST: z.string().default('../web/dist'),
  })
  .parse(process.env);

export const config = {
  isProd: env.NODE_ENV === 'production',
  port: env.PORT,
  webOrigin: env.WEB_ORIGIN.split(',')[0]!.trim(),
  webOrigins: env.WEB_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean),
  sessionIdleMs: env.SESSION_IDLE_MINUTES * 60_000,
  sessionMaxMs: env.SESSION_MAX_HOURS * 3_600_000,
  storageDir: path.resolve(env.STORAGE_DIR),
  cookieName: 'reimsys_sid',
  orgName: env.ORG_NAME,
  webDist: path.resolve(env.WEB_DIST),
  mailFrom: env.MAIL_FROM,
  smtp: env.SMTP_HOST ? { host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE === 'true', user: env.SMTP_USER, pass: env.SMTP_PASS } : null,
  maxFailedAttempts: 5,
  lockMinutes: 15,
};
