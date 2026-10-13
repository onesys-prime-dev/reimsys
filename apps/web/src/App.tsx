import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './auth';
import { NotificationBell } from './components/Notifications';
import { AccessPage } from './pages/Access';
import { AuditPage } from './pages/Audit';
import { DashboardPage } from './pages/Dashboard';
import { ForcePasswordPage } from './pages/ForcePassword';
import { ImportPage } from './pages/Import';
import { LoginPage } from './pages/Login';
import { ProfilePage } from './pages/Profile';
import { ReceiptDetailPage } from './pages/ReceiptDetail';
import { ReceiptFormPage } from './pages/ReceiptForm';
import { ReceiptsPage } from './pages/Receipts';
import { ReportsPage } from './pages/Reports';
import { ReportViewPage } from './pages/ReportView';
import { Avatar, Icon } from './ui';

function titleFor(path: string) {
  if (path === '/') return 'Dashboard';
  if (path === '/receipts/new') return 'New receipt';
  if (path === '/receipts/import') return 'Import receipts';
  if (path.startsWith('/reports/')) return 'Report';
  if (path.startsWith('/receipts/')) return path.endsWith('/edit') ? 'Edit receipt' : 'Receipt';
  return ({ '/receipts': 'Receipts', '/reports': 'Reports', '/access': 'Access control', '/audit': 'Audit log', '/profile': 'Profile' } as Record<string, string>)[path] ?? 'REIMSIS';
}

function Shell() {
  const { me, can, signOut } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  if (!me) return null;
  const own = can('receipt.create') && !can('receipt.view_all');
  const items = [
    { to: '/', label: 'Dashboard', icon: 'home', show: true },
    { to: '/receipts', label: own ? 'My receipts' : 'Receipts', icon: 'file', show: can('receipt.create') || can('receipt.view_all') || can('review.decide') },
    { to: '/receipts/new', label: 'New receipt', icon: 'plus', show: can('receipt.create') },
    { to: '/reports', label: 'Reports', icon: 'chart', show: can('report.generate') },
    { to: '/access', label: 'Access', icon: 'shield', show: can('user.manage') || can('role.manage') },
    { to: '/audit', label: 'Audit log', icon: 'list', show: can('audit.view') },
  ].filter((i) => i.show);

  const link = (i: (typeof items)[number]) => (
    <NavLink key={i.to} to={i.to} end className={({ isActive }) => (isActive || (i.to === '/receipts' && /^\/receipts\/(\d+)/.test(loc.pathname)) || (i.to === '/receipts' && loc.pathname === '/receipts/import') ? 'on' : '')}>
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
          <div className="t">{titleFor(loc.pathname)}</div>
          <NotificationBell />
          <button className="iconbtn" onClick={() => nav('/profile')} aria-label="Profile"><Avatar name={me.name} userId={me.id} hasPhoto={me.hasPhoto} size={30} /></button>
          <button className="iconbtn" onClick={() => signOut()} aria-label="Sign out"><Icon name="logout" /></button>
        </header>
        <main className="page">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/receipts" element={<ReceiptsPage />} />
            <Route path="/receipts/new" element={can('receipt.create') ? <ReceiptFormPage /> : <Navigate to="/receipts" replace />} />
            <Route path="/receipts/import" element={can('receipt.import') ? <ImportPage /> : <Navigate to="/receipts" replace />} />
            <Route path="/receipts/:id" element={<ReceiptDetailPage />} />
            <Route path="/receipts/:id/edit" element={<ReceiptFormPage />} />
            <Route path="/reports/:id" element={can('report.generate') ? <ReportViewPage /> : <Navigate to="/" replace />} />
            <Route path="/reports" element={can('report.generate') ? <ReportsPage /> : <Navigate to="/" replace />} />
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
