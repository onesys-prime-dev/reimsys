import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { config } from './config.js';
import { prisma } from './db.js';
import { errorHandler } from './middleware/error.js';
import { loadAuth } from './middleware/auth.js';
import { csrfGuard } from './middleware/security.js';
import { auditRouter } from './routes/audit.js';
import { authRouter } from './routes/auth.js';
import { meRouter } from './routes/me.js';
import { rolesRouter } from './routes/roles.js';
import { usersRouter } from './routes/users.js';
import { categoriesRouter, dashboardRouter, emailLogRouter, notificationsRouter } from './routes/misc.js';
import { importsRouter } from './routes/imports.js';
import { receiptsRouter } from './routes/receipts.js';
import { documentsRouter, reportsRouter } from './routes/reports.js';
import './lib/documents.js';
import './lib/reports.js';
import { startDigest } from './lib/digest.js';
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
      },
    },
  }),
);
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
app.use('/api/imports', importsRouter);
app.use('/api/email-log', emailLogRouter);
app.use('/api', (_req, res) => void res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found.' } }));

// In production the API also serves the built web app, so one process and one origin is enough.
const indexHtml = path.join(config.webDist, 'index.html');
if (fs.existsSync(indexHtml)) {
  app.use(express.static(config.webDist, { index: false, maxAge: '1h' }));
  app.get(/^\/(?!api\/).*/, (_req, res) => void res.sendFile(indexHtml));
}
app.use(errorHandler);

app.listen(config.port, () => console.log(`REIMSIS API listening on http://localhost:${config.port}`));
void startWorker();
startDigest();
