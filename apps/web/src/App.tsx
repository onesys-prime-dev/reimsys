import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './auth';
import { NotificationBell } from './components/Notifications';
import { LiveLight, useLive } from './live';
import { SessionGuard } from './components/SessionGuard';
import { Suspense, lazy } from 'react';
import { DashboardPage } from './pages/Dashboard';
import { ForcePasswordPage } from './pages/ForcePassword';
import { LoginPage } from './pages/Login';
import { HelpPage } from './pages/Help';
import { PrivacyAcceptPage, PrivacyInAppPage, PrivacyPublicPage } from './pages/Privacy';
import { ForgotPasswordPage, ResetPasswordPage } from './pages/PasswordLink';
import { ReceiptDetailPage } from './pages/ReceiptDetail';
import { ReceiptsPage } from './pages/Receipts';

// Screens most people open rarely load on demand, so the first page is much smaller.
const AccessPage = lazy(() => import('./pages/Access').then((m) => ({ default: m.AccessPage })));
const AuditPage = lazy(() => import('./pages/Audit').then((m) => ({ default: m.AuditPage })));
const ImportPage = lazy(() => import('./pages/Import').then((m) => ({ default: m.ImportPage })));
const ProfilePage = lazy(() => import('./pages/Profile').then((m) => ({ default: m.ProfilePage })));
const ReceiptFormPage = lazy(() => import('./pages/ReceiptForm').then((m) => ({ default: m.ReceiptFormPage })));
const ReportsPage = lazy(() => import('./pages/Reports').then((m) => ({ default: m.ReportsPage })));
const ReadyToPayPage = lazy(() => import('./pages/ReadyToPay').then((m) => ({ default: m.ReadyToPayPage })));
const ReportViewPage = lazy(() => import('./pages/ReportView').then((m) => ({ default: m.ReportViewPage })));
import { Logo } from './components/Logo';
import { Avatar, Icon } from './ui';

const isForm = (p: string) => p === '/receipts/new' || /^\/receipts\/\d+\/edit$/.test(p);

function titleFor(path: string) {
  if (path === '/') return 'Dashboard';
  if (path === '/receipts/new') return 'New receipt';
  if (path === '/receipts/import') return 'Import receipts';
  if (path.startsWith('/reports/')) return 'Report';
  if (path.startsWith('/receipts/')) return path.endsWith('/edit') ? 'Edit receipt' : 'Receipt';
  return ({ '/receipts': 'Receipts', '/pay': 'Ready to pay', '/reports': 'Reports', '/access': 'Access control', '/audit': 'Audit log', '/profile': 'Profile', '/help': 'Help' } as Record<string, string>)[path] ?? 'REIMSYS';
}

function Shell() {
  const { me, can, signOut } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const live = useLive(!!me && !me.mustChangePassword && !me.privacyRequired);
  if (!me) return null;
  const own = can('receipt.create') && !can('receipt.view_all');
  const items = [
    { to: '/', label: 'Dashboard', icon: 'home', show: true },
    { to: '/receipts', label: own ? 'My receipts' : 'Receipts', icon: 'file', show: can('receipt.create') || can('receipt.view_all') || can('review.decide') || can('payment.mark') },
    { to: '/pay', label: 'Ready to pay', icon: 'wallet', show: can('payment.mark') },
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
        <NavLink to="/" className="brand" aria-label="Go to the dashboard" style={{ textDecoration: 'none', color: 'inherit' }}><Logo size={34} /></NavLink>
        <nav className="nav" aria-label="Main">{items.map(link)}</nav>
        <button className="who" onClick={() => nav('/profile')}>
          <Avatar name={me.name} userId={me.id} hasPhoto={me.hasPhoto} photoV={me.photoV} />
          <span><b>{me.name}</b><small>{me.role.name}</small></span>
        </button>
        <div className="side-links"><NavLink to="/help" className="privacy-link">Help</NavLink><NavLink to="/privacy" className="privacy-link">Privacy notice</NavLink></div>
      </aside>
      <div className="main">
        <header className="top">
          <div className="t">{titleFor(loc.pathname)}</div>
          <LiveLight state={live} />
          <button className="iconbtn" onClick={() => nav('/help')} aria-label="Help" title="Help"><Icon name="info" /></button>
          <NotificationBell />
          <button className="iconbtn" onClick={() => nav('/profile')} aria-label="Profile"><Avatar name={me.name} userId={me.id} hasPhoto={me.hasPhoto} photoV={me.photoV} size={30} /></button>
          <button className="iconbtn" onClick={() => signOut()} aria-label="Sign out"><Icon name="logout" /></button>
        </header>
        <SessionGuard />
        <main className={`page ${['/receipts', '/pay', '/audit', '/access'].includes(loc.pathname) || loc.pathname.startsWith('/reports/') ? 'fit' : ''} ${loc.pathname === '/' ? 'dash' : ''} ${loc.pathname === '/reports' ? 'rfit' : ''} ${isForm(loc.pathname) ? 'narrow' : ''}`}>
          <Suspense fallback={<div className="empty">Loading…</div>}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/receipts" element={<ReceiptsPage />} />
            <Route path="/receipts/new" element={can('receipt.create') ? <ReceiptFormPage /> : <Navigate to="/receipts" replace />} />
            <Route path="/receipts/import" element={can('receipt.import') ? <ImportPage /> : <Navigate to="/receipts" replace />} />
            <Route path="/receipts/:id" element={<ReceiptDetailPage />} />
            <Route path="/receipts/:id/edit" element={<ReceiptFormPage />} />
            <Route path="/pay" element={can('payment.mark') ? <ReadyToPayPage /> : <Navigate to="/" replace />} />
            <Route path="/reports/:id" element={can('report.generate') ? <ReportViewPage /> : <Navigate to="/" replace />} />
            <Route path="/reports" element={can('report.generate') ? <ReportsPage /> : <Navigate to="/" replace />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/privacy" element={<PrivacyInAppPage />} />
            <Route path="/help" element={<HelpPage />} />
            <Route path="/access" element={can('user.manage') || can('role.manage') ? <AccessPage /> : <Navigate to="/" replace />} />
            <Route path="/audit" element={can('audit.view') ? <AuditPage /> : <Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
        </main>
      </div>
      <nav className="bnav" aria-label="Main">{items.map(link)}</nav>
    </div>
  );
}

export function App() {
  const { me, loading } = useAuth();
  const { pathname } = useLocation();
  // The password link pages work whether or not someone is signed in on this browser.
  if (pathname === '/reset' || pathname === '/forgot') return <Routes><Route path="/forgot" element={<ForgotPasswordPage />} /><Route path="/reset" element={<ResetPasswordPage />} /></Routes>;
  if (loading) return <div className="login"><span className="muted">Loading…</span></div>;
  if (!me) {
    return (
      <Routes>
        <Route path="/forgot" element={<ForgotPasswordPage />} />
        <Route path="/reset" element={<ResetPasswordPage />} />
        <Route path="/privacy" element={<PrivacyPublicPage />} />
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }
  if (me.mustChangePassword) return <ForcePasswordPage />;
  if (me.privacyRequired) return pathname === '/privacy' ? <PrivacyPublicPage /> : <PrivacyAcceptPage />;
  return <Shell />;
}
