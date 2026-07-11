import { useTranslation } from 'react-i18next';
import { ModAiControls } from '../../../../components/ModAiControls';
import type { ModAiJobEntry } from '../../../../modAiJobsStore';
import s from './ModAiJobsBar.module.scss';

export interface ModAiJobsBarProps {
  aiJobs: {
    translate: ModAiJobEntry;
    verify: ModAiJobEntry;
    skipDetect: ModAiJobEntry;
  };
  onAiTranslate: () => void;
  onAiVerify: () => void;
  onSkipDetect: () => void;
}

/** Dedicated strip for mod-scoped AI workflow controls and live job status. */
export const ModAiJobsBar = ({
  aiJobs,
  onAiTranslate,
  onAiVerify,
  onSkipDetect,
}: ModAiJobsBarProps) => {
  const { t } = useTranslation();

  return (
    <div className={s.bar}>
      <span className={s.title}>{t('mods.aiWorkflowTitle')}</span>
      <ModAiControls
        translate={aiJobs.translate}
        verify={aiJobs.verify}
        skipDetect={aiJobs.skipDetect}
        onTranslate={onAiTranslate}
        onVerify={onAiVerify}
        onSkipDetect={onSkipDetect}
      />
    </div>
  );
};
