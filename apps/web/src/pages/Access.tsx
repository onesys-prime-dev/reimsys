import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useEffect, useMemo, useState, type FormEvent } from 'react';
import { PERMISSIONS, isLockedGrant, type RoleSummary } from '@reimsys/shared';
import { api, errMsg, fmtDateTime } from '../api';
import { useAuth } from '../auth';
import { EmailSettingsTab } from './EmailSettings';
import { EmailTemplatesTab } from './EmailTemplates';
import { Avatar, CopyBox, Empty, Field, Icon, Modal, Switch, useToast } from '../ui';

interface UserRow {
  id: number; name: string; email: string; isActive: boolean; mustChangePassword: boolean;
  lockedUntil: string | null; lastLoginAt: string | null; hasPhoto: boolean; role: RoleSummary;
}

export function AccessPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'users' | 'perms' | 'cats' | 'mail' | 'tpl'>(can('user.manage') ? 'users' : 'perms');
  return (
    <>
      <div className="ph"><div><h1>Access control</h1><p>Manage who can sign in and what each role can do.</p></div></div>
      <div className="tabs" role="tablist">
        {can('user.manage') && <button role="tab" aria-selected={tab === 'users'} className={tab === 'users' ? 'on' : ''} onClick={() => setTab('users')}>Users</button>}
        <button role="tab" aria-selected={tab === 'perms'} className={tab === 'perms' ? 'on' : ''} onClick={() => setTab('perms')}>Roles and permissions</button>
        {can('category.manage') && <button role="tab" aria-selected={tab === 'cats'} className={tab === 'cats' ? 'on' : ''} onClick={() => setTab('cats')}>Categories</button>}
        {can('settings.manage') && <button role="tab" aria-selected={tab === 'mail'} className={tab === 'mail' ? 'on' : ''} onClick={() => setTab('mail')}>Email</button>}
        {can('settings.manage') && <button role="tab" aria-selected={tab === 'tpl'} className={tab === 'tpl' ? 'on' : ''} onClick={() => setTab('tpl')}>Email templates</button>}
      </div>
      {tab === 'users' ? <UsersTab /> : tab === 'cats' ? <CategoriesTab /> : tab === 'mail' ? <EmailSettingsTab /> : tab === 'tpl' ? <EmailTemplatesTab /> : <PermsTab />}
    </>
  );
}

/* ================= users ================= */

function UsersTab() {
  const { me } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [showOff, setShowOff] = useState(false);
  const [managing, setManaging] = useState<UserRow | null>(null);
  const users = useQuery({ queryKey: ['users', q], queryFn: () => api<{ users: UserRow[] }>(`/users?q=${encodeURIComponent(q)}`), placeholderData: (p) => p });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api<{ roles: RoleSummary[] }>('/roles') });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['users'] }); qc.invalidateQueries({ queryKey: ['roles'] }); };

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) => api(`/users/${id}`, { method: 'PATCH', body }),
    onSuccess: () => { toast('User updated.'); refresh(); },
    onError: (e) => { toast(errMsg(e), 'bad'); refresh(); },
  });

  const myRank = me!.role.rank;
  const all = users.data?.users ?? [];
  const off = all.filter((u) => !u.isActive).length;
  // People who have left stay on record, but they should not crowd out the people who work here now.
  const shown = showOff ? all : all.filter((u) => u.isActive);
  return (
    <>
      <div className="tools">
        <div className="search"><Icon name="search" size={18} /><input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" aria-label="Search users" /></div>
        {off > 0 && (
          <label className="showoff"><Switch checked={showOff} onChange={setShowOff} label="Show deactivated users" /><span>Show deactivated ({off})</span></label>
        )}
        <button className="btn pri" style={{ marginLeft: 'auto' }} onClick={() => setAdding(true)}><Icon name="plus" size={18} />Add user</button>
      </div>
      <section className="card">
        {shown.map((u) => {
          const self = u.id === me!.id;
          const above = u.role.rank > myRank;
          const locked = u.lockedUntil && new Date(u.lockedUntil) > new Date();
          return (
            <div className="urow x" key={u.id}>
              <div className="nm">
                <Avatar name={u.name} userId={u.id} hasPhoto={u.hasPhoto} />
                <div><b>{u.name}{self && <span className="muted"> (you)</span>}</b><small className="em">{u.email}</small></div>
              </div>
              <span className="em muted stt2">
                {!u.isActive ? 'Deactivated' : locked ? 'Locked' : u.mustChangePassword ? 'Invited' : (u.lastLoginAt ? `Last sign in ${fmtDateTime(u.lastLoginAt)}` : "Never signed in")}
              </span>
              <select className="rl" value={u.role.id} disabled={self || above} aria-label={`Role for ${u.name}`}
                onChange={(e) => patch.mutate({ id: u.id, body: { roleId: Number(e.target.value) } })}>
                {roles.data?.roles.filter((r) => r.rank <= myRank || r.id === u.role.id).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <span className="stt"><Switch checked={u.isActive} disabled={self || above} label={`Active: ${u.name}`} onChange={(v) => patch.mutate({ id: u.id, body: { isActive: v } })} /></span>
              <button className="btn sm act" disabled={above} onClick={() => setManaging(u)}>Manage</button>
            </div>
          );
        })}
        {users.data && !shown.length && <Empty title="No users found">{off > 0 && !showOff ? `Only deactivated users match. Turn on "Show deactivated" to see them.` : 'Try a different search.'}</Empty>}
        {!users.data && <div className="empty">Loading…</div>}
      </section>
      {adding && roles.data && <AddUser roles={roles.data.roles.filter((r) => r.rank <= myRank)} onClose={() => setAdding(false)} onDone={refresh} />}
      {managing && <ManageUser user={managing} onClose={() => setManaging(null)} onDone={refresh} />}
    </>
  );
}

