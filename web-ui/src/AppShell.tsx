import { Navigate, Routes, Route, useLocation, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  CoherencePage,
  DiffPage,
  GameLayout,
  GameModDetailsPage,
  GameModsPage,
  GamesPage,
  GlossaryPage,
  INNRPage,
  ModEditorPage,
  ModsPage,
  NotFoundPage,
  ReferencePage,
  VortexPage,
  SettingsPage,
  SystemLogPage,
} from './pages';
import { AppNav } from './AppNav';
import { DEFAULT_GAME_ID, getCurrentGame } from './langDefaults';
import { routePatterns, routes } from './routes';
import nav from './App.module.scss';

/** The mods list used to live at /games/:gameId/mods; the game page is that workspace now. */
const ModsRedirect = () => {
  const { gameId = '' } = useParams<{ gameId: string }>();
  const { search } = useLocation();
  return <Navigate to={`${routes.game(gameId)}${search}`} replace />;
};

/** The glossary used to live at /glossary; it belongs to a game, so go to the last one seen. */
const GlossaryRedirect = () => {
  const { search } = useLocation();
  const gameId = getCurrentGame() ?? DEFAULT_GAME_ID;
  return <Navigate to={`${routes.gameSection(gameId, 'glossary')}${search}`} replace />;
};

/** Main app shell — skip link, navigation, and routes. */
export const AppShell = () => {
  const { t } = useTranslation();

  return (
    <>
      <a href="#main-content" className={nav.skipLink}>
        {t('nav.skipToContent')}
      </a>
      <AppNav />
      <main id="main-content" className={nav.main} tabIndex={-1}>
        <Routes>
          <Route path="/" element={<GamesPage />} />
          <Route path="/games" element={<Navigate to={routes.games()} replace />} />
          <Route path={routePatterns.game} element={<GameLayout />}>
            <Route index element={<ModsPage />} />
            <Route path="nexus" element={<GameModsPage />} />
            <Route path={routePatterns.nexusMod} element={<GameModDetailsPage />} />
            <Route path="coherence" element={<CoherencePage />} />
            <Route path="diff" element={<DiffPage />} />
            <Route path="reference" element={<ReferencePage />} />
            <Route path="glossary" element={<GlossaryPage />} />
            <Route path="vortex" element={<VortexPage />} />
          </Route>
          <Route path={routePatterns.modsList} element={<ModsRedirect />} />
          <Route path={routePatterns.mod} element={<ModEditorPage />} />
          <Route path={routePatterns.modInnr} element={<INNRPage />} />
          <Route path={routePatterns.legacyGlossary} element={<GlossaryRedirect />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/system-log" element={<SystemLogPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </>
  );
};
