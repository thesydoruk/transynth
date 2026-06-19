import { useTranslation } from 'react-i18next';
import type { NexusDownloadJob } from '../../../nexusDownloadQueue';
import { kindColor, statusColorBase } from '../modsShared';
import s from '../ModsPage.module.scss';

interface NexusDownloadRowProps {
  job: NexusDownloadJob;
}

/** Virtual row for a Nexus file that is still downloading before import job creation. */
export const NexusDownloadRow = ({ job }: NexusDownloadRowProps) => {
  const { t } = useTranslation();
  const pct = Math.max(0, Math.min(100, Math.round(job.progress)));

  return (
    <div className={s.row}>
      <div className={s.rowLeft}>
        <span className={s.typeBadge} style={{ background: kindColor('mod') }}>
          MOD
        </span>
        <div>
          <span className={s.fileName}>{job.fileName}</span>
          <span className={s.meta}>
            {job.gameId.toUpperCase()} · Nexus #{job.modId} · file #{job.fileId}
          </span>
        </div>
      </div>
      <div className={s.rowRight}>
        {job.status === 'failed' ? (
          <span className={s.badge} style={{ background: statusColorBase('failed') }}>
            {t('importStatus.failed')}
          </span>
        ) : (
          <div className={s.progressWrap}>
            <div className={s.progressTrack}>
              <div className={s.progressFill} style={{ width: `${pct}%` }} />
            </div>
            <span className={s.progressLabel}>{pct}%</span>
          </div>
        )}
        <div className={s.actions}>
          <span className={s.badge} style={{ background: statusColorBase('in_progress') }}>
            {t('importStatus.downloading')}
          </span>
        </div>
      </div>
    </div>
  );
};
