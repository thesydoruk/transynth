import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { UI_LANGUAGES } from './i18n';
import { AuthProvider, useAuth } from './components/AuthContext';
import { useTheme } from './components/ThemeContext';
import {
  ActivityPage,
  Ba2BrowserPage,
  CoherencePage,
  DashboardPage,
  DiffPage,
  EspExplorerPage,
  GameHubPage,
  GameModDetailsPage,
  GameModsPage,
  GamesPage,
  GlossaryPage,
  ImportsPage,
  INNRPage,
  LoginPage,
  ModEditorPage,
  ModsPage,
  OpsPage,
  QARulesPage,
  ReviewQueuePage,
  SettingsPage,
  TmxPage,
  TradAutoPage,
  UsersPage,
} from './pages';
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
          {/* Home — Games catalogue (entry point) */}
          <Route path="/" element={<GamesPage />} />
          {/* Legacy /games redirect — brand click + direct URL both go to / */}
          <Route path="/games" element={<GamesPage />} />
          {/* Game hub — mod stats, quick links, language pair selector */}
          <Route path="/games/:gameId" element={<GameHubPage />} />
          {/* Game-scoped NexusMods browser */}
          <Route path="/games/:gameId/nexus" element={<GameModsPage />} />
          {/* Detailed Nexus mod page: metadata, attached files, likely translations */}
          <Route path="/games/:gameId/nexus/:modId" element={<GameModDetailsPage />} />
          {/* Game-scoped imported mods list */}
          <Route path="/games/:gameId/mods" element={<ModsPage />} />
          {/* Mod string editor */}
          <Route path="/games/:gameId/mods/:id" element={<ModEditorPage />} />
          {/* INNR special editor (game-scoped) */}
          <Route path="/games/:gameId/mods/:modId/innr" element={<INNRPage />} />
          {/* Game-scoped imports */}
          <Route path="/games/:gameId/imports" element={<ImportsPage />} />
          {/* Global cross-game tools */}
          <Route path="/glossary" element={<GlossaryPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/tmx" element={<TmxPage />} />
          <Route path="/diff" element={<DiffPage />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="/qa-rules" element={<QARulesPage />} />
          <Route path="/coherence" element={<CoherencePage />} />
          <Route path="/review-queue" element={<ReviewQueuePage />} />
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


