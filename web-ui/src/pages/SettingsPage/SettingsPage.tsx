/**
 * SettingsPage — Project Settings hub.
 *
 * Two-column layout: sticky vertical sidebar on the left (navigation),
 * scrollable content pane on the right (active section).
 *
 * Sections:
 *   General      — default source / target languages, UI language, theme.
 *   LLM          — read-only display of the active LLM runtime config.
 *   QA Rules     — forbidden characters, length limits, and custom checks.
 *   Workflow     — project-level workflow and QA toggles.
 *   TradAuto     — pattern-match rules for automatic translation.
 *   TMX          — export / import translation memory in TMX format.
 *   Activity     — paginated audit log of user actions.
 *   Data         — link-cards to Glossary and other data pages.
 *   Users        — user management (only visible in multi-user mode).
 *
 * "General" preferences are stored in localStorage.
 * "LLM" settings come from ENV, displayed read-only.
 */

import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../components/AuthContext';
import { PageHeader } from '../../components/PageHeader';
import { QARulesPage } from '../QARulesPage';
import { TradAutoPage } from '../TradAutoPage';
import { TmxPage } from '../TmxPage';
import { ActivityPage } from '../ActivityPage';
import { DataTab } from './DataTab';
import { GeneralTab } from './GeneralTab';
import { LlmTab } from './LlmTab';
import { UsersTab } from './UsersTab';
import { WorkflowTab } from './WorkflowTab';
import s from './SettingsPage.module.scss';

/* ── Tab identifiers ─────────────────────────────────────────────────────── */

type TabId = 'general' | 'llm' | 'qaRules' | 'tradAuto' | 'tmx' | 'activity' | 'data' | 'users' | 'workflow';

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
    || value === 'users'
    || value === 'workflow';

  const tab = useMemo<TabId>(() => {
    if (!isTabId(tabFromUrl)) return 'general';
    if (tabFromUrl === 'users' && !(multiUser && isAdmin)) return 'general';
    return tabFromUrl;
  }, [tabFromUrl, multiUser, isAdmin]);

  /** Translator workflow tabs — visible to every user. */
  const configurationTabs: { id: TabId; label: string }[] = [
    { id: 'general',  label: t('settings.tabs.general') },
    { id: 'llm',      label: t('settings.tabs.llm') },
    { id: 'qaRules',  label: t('settings.tabs.qaRules') },
  ];

  const workflowTabs: { id: TabId; label: string }[] = [
    { id: 'workflow', label: t('settings.tabs.workflow') },
    { id: 'tradAuto', label: t('settings.tabs.tradAuto') },
    { id: 'tmx',      label: t('settings.tabs.tmx') },
    { id: 'data',     label: t('settings.tabs.data') },
  ];

  const teamTabs: { id: TabId; label: string }[] = [
    { id: 'activity', label: t('settings.tabs.activity') },
  ];

  /** Admin-only tabs — only available when multiUser mode is active AND the current user is an admin. */
  const adminTabs: { id: TabId; label: string }[] = multiUser && isAdmin
    ? [{ id: 'users', label: t('settings.tabs.users') }]
    : [];

  const tabGroups: Array<{ key: string; label: string; tabs: { id: TabId; label: string }[]; adminOnly?: boolean }> = [
    { key: 'configuration', label: t('settings.groups.configuration'), tabs: configurationTabs },
    { key: 'workflow', label: t('settings.groups.workflow'), tabs: workflowTabs },
    { key: 'team', label: t('settings.groups.team'), tabs: teamTabs },
    { key: 'admin', label: t('settings.groups.admin'), tabs: adminTabs, adminOnly: true },
  ].filter((group) => group.tabs.length > 0);

  const handleTabSelect = (nextTab: TabId) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', nextTab);
    setSearchParams(next, { replace: true });
  };

  return (
    <div className={s.page}>
      <PageHeader
        title={t('settings.title')}
        description={t('settings.subtitle')}
      />

      <div className={s.layout}>
        {/* ── Sidebar ──────────────────────────────────────────────── */}
        <nav className={s.sidebar} aria-label={t('settings.title')}>
          {tabGroups.map((group) => (
            <div key={group.key} className={s.navGroup}>
              <div className={s.navGroupLabel}>{group.label}</div>
              {group.tabs.map(({ id, label }) => (
                <button
                  key={id}
                  className={`${s.navItem} ${group.adminOnly ? s.navItemAdmin : ''} ${tab === id ? s.navItemActive : ''}`}
                  onClick={() => handleTabSelect(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* ── Content pane ─────────────────────────────────────────── */}
        <div className={s.content}>
          {tab === 'general'  && <GeneralTab />}
          {tab === 'llm'      && <LlmTab />}
          {tab === 'qaRules'  && <QARulesPage embedded />}
          {tab === 'workflow' && <WorkflowTab />}
          {tab === 'tradAuto' && <TradAutoPage embedded />}
          {tab === 'tmx'      && <TmxPage embedded />}
          {tab === 'activity' && <ActivityPage embedded />}
          {tab === 'data'     && <DataTab />}
          {tab === 'users'    && <UsersTab />}
        </div>
      </div>
    </div>
  );
};

