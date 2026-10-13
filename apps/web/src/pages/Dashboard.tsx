import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';

const BLURB: Record<string, string> = {
  medref: 'Encode receipts, attach evidence and track each one.',
  checker: 'Verify receipts and evidence, oldest first.',
  approver: 'Only checked records reach you.',
  admin: 'Manage who can sign in and what each role can do.',
};

export function DashboardPage() {
  const { me, can } = useAuth();
  const manage = can('user.manage');
  const users = useQuery({ queryKey: ['users', 'summary'], enabled: manage, queryFn: () => api<{ users: { isActive: boolean }[] }>('/users') });
  const roles = useQuery({ queryKey: ['roles'], enabled: manage, queryFn: () => api<{ roles: unknown[] }>('/roles') });
  const audit = useQuery({ queryKey: ['audit', 'count'], enabled: can('audit.view'), queryFn: () => api<{ total: number }>('/audit?pageSize=1') });
  if (!me) return null;
  const hr = new Date().getHours();
  const greet = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <>
      <div className="ph">
        <div>
          <h1>{greet}, {me.name.split(' ')[0]}</h1>
          <p>{BLURB[me.role.code] ?? 'Welcome to REIMSIS.'}</p>
        </div>
      </div>

      {manage && (
        <div className="tiles">
          <Link className="tile alert" to="/access"><small>Active users</small><b>{users.data ? users.data.users.filter((u) => u.isActive).length : '–'}</b></Link>
          <Link className="tile" to="/access"><small>Roles</small><b>{roles.data?.roles.length ?? '–'}</b></Link>
          {can('audit.view') && <Link className="tile" to="/audit"><small>Audit events</small><b>{audit.data?.total ?? '–'}</b></Link>}
        </div>
      )}

      <section className="card">
        <div className="card-h"><h2>What is available now</h2></div>
        <div className="card-b">
          <p style={{ margin: 0 }}>Sign in, profile, and access control are ready. Receipts, evidence, review and reports arrive in the next build phases.</p>
          <p className="muted" style={{ margin: '10px 0 0' }}>
            You are signed in as <b>{me.role.name}</b>. See your own permissions on your <Link to="/profile" style={{ color: 'var(--accent)' }}>profile</Link>.
          </p>
        </div>
      </section>
    </>
  );
}
