import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { config } from './config.js';
import { prisma } from './db.js';
import { errorHandler } from './middleware/error.js';
import { loadAuth, requireAuth, sessionAlive } from './middleware/auth.js';
import { hub } from './lib/realtime.js';
import { csrfGuard } from './middleware/security.js';
import { auditRouter } from './routes/audit.js';
import { authRouter } from './routes/auth.js';
import { meRouter } from './routes/me.js';
import { rolesRouter } from './routes/roles.js';
import { settingsRouter } from './routes/settings.js';
import { companyRouter } from './routes/company.js';
import { appSettingsRouter } from './routes/appSettings.js';
import { usersRouter } from './routes/users.js';
import { categoriesRouter, dashboardRouter, emailLogRouter, notificationsRouter } from './routes/misc.js';
import { importsRouter } from './routes/imports.js';
import { receiptsRouter } from './routes/receipts.js';
import { documentsRouter, reportsRouter } from './routes/reports.js';
import { paymentsRouter } from './routes/payments.js';
import { tlsOptions } from './lib/tls.js';
import './lib/documents.js';
import './lib/reports.js';
import { startDigest } from './lib/digest.js';
import { startReminders } from './lib/reminders.js';
import { startWorker } from './lib/jobs.js';

const app = express();
app.disable('x-powered-by');
// Behind Nginx in production, trust one proxy hop so rate limits and audit rows see the real client address.
app.set('trust proxy', config.isProd ? 1 : false);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        frameSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
        // Only force https in production. On a home or office network the app runs over plain http.
        upgradeInsecureRequests: config.isProd ? [] : null,
      },
    },
  }),
);
// Text compresses to about a third. The live-update stream must stay uncompressed, or the browser would wait for the buffer to fill.
app.use(compression({ filter: (req, res) => !req.path.startsWith('/api/events') && compression.filter(req, res) }));
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ ok: true });
});

app.use('/api', rateLimit({
  windowMs: 60_000, limit: 1200, standardHeaders: true, legacyHeaders: false,
  message: { error: { code: 'RATE_LIMIT', message: 'Too many requests. Slow down for a moment.' } },
}));
app.use('/api', csrfGuard, loadAuth);
app.use('/api/auth', authRouter);
/** Live updates for the signed-in browser. See lib/realtime.ts. */
app.get('/api/events', requireAuth, (req, res) => void hub.connect(req.auth!.user.id, req, res, req.auth!.session.id));
app.use('/api/me', meRouter);
app.use('/api/users', usersRouter);
app.use('/api', rolesRouter);
app.use('/api/audit', auditRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/receipts', receiptsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/imports', importsRouter);
app.use('/api/email-log', emailLogRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/company', companyRouter);
app.use('/api/app-settings', appSettingsRouter);
app.use('/api', (_req, res) => void res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found.' } }));

// In production the API also serves the built web app, so one process and one origin is enough.
const indexHtml = path.join(config.webDist, 'index.html');
if (fs.existsSync(indexHtml)) {
  // Built files have a fingerprint in their name, so they can be kept for a year; the page itself is always re-checked.
  app.use('/assets', express.static(path.join(config.webDist, 'assets'), { immutable: true, maxAge: '1y', fallthrough: false }));
  app.use(express.static(config.webDist, { index: false, maxAge: '1h' }));
  app.get(/^\/(?!api\/).*/, (_req, res) => void res.sendFile(indexHtml));
}
app.use(errorHandler);

const tls = tlsOptions(process.env);
if (tls) https.createServer(tls, app).listen(config.port, () => console.log(`REIMSYS API listening on https://localhost:${config.port}`));
else app.listen(config.port, () => console.log(`REIMSYS API listening on http://localhost:${config.port}`));
void startWorker();
startDigest();
startReminders();

// Every half minute, close live connections that belong to sessions which have ended, so a timed-out or signed-out browser cannot keep listening.
setInterval(async () => {
  try {
    const ids = hub.sessionIds();
    if (!ids.length) return;
    const rows = await prisma.session.findMany({ where: { id: { in: ids } }, select: { id: true, revokedAt: true, expiresAt: true, createdAt: true } });
    const alive = new Set(rows.filter((r) => sessionAlive(r)).map((r) => r.id));
    const dead = new Set(ids.filter((i) => !alive.has(i)));
    if (dead.size) hub.closeSessions(dead);
  } catch (e) { console.error('session sweep', e); }
}, 30_000).unref();
