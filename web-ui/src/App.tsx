import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { UI_LANGUAGES } from './i18n';
import { AuthProvider, useAuth } from './components/AuthContext';
import { useTheme } from './components/ThemeContext';
import { LoginPage } from './pages/LoginPage';
import { ModsPage } from './pages/ModsPage';
import { ModEditorPage } from './pages/ModEditorPage';
import { GlossaryPage } from './pages/GlossaryPage';
import { DiffPage } from './pages/DiffPage';
import { EetImportsPage } from './pages/EetImportsPage';
import { CsvImportsPage } from './pages/CsvImportsPage';
import { ModImportsPage } from './pages/ModImportsPage';
import { ImportsPage } from './pages/ImportsPage';
import { DashboardPage } from './pages/DashboardPage';
import { TmxPage } from './pages/TmxPage';
import { UsersPage } from './pages/UsersPage';
import { QARulesPage } from './pages/QARulesPage';
import { CoherencePage } from './pages/CoherencePage';
import { ActivityPage } from './pages/ActivityPage';
import nav from './App.module.scss';

const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
});

/** Navigation link descriptors — label keys reference the nav.* i18n namespace. */
const NAV_LINKS = [
  { to: '/', labelKey: 'nav.mods', exact: true },
  { to: '/imports', labelKey: 'nav.imports', exact: false },
  { to: '/glossary', labelKey: 'nav.glossary', exact: false },
  { to: '/dashboard', labelKey: 'nav.dashboard', exact: false },
  { to: '/tmx', labelKey: 'nav.tmx', exact: false },
  { to: '/diff', labelKey: 'nav.diff', exact: false },
  { to: '/activity', labelKey: 'nav.activity', exact: false },
  { to: '/qa-rules', labelKey: 'nav.qaRules', exact: false },
  { to: '/coherence', labelKey: 'nav.coherence', exact: false },
  { to: '/users', labelKey: 'nav.users', exact: false, multiUserOnly: true },
];

/**
 * Navigation bar — renders links, user info, and language switcher.
 * In multi-user mode, shows the current user's name and a logout button.
 */
const Nav = () => {
  const loc = useLocation();
  const { user, multiUser, logout } = useAuth();
  const { t, i18n } = useTranslation();
  const { theme, toggleTheme } = useTheme();

  return (
    <nav className={nav.nav}>
      <span className={nav.brand}>{t('nav.brand')}</span>
      {NAV_LINKS
        .filter(l => !('multiUserOnly' in l && l.multiUserOnly) || multiUser)
        .map(({ to, labelKey, exact }) => {
          const active = exact ? loc.pathname === to : loc.pathname.startsWith(to);
          return (
            <Link key={to} to={to} className={active ? nav.activeLink : nav.link}>
              {t(labelKey)}
            </Link>
          );
        })}

      {/* Spacer */}
      <span className={nav.spacer} />

      {/* Theme toggle */}
      <button
        className={nav.themeBtn}
        onClick={toggleTheme}
        title={t(theme === 'dark' ? 'nav.themeLight' : 'nav.themeDark')}
      >
        {theme === 'dark' ? '\u2600\uFE0F' : '\uD83C\uDF19'}
      </button>

      {/* Language switcher */}
      <select
        className={nav.langSwitch}
        value={i18n.language}
        onChange={(e) => i18n.changeLanguage(e.target.value)}
      >
        {UI_LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>{l.label}</option>
        ))}
      </select>

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
        <button onClick={logout} className={nav.logoutBtn}>{t('nav.logout')}</button>
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
      <main className={nav.main}>
        <Routes>
          <Route path="/" element={<ModsPage />} />
          <Route path="/mods/:id" element={<ModEditorPage />} />
          <Route path="/imports" element={<ImportsPage />} />
          {/* Legacy redirects — keep old URLs working */}
          <Route path="/eet" element={<EetImportsPage />} />
          <Route path="/csv" element={<CsvImportsPage />} />
          <Route path="/mod-import" element={<ModImportsPage />} />
          <Route path="/glossary" element={<GlossaryPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/tmx" element={<TmxPage />} />
          <Route path="/diff" element={<DiffPage />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="/qa-rules" element={<QARulesPage />} />
          <Route path="/coherence" element={<CoherencePage />} />
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


