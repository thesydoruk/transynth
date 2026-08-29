import { Routes, Route } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  CoherencePage,
  DiffPage,
  GameHubPage,
  GameModDetailsPage,
  GameModsPage,
  GamesPage,
  GlossaryPage,
  INNRPage,
  ModEditorPage,
  ModsPage,
  NotFoundPage,
  SettingsPage,
  SystemLogPage,
} from './pages';
import { AppNav } from './AppNav';
import nav from './App.module.scss';

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
          <Route path="/games" element={<GamesPage />} />
          <Route path="/games/:gameId" element={<GameHubPage />} />
          <Route path="/games/:gameId/nexus" element={<GameModsPage />} />
          <Route path="/games/:gameId/nexus/:modId" element={<GameModDetailsPage />} />
          <Route path="/games/:gameId/mods" element={<ModsPage />} />
          <Route path="/games/:gameId/mods/:id" element={<ModEditorPage />} />
          <Route path="/games/:gameId/mods/:modId/innr" element={<INNRPage />} />
          <Route path="/games/:gameId/diff" element={<DiffPage />} />
          <Route path="/games/:gameId/coherence" element={<CoherencePage />} />
          <Route path="/glossary" element={<GlossaryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/system-log" element={<SystemLogPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </>
  );
};
