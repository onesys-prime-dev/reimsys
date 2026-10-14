import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { announceWrite, hub } from '../src/lib/realtime';

/** A stand-in for a browser connection that remembers what it was sent. */
function fakeClient(userId: number) {
  const written: string[] = [];
  const req = new EventEmitter() as any;
  const res = new EventEmitter() as any;
  res.status = () => res; res.set = () => res; res.flushHeaders = () => undefined; res.end = () => res.emit('end');
  res.write = (t: string) => { written.push(t); return true; };
  hub.connect(userId, req, res);
  const changes = () => written.filter((w) => w.startsWith('event: change')).map((w) => JSON.parse(/data: (.+)/.exec(w)![1]!).scopes as string[]);
  return { written, changes, close: () => req.emit('close') };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { hub.closeAll(); vi.useRealTimers(); });

describe('live updates', () => {
  it('greets a new connection', () => {
    const a = fakeClient(1);
    expect(a.written.join('')).toContain('event: hello');
  });

  it('tells everyone when a receipt changes, naming only the area', () => {
    const a = fakeClient(1), b = fakeClient(2);
    announceWrite('Receipt', 'update', { where: { id: 7 }, data: { status: 'approved', payee: 'Secret Clinic' } });
    vi.advanceTimersByTime(500);
    expect(a.changes()).toEqual([['receipts']]);
    expect(b.changes()).toEqual([['receipts']]);
    expect(JSON.stringify(a.written)).not.toContain('Secret Clinic');
  });

  it('sends one signal for many writes that happen together', () => {
    const a = fakeClient(1);
    for (const m of ['Receipt', 'ReceiptEvidence', 'ReimbursementDocument', 'Comment']) announceWrite(m, 'create', {});
    announceWrite('AuditLog', 'create', {});
    vi.advanceTimersByTime(500);
    expect(a.changes()).toHaveLength(1);
    expect(a.changes()[0]!.sort()).toEqual(['audit', 'receipts']);
  });

  it('ignores reads', () => {
    const a = fakeClient(1);
    announceWrite('Receipt', 'findMany', {});
    announceWrite('Receipt', 'count', {});
    vi.advanceTimersByTime(500);
    expect(a.changes()).toEqual([]);
  });

  it('ignores tables nobody watches, such as sessions and counters', () => {
    const a = fakeClient(1);
    announceWrite('Session', 'update', { data: { lastSeenAt: new Date() } });
    announceWrite('Sequence', 'upsert', {});
    announceWrite('Job', 'update', {});
    vi.advanceTimersByTime(500);
    expect(a.changes()).toEqual([]);
  });

  it('keeps a notification to the person it is for', () => {
    const a = fakeClient(1), b = fakeClient(2);
    announceWrite('Notification', 'createMany', { data: [{ userId: 2, text: 'hi' }] });
    vi.advanceTimersByTime(500);
    expect(a.changes()).toEqual([]);
    expect(b.changes()).toEqual([['notifications']]);
  });

  it('keeps "mark as read" to the person who did it', () => {
    const a = fakeClient(1), b = fakeClient(2);
    announceWrite('Notification', 'updateMany', { where: { userId: 1, readAt: null }, data: { readAt: new Date() } });
    vi.advanceTimersByTime(500);
    expect(a.changes()).toEqual([['notifications']]);
    expect(b.changes()).toEqual([]);
  });

  it('does not make everyone refresh because someone signed in', () => {
    const a = fakeClient(1);
    announceWrite('User', 'update', { where: { id: 3 }, data: { lastLoginAt: new Date(), failedAttempts: 0, lockedUntil: null } });
    vi.advanceTimersByTime(500);
    expect(a.changes()).toEqual([]);
  });

  it('tells the user list, and only that person\'s own account, when a user is edited', () => {
    const a = fakeClient(1), b = fakeClient(3);
    announceWrite('User', 'update', { where: { id: 3 }, data: { roleId: 2 } });
    vi.advanceTimersByTime(500);
    expect(a.changes()).toEqual([['access']]);
    expect(b.changes()[0]!.sort()).toEqual(['access', 'me']);
  });

  it('makes everyone re-read their access when role permissions change', () => {
    const a = fakeClient(1);
    announceWrite('RolePermission', 'createMany', { data: [] });
    vi.advanceTimersByTime(500);
    expect(a.changes()[0]!.sort()).toEqual(['access', 'me']);
  });

  it('switching someone off closes their connection after telling them', () => {
    const a = fakeClient(1), b = fakeClient(3);
    announceWrite('User', 'update', { where: { id: 3 }, data: { isActive: false } });
    expect(b.written.join('')).toContain('"scopes":["me"]');
    vi.advanceTimersByTime(500);
    expect(hub.size).toBe(1);
    expect(a.changes().flat()).not.toContain('me');
  });

  it('forgets a connection when the browser goes away', () => {
    const a = fakeClient(1);
    expect(hub.size).toBe(1);
    a.close();
    expect(hub.size).toBe(0);
  });

  it('beats now and then so quiet connections are not cut off', () => {
    const a = fakeClient(1);
    vi.advanceTimersByTime(21_000);
    expect(a.written.join('')).toContain(': ping');
  });

  it('allows a person at most ten connections, dropping the oldest', () => {
    for (let i = 0; i < 13; i++) fakeClient(5);
    expect(hub.size).toBe(10);
  });
});