function AddUser({ roles, onClose, onDone }: { roles: RoleSummary[]; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState(roles[0]?.id ?? 0);
  const [error, setError] = useState('');
  const [temp, setTemp] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => api<{ temporaryPassword: string }>('/users', { method: 'POST', body: { name, email, roleId } }),
    onSuccess: (d) => { setTemp(d.temporaryPassword); onDone(); },
    onError: (e) => setError(errMsg(e)),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); setError(''); create.mutate(); };

  if (temp) {
    return (
      <Modal title="User created" onClose={onClose}>
        <p>Give {name} this temporary password. They must choose their own when they first sign in. It is shown only once.</p>
        <CopyBox value={temp} />
        <div className="btns"><button className="btn pri" onClick={onClose}>Done</button></div>
      </Modal>
    );
  }
  return (
    <Modal title="Add user" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="stack">
          <Field label="Full name"><input type="text" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} autoFocus /></Field>
          <Field label="Email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
          <Field label="Role"><select value={roleId} onChange={(e) => setRoleId(Number(e.target.value))}>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
        </div>
        {error && <div className="callout bad" role="alert" style={{ margin: '14px 0 0' }}><div><span>{error}</span></div></div>}
        <div className="btns"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn pri" type="submit" disabled={create.isPending}>Create user</button></div>
      </form>
    </Modal>
  );
}

