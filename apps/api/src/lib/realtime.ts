import type { Request, Response } from 'express';

/**
 * Live updates. Each signed-in browser keeps one open connection (Server-Sent Events). When data changes, the server sends
 * a tiny "this area changed" signal and the screen refreshes just that area itself. Nothing private travels in the signal:
 * it names an area, never a person's receipt or comment, and the screen still has to ask the normal way (with its own
 * permissions) for the new data.
 */

export type Scope = 'receipts' | 'notifications' | 'reports' | 'access' | 'me' | 'categories' | 'emails' | 'audit' | 'settings';

/** Which database tables, when written, change which area of the screen. Anything not listed is not announced. */
export const MODEL_SCOPE: Record<string, Scope> = {
  Receipt: 'receipts', ReceiptEvidence: 'receipts', ReimbursementDocument: 'receipts', Comment: 'receipts',
  Notification: 'notifications',
  LiquidationReport: 'reports',
  Category: 'categories',
  EmailLog: 'emails',
  AuditLog: 'audit',
  Setting: 'settings',
};

interface Client { id: number; userId: number; sessionId: string; res: Response }

const BATCH_MS = 350;
const HEARTBEAT_MS = 20_000;
const MAX_PER_USER = 10;

class Hub {
  private clients = new Set<Client>();
  private nextId = 1;
  /** scope -> people it is for (null = everyone connected), collected over a short moment and sent once. */
  private pending = new Map<Scope, Set<number> | null>();
  private timer: NodeJS.Timeout | null = null;
  private beat: NodeJS.Timeout | null = null;

  get size() { return this.clients.size; }

  /** Opens the stream for one browser tab. */
  connect(userId: number, req: Request, res: Response, sessionId = '') {
    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // tells nginx not to hold the stream back
    });
    res.flushHeaders();
    res.write('retry: 3000\n\n');

    // A runaway page cannot hog the server: only the newest few streams per person stay open.
    const mine = [...this.clients].filter((c) => c.userId === userId);
    while (mine.length >= MAX_PER_USER) this.drop(mine.shift()!);

    const client: Client = { id: this.nextId++, userId, sessionId, res };
    this.clients.add(client);
    res.write(`event: hello\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`);
    const gone = () => this.drop(client, false);
    req.on('close', gone);
    res.on('error', gone);
    this.ensureBeat();
    return client;
  }

  private drop(c: Client, end = true) {
    this.clients.delete(c);
    if (end) { try { c.res.end(); } catch { /* already closed */ } }
    if (!this.clients.size && this.beat) { clearInterval(this.beat); this.beat = null; }
  }

  private ensureBeat() {
    if (this.beat) return;
    // A comment line keeps proxies and phones from closing a quiet connection.
    this.beat = setInterval(() => { for (const c of this.clients) this.safeWrite(c, ': ping\n\n'); }, HEARTBEAT_MS);
    this.beat.unref();
  }

  private safeWrite(c: Client, text: string) {
    try { c.res.write(text); } catch { this.drop(c, false); }
  }

  /** Announce a change. `users` limits it to those people; leave it out to tell everyone connected. */
  emit(scope: Scope, users?: number[]) {
    if (!this.clients.size) return;
    const cur = this.pending.get(scope);
    if (cur === null) { /* already for everyone */ }
    else if (!users) this.pending.set(scope, null);
    else this.pending.set(scope, new Set([...(cur ?? []), ...users]));
    if (!this.timer) {
      // Many writes happen together (one approval touches several tables). Send one signal per area, after they have settled.
      this.timer = setTimeout(() => this.flush(), BATCH_MS);
      this.timer.unref();
    }
  }

  private flush() {
    this.timer = null;
    const batch = this.pending;
    this.pending = new Map();
    for (const c of [...this.clients]) {
      const scopes = [...batch].filter(([, to]) => to === null || to.has(c.userId)).map(([s]) => s);
      if (scopes.length) this.safeWrite(c, `event: change\ndata: ${JSON.stringify({ scopes })}\n\n`);
    }
  }

  /** The sessions that currently have a live connection open. */
  sessionIds() { return [...new Set([...this.clients].map((c) => c.sessionId).filter(Boolean))]; }

  /** Ends the live connections of sessions that no longer exist (signed out, timed out, switched off). Each is told to re-check first. */
  closeSessions(dead: Set<string>) {
    for (const c of [...this.clients]) {
      if (!dead.has(c.sessionId)) continue;
      this.safeWrite(c, `event: change
data: ${JSON.stringify({ scopes: ['me'] })}

`);
      setTimeout(() => this.drop(c), 250).unref();
    }
  }

  /** Ends every stream belonging to one person, for example when their account is switched off. */
  disconnectUser(userId: number) {
    for (const c of [...this.clients]) {
      if (c.userId !== userId) continue;
      // Tell their screen to re-check who it is signed in as (it will find out it has been switched off), then close.
      this.safeWrite(c, `event: change\ndata: ${JSON.stringify({ scopes: ['me'] })}\n\n`);
      setTimeout(() => this.drop(c), 250).unref();
    }
  }

  closeAll() {
    for (const c of [...this.clients]) this.drop(c);
    if (this.timer) clearTimeout(this.timer);
  }
}

export const hub = new Hub();

const WRITES = new Set(['create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']);

/** Who a notification write is for, so a "mark read" does not make every other person's screen refresh. */
function notificationUsers(operation: string, args: any): number[] | undefined {
  const ids = new Set<number>();
  const take = (v: unknown) => { if (typeof v === 'number') ids.add(v); };
  if (operation === 'createMany' || operation === 'createManyAndReturn') { for (const d of Array.isArray(args?.data) ? args.data : [args?.data]) take(d?.userId); }
  else if (operation === 'create') take(args?.data?.userId);
  else take(args?.where?.userId);
  return ids.size ? [...ids] : undefined;
}

/** Things that happen on every sign-in and page visit. They change nothing anyone needs to see, so they are not announced. */
const ROUTINE_USER_FIELDS = new Set(['lastLoginAt', 'failedAttempts', 'lockedUntil']);

/** Called after every database write. Decides whether anyone's screen needs to know. */
export function announceWrite(model: string, operation: string, args: unknown) {
  if (!WRITES.has(operation)) return;
  const a = args as any;
  if (model === 'User') {
    const fields = Object.keys(a?.data ?? {});
    if (operation === 'update' && fields.length && fields.every((f) => ROUTINE_USER_FIELDS.has(f))) return;
    hub.emit('access');
    const id = a?.where?.id;
    // A switched-off account loses its live connection straight away.
    if (a?.data?.isActive === false && typeof id === 'number') hub.disconnectUser(id);
    hub.emit('me', typeof id === 'number' ? [id] : undefined); // their own sign-in details, name or role may have changed
    return;
  }
  if (model === 'Role' || model === 'RolePermission' || model === 'Permission') {
    hub.emit('access');
    hub.emit('me'); // what people may do just changed, so everyone re-reads their own access
    return;
  }
  const scope = MODEL_SCOPE[model];
  if (!scope) return;
  hub.emit(scope, scope === 'notifications' ? notificationUsers(operation, args) : undefined);
}
