/**
 * Settings — flat list: General, LLM, Voice, Workflow, QA, Activity.
 */

import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../../components/PageHeader';
import { ActivityPage } from '../ActivityPage';
import { QARulesPage } from '../QARulesPage';
import { GeneralTab } from './GeneralTab';
import { LlmTab } from './LlmTab';
import { VoiceTab } from './VoiceTab';
import { WorkflowTab } from './WorkflowTab';
import s from './SettingsPage.module.scss';

type TabId = 'general' | 'llm' | 'voice' | 'workflow' | 'qaRules' | 'activity';

const TAB_IDS: TabId[] = ['general', 'llm', 'voice', 'workflow', 'qaRules', 'activity'];

const isTabId = (value: string | null): value is TabId => TAB_IDS.some((id) => id === value);

export const SettingsPage = () => {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  const tab = useMemo<TabId>(() => {
    const fromUrl = searchParams.get('tab');
    return isTabId(fromUrl) ? fromUrl : 'general';
  }, [searchParams]);

  const tabs: { id: TabId; label: string }[] = [
    { id: 'general', label: t('settings.tabs.general') },
    { id: 'llm', label: t('settings.tabs.llm') },
    { id: 'voice', label: t('settings.tabs.voice') },
    { id: 'workflow', label: t('settings.tabs.workflow') },
    { id: 'qaRules', label: t('settings.tabs.qaRules') },
    { id: 'activity', label: t('settings.tabs.activity') },
  ];

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
          {tabs.map(({ id, label }) => (
            <button
              key={id}
              className={`${s.navItem} ${tab === id ? s.navItemActive : ''}`}
              onClick={() => handleTabSelect(id)}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className={s.content}>
          {tab === 'general' && <GeneralTab />}
          {tab === 'llm' && <LlmTab />}
          {tab === 'voice' && <VoiceTab />}
          {tab === 'workflow' && <WorkflowTab />}
          {tab === 'qaRules' && <QARulesPage embedded />}
          {tab === 'activity' && <ActivityPage embedded />}
        </div>
      </div>
    </div>
  );
};
