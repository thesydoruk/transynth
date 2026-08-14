import { useTranslation } from 'react-i18next';
import parentS from '../SettingsPage.module.scss';
import s from './WorkflowTab.module.scss';

type PipelineSettings = {
  'pipeline.dependency_wait_timeout_sec': number;
  'pipeline.health_check_interval_sec': number;
};

type PipelineSectionProps = {
  settings: PipelineSettings;
  onNumber: (key: keyof PipelineSettings, raw: string) => void;
};

/** How long jobs wait for LLM/TTS health, and the pause between probes. */
export const PipelineSection = ({ settings, onNumber }: PipelineSectionProps) => {
  const { t } = useTranslation();

  return (
    <div className={parentS.section}>
      <h2 className={parentS.sectionTitle}>{t('settings.workflow.sectionPipeline')}</h2>
      <div className={s.settingsList}>
        <div className={s.settingRow}>
          <div className={s.settingInfo}>
            <span className={s.settingLabel}>{t('settings.workflow.dependencyWaitTimeout')}</span>
            <span className={parentS.fieldNote}>
              {t('settings.workflow.dependencyWaitTimeoutDesc')}
            </span>
          </div>
          <input
            type="number"
            className={s.numberInput}
            min={30}
            max={7200}
            value={settings['pipeline.dependency_wait_timeout_sec']}
            onChange={(e) => onNumber('pipeline.dependency_wait_timeout_sec', e.target.value)}
          />
        </div>
        <div className={s.settingRow}>
          <div className={s.settingInfo}>
            <span className={s.settingLabel}>{t('settings.workflow.healthCheckInterval')}</span>
            <span className={parentS.fieldNote}>
              {t('settings.workflow.healthCheckIntervalDesc')}
            </span>
          </div>
          <input
            type="number"
            className={s.numberInput}
            min={1}
            max={120}
            value={settings['pipeline.health_check_interval_sec']}
            onChange={(e) => onNumber('pipeline.health_check_interval_sec', e.target.value)}
          />
        </div>
      </div>
    </div>
  );
};
