import { prisma } from '../db.js';

type Handler = (payload: any) => Promise<void>;
const handlers = new Map<string, Handler>();

export const registerJob = (type: string, fn: Handler) => void handlers.set(type, fn);

export async function enqueue(type: string, payload: unknown, runAt = new Date()) {
  return prisma.job.create({ data: { type, payload: JSON.stringify(payload), runAt } });
}

const MAX_ATTEMPTS = 5;
let busy = false;

async function tick() {
  if (busy) return;
  busy = true;
  try {
    for (let i = 0; i < 20; i++) {
      const next = await prisma.job.findFirst({ where: { status: 'pending', runAt: { lte: new Date() } }, orderBy: { id: 'asc' } });
      if (!next) break;
      const claimed = await prisma.job.updateMany({ where: { id: next.id, status: 'pending' }, data: { status: 'running', attempts: { increment: 1 } } });
      if (!claimed.count) continue;
      const handler = handlers.get(next.type);
      try {
        if (!handler) throw new Error(`No handler for job type ${next.type}`);
        await handler(JSON.parse(next.payload));
        await prisma.job.update({ where: { id: next.id }, data: { status: 'done', finishedAt: new Date(), lastError: null } });
      } catch (err) {
        const attempts = next.attempts + 1;
        const message = (err instanceof Error ? err.message : String(err)).slice(0, 300);
        const final = attempts >= MAX_ATTEMPTS;
        await prisma.job.update({
          where: { id: next.id },
          data: { status: final ? 'failed' : 'pending', lastError: message, runAt: new Date(Date.now() + attempts * 30_000), finishedAt: final ? new Date() : null },
        });
        console.error(`job ${next.id} (${next.type}) failed`, message);
      }
    }
  } finally {
    busy = false;
  }
}

/** Runs inside the API process. One worker is enough for the planned scale. */
export async function startWorker() {
  await prisma.job.updateMany({ where: { status: 'running' }, data: { status: 'pending' } });
  setInterval(() => void tick().catch((e) => console.error('worker tick', e)), 2000);
  void tick();
}
