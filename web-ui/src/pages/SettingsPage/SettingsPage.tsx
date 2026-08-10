/**
 * SettingsPage — Project Settings hub.
 *
 * Two-column layout: sticky vertical sidebar on the left (navigation),
 * scrollable content pane on the right (active section).
 *
 * Sections:
 *   General      — default source / target languages, UI language, theme.
 *   LLM          — read-only display of the active LLM runtime config.
 *   Voice        — TTS server URL (read-only) and synthesis hyperparameters.
 *   QA Rules     — forbidden characters, length limits, and custom checks.
 *   Workflow     — project-level workflow and QA toggles.
 *   Activity     — paginated audit log of actions.
 *   Data         — link-cards to Glossary and other data pages.
 *
 * "General" preferences are stored in localStorage.
 * "LLM" settings come from ENV, displayed read-only.
 */

import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../../components/PageHeader';
import { QARulesPage } from '../QARulesPage';
import { ActivityPage } from '../ActivityPage';
import { DataTab } from './DataTab';
import { GeneralTab } from './GeneralTab';
import { LlmTab } from './LlmTab';
import { VoiceTab } from './VoiceTab';
import { WorkflowTab } from './WorkflowTab';
import s from './SettingsPage.module.scss';

type TabId = 'general' | 'llm' | 'voice' | 'qaRules' | 'activity' | 'data' | 'workflow';

export const SettingsPage = () => {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  const tabFromUrl = searchParams.get('tab');
  const isTabId = (value: string | null): value is TabId =>
    value === 'general' ||
    value === 'llm' ||
    value === 'voice' ||
    value === 'qaRules' ||
    value === 'activity' ||
    value === 'data' ||
    value === 'workflow';

  const tab = useMemo<TabId>(() => {
    if (!isTabId(tabFromUrl)) return 'general';
    return tabFromUrl;
  }, [tabFromUrl]);

  const configurationTabs: { id: TabId; label: string }[] = [
    { id: 'general', label: t('settings.tabs.general') },
    { id: 'llm', label: t('settings.tabs.llm') },
    { id: 'voice', label: t('settings.tabs.voice') },
    { id: 'qaRules', label: t('settings.tabs.qaRules') },
  ];

  const workflowTabs: { id: TabId; label: string }[] = [
    { id: 'workflow', label: t('settings.tabs.workflow') },
    { id: 'data', label: t('settings.tabs.data') },
  ];

  const teamTabs: { id: TabId; label: string }[] = [
    { id: 'activity', label: t('settings.tabs.activity') },
  ];

  const tabGroups: Array<{
    key: string;
    label: string;
    tabs: { id: TabId; label: string }[];
  }> = [
    { key: 'configuration', label: t('settings.groups.configuration'), tabs: configurationTabs },
    { key: 'workflow', label: t('settings.groups.workflow'), tabs: workflowTabs },
    { key: 'team', label: t('settings.groups.team'), tabs: teamTabs },
  ].filter((group) => group.tabs.length > 0);

  const handleTabSelect = (nextTab: TabId) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', nextTab);
    setSearchParams(next, { replace: true });
  };

  return (
    <div className={s.page}>
      <PageHeader title={t('settings.title')} description={t('settings.subtitle')} />

      <div className={s.layout}>
        <nav className={s.sidebar} aria-label={t('settings.title')}>
          {tabGroups.map((group) => (
            <div key={group.key} className={s.navGroup}>
              <div className={s.navGroupLabel}>{group.label}</div>
              {group.tabs.map(({ id, label }) => (
                <button
                  key={id}
                  className={`${s.navItem} ${tab === id ? s.navItemActive : ''}`}
                  onClick={() => handleTabSelect(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className={s.content}>
          {tab === 'general' && <GeneralTab />}
          {tab === 'llm' && <LlmTab />}
          {tab === 'voice' && <VoiceTab />}
          {tab === 'qaRules' && <QARulesPage embedded />}
          {tab === 'workflow' && <WorkflowTab />}
          {tab === 'activity' && <ActivityPage embedded />}
          {tab === 'data' && <DataTab />}
        </div>
      </div>
    </div>
  );
};
