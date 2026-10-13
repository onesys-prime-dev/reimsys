import cookieParser from 'cookie-parser';
import express from 'express';
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

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ ok: true });
});

app.use('/api', csrfGuard, loadAuth);
app.use('/api/auth', authRouter);
app.use('/api/me', meRouter);
app.use('/api/users', usersRouter);
app.use('/api', rolesRouter);
app.use('/api/audit', auditRouter);
app.use('/api', (_req, res) => void res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found.' } }));
app.use(errorHandler);

app.listen(config.port, () => console.log(`REIMSIS API listening on http://localhost:${config.port}`));
