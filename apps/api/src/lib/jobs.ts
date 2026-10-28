import { prisma } from '../db.js';

type Handler = (payload: any) => Promise<void>;
const handlers = new Map<string, Handler>();

export const registerJob = (type: string, fn: Handler) => void handlers.set(type, fn);

export async function enqueue(type: string, payload: unknown, runAt = new Date()) {
  return prisma.job.create({ data: { type, payload: JSON.stringify(payload), runAt } });
}

/** Waits before each retry. Emails keep trying for about a day, because the mail server may be down for hours; other jobs give up sooner. */
const RETRY_SECONDS: Record<string, number[]> = {
  email: [30, 60, 120, 300, 600, 1800, 3600, 7200, 10800, 14400, 21600, 21600],
};
const DEFAULT_RETRY = [30, 60, 120, 120];
const finalHandlers = new Map<string, (payload: any, message: string) => Promise<void>>();
/** Runs once when a job has used up every retry. */
export const onJobGivesUp = (type: string, fn: (payload: any, message: string) => Promise<void>) => void finalHandlers.set(type, fn);
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
        const waits = RETRY_SECONDS[next.type] ?? DEFAULT_RETRY;
        const final = attempts > waits.length;
        await prisma.job.update({
          where: { id: next.id },
          data: { status: final ? 'failed' : 'pending', lastError: message, runAt: new Date(Date.now() + (waits[attempts - 1] ?? waits[waits.length - 1]!) * 1000), finishedAt: final ? new Date() : null },
        });
        console.error(`job ${next.id} (${next.type}) failed`, message);
        if (final) await finalHandlers.get(next.type)?.(JSON.parse(next.payload), message).catch((e) => console.error('give-up handler', e));
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
