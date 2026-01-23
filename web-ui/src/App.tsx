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
import nav from './App.module.scss';

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
    <nav className={nav.nav}>
      <span className={nav.brand}>FO4 Localizer</span>
      {NAV_LINKS
        .filter(l => !('multiUserOnly' in l && l.multiUserOnly) || multiUser)
        .map(({ to, label, exact }) => {
          const active = exact ? loc.pathname === to : loc.pathname.startsWith(to);
          return (
            <Link key={to} to={to} className={active ? nav.activeLink : nav.link}>
              {label}
            </Link>
          );
        })}

      {/* Spacer */}
      <span className={nav.spacer} />

      {/* User info — always visible for admin, user display in multi-user mode */}
      {user && (
        <span className={nav.userInfo}>
          {user.display_name}
          {multiUser && user.role !== 'translator' && (
            <span className={nav.roleBadge}>{user.role}</span>
          )}
        </span>
      )}
      {multiUser && user && (
        <button onClick={logout} className={nav.logoutBtn}>Logout</button>
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


