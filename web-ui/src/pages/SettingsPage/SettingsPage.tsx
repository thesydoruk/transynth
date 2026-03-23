/**
 * SettingsPage — Project Settings hub.
 *
 * Organises all configurable aspects of the tool into a tabbed layout:
 *
 *   Tab 1 — General:    default source / target languages, UI language, theme.
 *   Tab 2 — LLM:        read-only display of the active LLM runtime config.
 *   Tab 3 — QA Rules:   forbidden characters, length limits, and custom checks.
 *   Tab 4 — TradAuto:   pattern-match rules for automatic translation.
 *   Tab 5 — TMX:        export / import translation memory in TMX format.
 *   Tab 6 — Activity:   paginated audit log of user actions.
 *   Tab 7 — Data:       link-cards to Glossary and other data pages.
 *   Tab 8 — Users:      user management (only visible in multi-user mode).
 *
 * "General" preferences are stored in localStorage.
 * "LLM" settings come from ENV, displayed read-only.
 * Tabs 3–6 embed their respective standalone pages directly.
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../components/AuthContext';
import { QARulesPage } from '../QARulesPage';
import { TradAutoPage } from '../TradAutoPage';
import { TmxPage } from '../TmxPage';
import { ActivityPage } from '../ActivityPage';
import { DataTab } from './DataTab';
import { GeneralTab } from './GeneralTab';
import { LlmTab } from './LlmTab';
import { UsersTab } from './UsersTab';
import s from './SettingsPage.module.scss';

/* ── Tab identifiers ─────────────────────────────────────────────────────── */

type TabId = 'general' | 'llm' | 'qaRules' | 'tradAuto' | 'tmx' | 'activity' | 'data' | 'users';

/* ─────────────────────────────────────────────────────────────────────────── */

/**
 * SettingsPage root component.
 *
 * Renders the tab bar and delegates to per-tab section components.
 * The active tab index is kept in local state — no URL param needed.
 */
export const SettingsPage = () => {
  const { t } = useTranslation();
  const { multiUser, user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [searchParams, setSearchParams] = useSearchParams();

  const tabFromUrl = searchParams.get('tab');
  const isTabId = (value: string | null): value is TabId => value === 'general'
    || value === 'llm'
    || value === 'qaRules'
    || value === 'tradAuto'
    || value === 'tmx'
    || value === 'activity'
    || value === 'data'
    || value === 'users';

  const [tab, setTab] = useState<TabId>(() => (isTabId(tabFromUrl) ? tabFromUrl : 'general'));

  /** Translator workflow tabs — visible to every user. */
  const translatorTabs: { id: TabId; label: string }[] = [
    { id: 'general',  label: t('settings.tabs.general') },
    { id: 'llm',      label: t('settings.tabs.llm') },
    { id: 'qaRules',  label: t('settings.tabs.qaRules') },
    { id: 'tradAuto', label: t('settings.tabs.tradAuto') },
    { id: 'tmx',      label: t('settings.tabs.tmx') },
    { id: 'activity', label: t('settings.tabs.activity') },
    { id: 'data',     label: t('settings.tabs.data') },
  ];

  /** Admin-only tabs — only available when multiUser mode is active AND the current user is an admin. */
  const adminTabs: { id: TabId; label: string }[] = multiUser && isAdmin
    ? [{ id: 'users', label: t('settings.tabs.users') }]
    : [];

  useEffect(() => {
    if (!isTabId(tabFromUrl)) return;
    if (tabFromUrl === 'users' && !(multiUser && isAdmin)) return;
    if (tabFromUrl !== tab) setTab(tabFromUrl);
  }, [tabFromUrl, tab, multiUser, isAdmin]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [tab, searchParams, setSearchParams]);

  return (
    <div className={s.page}>
      <h1 className={s.title}>{t('settings.title')}</h1>

      {/* ── Tab bar ──────────────────────────────────────────────────── */}
      <div className={s.tabs}>
        {translatorTabs.map(({ id, label }) => (
          <button
            key={id}
            className={`${s.tab} ${tab === id ? s.tabActive : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
        {adminTabs.length > 0 && (
          <>
            <span className={s.tabGroupSep} aria-hidden="true" />
            {adminTabs.map(({ id, label }) => (
              <button
                key={id}
                className={`${s.tab} ${s.tabAdmin} ${tab === id ? s.tabActive : ''}`}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </>
        )}
      </div>

      {/* ── Tab panels ───────────────────────────────────────────────── */}
      {tab === 'general'  && <GeneralTab />}
      {tab === 'llm'      && <LlmTab />}
      {tab === 'qaRules'  && <QARulesPage />}
      {tab === 'tradAuto' && <TradAutoPage />}
      {tab === 'tmx'      && <TmxPage />}
      {tab === 'activity' && <ActivityPage />}
      {tab === 'data'     && <DataTab />}
      {tab === 'users'    && <UsersTab />}
    </div>
  );
};

