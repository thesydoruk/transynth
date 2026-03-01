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

import { useState } from 'react';
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
  const { multiUser } = useAuth();

  const [tab, setTab] = useState<TabId>('general');

  const tabs: { id: TabId; label: string }[] = [
    { id: 'general',  label: t('settings.tabs.general') },
    { id: 'llm',      label: t('settings.tabs.llm') },
    { id: 'qaRules',  label: t('settings.tabs.qaRules') },
    { id: 'tradAuto', label: t('settings.tabs.tradAuto') },
    { id: 'tmx',      label: t('settings.tabs.tmx') },
    { id: 'activity', label: t('settings.tabs.activity') },
    { id: 'data',     label: t('settings.tabs.data') },
    ...(multiUser ? [{ id: 'users' as TabId, label: t('settings.tabs.users') }] : []),
  ];

  return (
    <div className={s.page}>
      <h1 className={s.title}>{t('settings.title')}</h1>

      {/* ── Tab bar ──────────────────────────────────────────────────── */}
      <div className={s.tabs}>
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            className={`${s.tab} ${tab === id ? s.tabActive : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
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

