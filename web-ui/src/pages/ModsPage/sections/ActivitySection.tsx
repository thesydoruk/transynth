import { useTranslation } from 'react-i18next';
import { ActiveImportJobsList } from '../ActiveImportJobsList';
import { AppJobRow } from '../AppJobRow';
import { LlmJobRow } from '../LlmJobRow';
import { NexusDownloadRow } from '../NexusDownloadRow';
import { PendingUploadRow } from '../PendingUploadRow';
import { useModsWorkspace } from '../ModsWorkspaceContext';
import { countActivity } from '../modsPageUtils';
import s from './ModsSections.module.scss';

/** Uploads, downloads and jobs in flight; not rendered when there are none. */
export const ActivitySection = () => {
  const { t } = useTranslation();
  const { activity } = useModsWorkspace();
  const count = countActivity(activity);
  if (count === 0) return null;

  return (
    <section className={s.section}>
      <h2 className={s.sectionTitle}>{t('mods.sections.activityTitle', { count })}</h2>
      <div className={s.list}>
        {activity.pendingUploads.map((upload) => (
          <PendingUploadRow key={upload.id} upload={upload} />
        ))}
        {activity.nexusDownloads.map((job) => (
          <NexusDownloadRow key={job.id} job={job} />
        ))}
        {activity.appJobs.map((job) => (
          <AppJobRow key={job.id} job={job} />
        ))}
        {activity.llmJobs.map((job) => (
          <LlmJobRow key={`llm-${job.id}`} job={job} />
        ))}
        <ActiveImportJobsList />
      </div>
    </section>
  );
};
