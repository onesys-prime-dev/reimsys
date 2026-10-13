import type { Request } from 'express';
import { prisma } from '../db.js';

interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | number | null;
  summary?: string;
  before?: unknown;
  after?: unknown;
  actor?: { id: number | null; name: string };
}

const json = (v: unknown) => (v === undefined ? null : JSON.stringify(v));

/** Writes one append-only audit row. Never throws into the request path. */
export async function audit(req: Request | null, input: AuditInput) {
  try {
    const actor = input.actor ?? (req?.auth ? { id: req.auth.user.id, name: req.auth.user.name } : { id: null, name: 'System' });
    await prisma.auditLog.create({
      data: {
        actorId: actor.id,
        actorName: actor.name,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId == null ? null : String(input.entityId),
        summary: input.summary?.slice(0, 255) ?? null,
        before: json(input.before),
        after: json(input.after),
        ip: req?.ip?.slice(0, 64) ?? null,
        userAgent: req?.get('user-agent')?.slice(0, 255) ?? null,
      },
    });
  } catch (err) {
    console.error('audit write failed', err);
  }
}
