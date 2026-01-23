import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './components/AuthContext';
import { LoginPage } from './pages/LoginPage';
import { ModsPage } from './pages/ModsPage';
import { ModEditorPage } from './pages/ModEditorPage';
import { GlossaryPage } from './pages/GlossaryPage';
import { DiffPage } from './pages/DiffPage';
import { EetImportsPage } from './pages/EetImportsPage';
import { CsvImportsPage } from './pages/CsvImportsPage';
import { ModImportsPage } from './pages/ModImportsPage';
import { DashboardPage } from './pages/DashboardPage';
import { TmxPage } from './pages/TmxPage';
import { UsersPage } from './pages/UsersPage';
import { ActivityPage } from './pages/ActivityPage';

const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
});

const NAV_LINKS = [
  { to: '/', label: 'Mods', exact: true },
  { to: '/eet', label: 'EET Import', exact: false },
  { to: '/csv', label: 'CSV Import', exact: false },
  { to: '/mod-import', label: 'Mod Import', exact: false },
  { to: '/glossary', label: 'Glossary', exact: false },
  { to: '/dashboard', label: 'Dashboard', exact: false },
  { to: '/tmx', label: 'TMX', exact: false },
  { to: '/diff', label: 'Diff', exact: false },
  { to: '/activity', label: 'Activity', exact: false },
  { to: '/users', label: 'Users', exact: false, multiUserOnly: true },
];

/**
 * Navigation bar — renders links and user info.
 * In multi-user mode, shows the current user's name and a logout button.
 */
const Nav = () => {
  const loc = useLocation();
  const { user, multiUser, logout } = useAuth();

  return (
    <nav style={navStyles.nav}>
      <span style={navStyles.brand}>FO4 Localizer</span>
      {NAV_LINKS
        .filter(l => !('multiUserOnly' in l && l.multiUserOnly) || multiUser)
        .map(({ to, label, exact }) => {
          const active = exact ? loc.pathname === to : loc.pathname.startsWith(to);
          return (
            <Link key={to} to={to} style={active ? navStyles.activeLink : navStyles.link}>
              {label}
            </Link>
          );
        })}

      {/* Spacer */}
      <span style={{ flex: 1 }} />

      {/* User info — always visible for admin, user display in multi-user mode */}
      {user && (
        <span style={navStyles.userInfo}>
          {user.display_name}
          {multiUser && user.role !== 'translator' && (
            <span style={navStyles.roleBadge}>{user.role}</span>
          )}
        </span>
      )}
      {multiUser && user && (
        <button onClick={logout} style={navStyles.logoutBtn}>Logout</button>
      )}
    </nav>
  );
}

/**
 * Main authenticated app shell — renders Nav + routes.
 * In multi-user mode, shows Login page if not authenticated.
 */
const AppShell = () => {
  const { loading, multiUser, user } = useAuth();

  // Show nothing while checking auth status
  if (loading) return null;

  // In multi-user mode, require authentication
  if (multiUser && !user) return <LoginPage />;

  return (
    <>
      <Nav />
      <main style={{ minHeight: 'calc(100vh - 48px)' }}>
        <Routes>
          <Route path="/" element={<ModsPage />} />
          <Route path="/mods/:id" element={<ModEditorPage />} />
          <Route path="/eet" element={<EetImportsPage />} />
          <Route path="/csv" element={<CsvImportsPage />} />
          <Route path="/mod-import" element={<ModImportsPage />} />
          <Route path="/glossary" element={<GlossaryPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/tmx" element={<TmxPage />} />
          <Route path="/diff" element={<DiffPage />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="/users" element={<UsersPage />} />
        </Routes>
      </main>
    </>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <BrowserRouter>
          <AppShell />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

const navStyles = {
  nav: {
    display: 'flex',
    alignItems: 'center',
    gap: 20,
    padding: '0 24px',
    height: 48,
    background: '#111',
    borderBottom: '1px solid #2a2a2a',
    position: 'sticky' as const,
    top: 0,
    zIndex: 100,
  },
  brand: { fontWeight: 700, fontSize: 16, color: '#d4a843', marginRight: 12 },
  link: { color: '#aaa', textDecoration: 'none', fontSize: 14 },
  activeLink: { color: '#fff', textDecoration: 'none', fontSize: 14, fontWeight: 600 },
  userInfo: { color: '#aaa', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 },
  roleBadge: {
    fontSize: 10,
    padding: '1px 6px',
    borderRadius: 3,
    background: '#d4a843',
    color: '#111',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
  },
  logoutBtn: {
    padding: '4px 12px',
    fontSize: 12,
    background: 'transparent',
    border: '1px solid #555',
    borderRadius: 3,
    color: '#aaa',
    cursor: 'pointer',
  },
};

