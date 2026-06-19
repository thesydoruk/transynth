import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { useAuth } from './components/AuthContext';
import {
  ActivityPage,
  CoherencePage,
  DashboardPage,
  DiffPage,
  GameHubPage,
  GameModDetailsPage,
  GameModsPage,
  GamesPage,
  GlossaryPage,
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
import { AppNav } from './AppNav';
import nav from './App.module.scss';

/** Legacy `/games/:gameId/imports` → unified mods workspace. */
const LegacyImportsRedirect = () => {
  const { gameId = 'fo4' } = useParams<{ gameId: string }>();
  return <Navigate to={`/games/${gameId}/mods`} replace />;
};

/**
 * Main authenticated app shell — renders navigation and routes.
 * In multi-user mode, shows the login page until the user is authenticated.
 */
export const AppShell = () => {
  const { loading, multiUser, user } = useAuth();

  if (loading) return null;
  if (multiUser && !user) return <LoginPage />;

  return (
    <>
      <AppNav />
      <main className={nav.main}>
        <Routes>
          <Route path="/" element={<GamesPage />} />
          <Route path="/games" element={<GamesPage />} />
          <Route path="/games/:gameId" element={<GameHubPage />} />
          <Route path="/games/:gameId/nexus" element={<GameModsPage />} />
          <Route path="/games/:gameId/nexus/:modId" element={<GameModDetailsPage />} />
          <Route path="/games/:gameId/mods" element={<ModsPage />} />
          <Route path="/games/:gameId/mods/:id" element={<ModEditorPage />} />
          <Route path="/games/:gameId/mods/:modId/innr" element={<INNRPage />} />
          <Route path="/games/:gameId/imports" element={<LegacyImportsRedirect />} />
          <Route path="/glossary" element={<GlossaryPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/tmx" element={<TmxPage />} />
          <Route path="/diff" element={<DiffPage />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="/qa-rules" element={<QARulesPage />} />
          <Route path="/coherence" element={<CoherencePage />} />
          <Route path="/review-queue" element={<ReviewQueuePage />} />
          <Route path="/ops" element={<OpsPage />} />
          <Route path="/tradauto" element={<TradAutoPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </>
  );
};