function ManageUser({ user, onClose, onDone }: { user: UserRow; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [temp, setTemp] = useState<string | null>(null);
  const sessions = useQuery({ queryKey: ['user-sessions', user.id], queryFn: () => api<{ sessions: { id: string }[] }>(`/users/${user.id}/sessions`) });
  const locked = !!user.lockedUntil && new Date(user.lockedUntil) > new Date();
  const reset = useMutation({
    mutationFn: () => api<{ temporaryPassword: string }>(`/users/${user.id}/reset-password`, { method: 'POST' }),
    onSuccess: (d) => { setTemp(d.temporaryPassword); onDone(); },
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  const unlock = useMutation({
    mutationFn: () => api(`/users/${user.id}/unlock`, { method: 'POST' }),
    onSuccess: () => { toast('Account unlocked.'); onDone(); onClose(); },
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  const logout = useMutation({
    mutationFn: () => api<{ revoked: number }>(`/users/${user.id}/sessions`, { method: 'DELETE' }),
    onSuccess: (d) => { toast(`Signed out of ${d.revoked} device${d.revoked === 1 ? '' : 's'}.`); onClose(); },
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  return (
    <Modal title={user.name} onClose={onClose}>
      <p>{user.email} · {user.role.name}</p>
      {temp ? (
        <>
          <p>New temporary password. They must change it at next sign in, and all their devices were signed out.</p>
          <CopyBox value={temp} />
        </>
      ) : (
        <div className="stack">
          <button className="btn" onClick={() => reset.mutate()} disabled={reset.isPending}><Icon name="key" size={18} />Reset password</button>
          {locked && <button className="btn" onClick={() => unlock.mutate()}><Icon name="lock" size={18} />Unlock account</button>}
          <button className="btn" onClick={() => logout.mutate()} disabled={!sessions.data?.sessions.length}><Icon name="logout" size={18} />Sign out of all devices{sessions.data ? ` (${sessions.data.sessions.length})` : ''}</button>
        </div>
      )}
      <div className="btns"><button className="btn pri" onClick={onClose}>Close</button></div>
    </Modal>
  );
}

/* ================= roles and permissions ================= */

interface PermData {
  permissions: { id: number; code: string; label: string; group: string }[];
  grants: Record<string, string[]>;
}

function PermsTab() {
  const { me, can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api<{ roles: RoleSummary[] }>('/roles') });
  const perms = useQuery({ queryKey: ['permissions'], queryFn: () => api<PermData>('/permissions') });
  const [draft, setDraft] = useState<Record<string, Set<string>> | null>(null);
  const [adding, setAdding] = useState(false);
  const canEdit = can('role.manage');

  const base = useMemo(() => {
    const o: Record<string, Set<string>> = {};
    if (perms.data) for (const [id, codes] of Object.entries(perms.data.grants)) o[id] = new Set(codes);
    return o;
  }, [perms.data]);
  useEffect(() => setDraft(null), [perms.data]);
  const cur = draft ?? base;

  const changed = useMemo(() => {
    if (!draft) return [] as string[];
    return Object.keys(draft).filter((id) => {
      const a = [...draft[id]!].sort().join(), b = [...(base[id] ?? [])].sort().join();
      return a !== b;
    });
  }, [draft, base]);

  const save = useMutation({
    mutationFn: async () => { for (const id of changed) await api(`/roles/${id}/permissions`, { method: 'PUT', body: { codes: [...draft![id]!] } }); },
    onSuccess: () => { toast('Permissions saved. They apply to signed-in users within a minute.'); qc.invalidateQueries({ queryKey: ['permissions'] }); qc.invalidateQueries({ queryKey: ['me'] }); },
    onError: (e) => toast(errMsg(e), 'bad'),
  });

  function toggle(roleId: number, code: string, on: boolean) {
    const next: Record<string, Set<string>> = {};
    for (const [k, v] of Object.entries(cur)) next[k] = new Set(v);
    const set = next[String(roleId)] ?? (next[String(roleId)] = new Set());
    on ? set.add(code) : set.delete(code);
    setDraft(next);
  }

  if (!roles.data || !perms.data) return <div className="empty">Loading…</div>;
  const groups = [...new Set(perms.data.permissions.map((p) => p.group))];
  const defs = new Map(PERMISSIONS.map((p) => [p.code, p]));

  return (
    <>
      <section className="card">
        <div className="card-h">
          <h2>Roles and permissions</h2>
          {canEdit && <button className="btn sm" onClick={() => setAdding(true)}><Icon name="plus" size={16} />Add role</button>}
        </div>
        <div className="matrix">
          <table>
            <thead>
              <tr>
                <th>Permission</th>
                {roles.data.roles.map((r) => <th key={r.id}>{r.name}<br /><span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>{r.userCount} user{r.userCount === 1 ? '' : 's'}</span></th>)}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g}>
                  <tr className="grp"><td colSpan={roles.data.roles.length + 1}>{g}</td></tr>
                  {perms.data.permissions.filter((p) => p.group === g).map((p) => (
                    <tr key={p.code}>
                      <td>{p.label}<br /><small style={{ fontFamily: 'monospace' }}>{p.code}</small></td>
                      {roles.data.roles.map((r) => {
                        const locked = isLockedGrant(r.code, p.code);
                        const blocked = !canEdit || r.rank > me!.role.rank;
                        return (
                          <td key={r.id}>
                            <input type="checkbox" checked={cur[String(r.id)]?.has(p.code) ?? false} disabled={locked || blocked}
                              aria-label={`${p.label} for ${r.name}`} onChange={(e) => toggle(r.id, p.code, e.target.checked)} />
                            {locked && <><br /><span className="lock"><Icon name="lock" size={12} />locked</span></>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {changed.length > 0 && (
        <div className="savebar">
          <span>{changed.length} role{changed.length === 1 ? '' : 's'} with unsaved changes</span>
          <span style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => setDraft(null)}>Discard</button>
            <button className="btn pri" onClick={() => save.mutate()} disabled={save.isPending}>Save changes</button>
          </span>
        </div>
      )}
      <p className="muted" style={{ fontSize: '.84rem' }}>
        Locked cells protect the review path so the system always has someone who can check and approve, and an administrator who can manage access. Every change is written to the audit log.
        {defs.size ? '' : ''}
      </p>
      {adding && <AddRole maxRank={me!.role.rank} onClose={() => setAdding(false)} onDone={() => { qc.invalidateQueries({ queryKey: ['roles'] }); qc.invalidateQueries({ queryKey: ['permissions'] }); }} />}
    </>
  );
}

function AddRole({ maxRank, onClose, onDone }: { maxRank: number; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [rank, setRank] = useState(25);
  const [error, setError] = useState('');
  const create = useMutation({
    mutationFn: () => api('/roles', { method: 'POST', body: { name, code, rank } }),
    onSuccess: () => { toast('Role created. Tick its permissions and save.'); onDone(); onClose(); },
    onError: (e) => setError(errMsg(e)),
  });
  return (
    <Modal title="Add role" onClose={onClose}>
      <p>For example, Accounting. A new role starts with no permissions.</p>
      <form onSubmit={(e) => { e.preventDefault(); setError(''); create.mutate(); }}>
        <div className="stack">
          <Field label="Name"><input type="text" value={name} onChange={(e) => { setName(e.target.value); setCode(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')); }} required autoFocus /></Field>
          <Field label="Code" hint="lowercase, used by the system"><input type="text" value={code} onChange={(e) => setCode(e.target.value)} required /></Field>
          <Field label="Rank" hint={`1 to ${Math.min(99, maxRank)}. Higher ranks can manage lower ones.`}><input type="number" min={1} max={Math.min(99, maxRank)} value={rank} onChange={(e) => setRank(Number(e.target.value))} required /></Field>
        </div>
        {error && <div className="callout bad" role="alert" style={{ margin: '14px 0 0' }}><div><span>{error}</span></div></div>}
        <div className="btns"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn pri" type="submit" disabled={create.isPending}>Create role</button></div>
      </form>
    </Modal>
  );
}

/* ================= categories ================= */

function CategoriesTab() {
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const list = useQuery({ queryKey: ['categories', 'all'], queryFn: () => api<{ categories: { id: number; name: string; isActive: boolean; receiptCount: number }[] }>('/categories?all=true') });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['categories'] }); };
  const add = useMutation({
    mutationFn: () => api('/categories', { method: 'POST', body: { name } }),
    onSuccess: () => { setName(''); toast('Category added.'); refresh(); },
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) => api(`/categories/${id}`, { method: 'PATCH', body }),
    onSuccess: refresh,
    onError: (e) => { toast(errMsg(e), 'bad'); refresh(); },
  });
  return (
    <>
      <form className="tools" onSubmit={(e) => { e.preventDefault(); if (name.trim().length >= 2) add.mutate(); }}>
        <div style={{ flex: '1 1 240px', maxWidth: 360 }}><input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="New category name" aria-label="New category name" /></div>
        <button className="btn pri" type="submit" disabled={name.trim().length < 2 || add.isPending}><Icon name="plus" size={18} />Add category</button>
      </form>
      <section className="card cats">
        {list.data?.categories.map((c) => (
          <div className="urow" key={c.id}>
            <b>{c.name}</b>
            <span className="muted">{c.receiptCount} receipt{c.receiptCount === 1 ? '' : 's'}</span>
            <span><Switch checked={c.isActive} label={`Active: ${c.name}`} onChange={(v) => patch.mutate({ id: c.id, body: { isActive: v } })} /></span>
          </div>
        ))}
        {!list.data && <div className="empty">Loading…</div>}
      </section>
      <p className="muted" style={{ fontSize: '.84rem' }}>Turning a category off hides it from new receipts. Existing receipts and reports keep it.</p>
    </>
  );
}
