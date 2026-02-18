import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { UI_LANGUAGES } from './i18n';
import { AuthProvider, useAuth } from './components/AuthContext';
import { useTheme } from './components/ThemeContext';
import { LoginPage } from './pages/LoginPage';
import { HomePage } from './pages/HomePage';
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
import { ReviewQueuePage } from './pages/ReviewQueuePage';
import { INNRPage } from './pages/INNRPage';
import { ActivityPage } from './pages/ActivityPage';
import { Ba2BrowserPage } from './pages/Ba2BrowserPage';
import { EspExplorerPage } from './pages/EspExplorerPage';
import { OpsPage } from './pages/OpsPage';
import { TradAutoPage } from './pages/TradAutoPage';
import { SettingsPage } from './pages/SettingsPage';
import { GamesPage } from './pages/GamesPage';
import { GameModsPage } from './pages/GameModsPage';
import { GameModDetailsPage } from './pages/GameModDetailsPage';
import nav from './App.module.scss';

const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
});

/**
 * Navigation link descriptors — label keys reference the nav.* i18n namespace.
 *
 * Removed from nav (now live inside Settings tabs or the home Overview page):
 *   /dashboard, /ops    — merged into / (HomePage)
 *   /qa-rules           — Settings → QA Rules tab
 *   /tradauto           — Settings → TradAuto tab
 *   /tmx                — Settings → TMX tab
 *   /activity           — Settings → Activity tab
 *
 * The home page (/) is accessible only via the brand "FO4 Localizer" click.
 */
const NAV_LINKS = [
  { to: '/games', labelKey: 'nav.games', exact: false },
  { to: '/mods', labelKey: 'nav.mods', exact: false },
  { to: '/imports', labelKey: 'nav.imports', exact: false },
  { to: '/glossary', labelKey: 'nav.glossary', exact: false },
  { to: '/diff', labelKey: 'nav.diff', exact: false },
  { to: '/coherence', labelKey: 'nav.coherence', exact: false },
  { to: '/review-queue', labelKey: 'nav.reviewQueue', exact: false },
  { to: '/ba2-browser', labelKey: 'nav.ba2Browser', exact: false },
  { to: '/esp-explorer', labelKey: 'nav.espExplorer', exact: false },
  { to: '/users', labelKey: 'nav.users', exact: false, multiUserOnly: true },
  { to: '/settings', labelKey: 'nav.settings', exact: false },
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
      {/* Brand click navigates to the project overview / home page */}
      <Link to="/" className={nav.brand}>{t('nav.brand')}</Link>
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
          {/* Home — merged Dashboard + Ops overview (accessible via brand click) */}
          <Route path="/" element={<HomePage />} />
          {/* Games catalogue — supported games tile grid with cover art */}
          <Route path="/games" element={<GamesPage />} />
          {/* Game-specific NexusMods search page (opened from games tiles) */}
          <Route path="/games/:gameId" element={<GameModsPage />} />
          {/* Detailed Nexus mod page: metadata, attached files, likely translations */}
          <Route path="/games/:gameId/mods/:modId" element={<GameModDetailsPage />} />
          {/* Mods list — main day-to-day page */}
          <Route path="/mods" element={<ModsPage />} />
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
          <Route path="/review-queue" element={<ReviewQueuePage />} />
          <Route path="/mods/:modId/innr" element={<INNRPage />} />
          <Route path="/ba2-browser" element={<Ba2BrowserPage />} />
          <Route path="/esp-explorer" element={<EspExplorerPage />} />
          <Route path="/ops" element={<OpsPage />} />
          <Route path="/tradauto" element={<TradAutoPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/settings" element={<SettingsPage />} />
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


