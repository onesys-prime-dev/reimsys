import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './auth';
import { Avatar, Icon } from './ui';
import { AccessPage } from './pages/Access';
import { AuditPage } from './pages/Audit';
import { DashboardPage } from './pages/Dashboard';
import { ForcePasswordPage } from './pages/ForcePassword';
import { LoginPage } from './pages/Login';
import { ProfilePage } from './pages/Profile';

const TITLES: Record<string, string> = { '/': 'Dashboard', '/access': 'Access control', '/audit': 'Audit log', '/profile': 'Profile' };

function Shell() {
  const { me, can, signOut } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  if (!me) return null;
  const items = [
    { to: '/', label: 'Dashboard', icon: 'home', show: true },
    { to: '/access', label: 'Access', icon: 'shield', show: can('user.manage') || can('role.manage') },
    { to: '/audit', label: 'Audit log', icon: 'list', show: can('audit.view') },
  ].filter((i) => i.show);

  const link = (i: (typeof items)[number]) => (
    <NavLink key={i.to} to={i.to} end={i.to === '/'} className={({ isActive }) => (isActive ? 'on' : '')}>
      <Icon name={i.icon} />
      <span>{i.label}</span>
    </NavLink>
  );

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><span className="logo">R</span><b>REIMSIS</b></div>
        <nav className="nav" aria-label="Main">{items.map(link)}</nav>
        <button className="who" onClick={() => nav('/profile')}>
          <Avatar name={me.name} userId={me.id} hasPhoto={me.hasPhoto} />
          <span><b>{me.name}</b><small>{me.role.name}</small></span>
        </button>
      </aside>
      <div className="main">
        <header className="top">
          <div className="t">{TITLES[loc.pathname] ?? 'REIMSIS'}</div>
          <button className="iconbtn" onClick={() => nav('/profile')} aria-label="Profile">
            <Avatar name={me.name} userId={me.id} hasPhoto={me.hasPhoto} size={30} />
          </button>
          <button className="iconbtn" onClick={() => signOut()} aria-label="Sign out"><Icon name="logout" /></button>
        </header>
        <main className="page">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/access" element={can('user.manage') || can('role.manage') ? <AccessPage /> : <Navigate to="/" replace />} />
            <Route path="/audit" element={can('audit.view') ? <AuditPage /> : <Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
      <nav className="bnav" aria-label="Main">{items.map(link)}</nav>
    </div>
  );
}

export function App() {
  const { me, loading } = useAuth();
  if (loading) return <div className="login"><span className="muted">Loading…</span></div>;
  if (!me) return <LoginPage />;
  if (me.mustChangePassword) return <ForcePasswordPage />;
  return <Shell />;
}
