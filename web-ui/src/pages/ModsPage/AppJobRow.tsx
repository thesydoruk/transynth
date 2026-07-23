import { useTranslation } from 'react-i18next';
import type { AppJob } from '../../appJobsQueue';
import { statusColorBase, importStatusKey } from './modsShared';
import rowS from './ModsPageRow.module.scss';

type AppJobRowProps = {
  job: AppJob;
};

export const AppJobRow = ({ job }: AppJobRowProps) => {
  const { t } = useTranslation();
  const pct = job.progress == null ? null : Math.max(0, Math.min(100, Math.round(job.progress)));
  const kindBadge = job.kind === 'llm' ? t('imports.llmBadge') : t('imports.exportBadge');

  return (
    <div className={rowS.row}>
      <div className={rowS.rowLeft}>
        <span
          className={rowS.typeBadge}
          style={{ background: job.kind === 'llm' ? '#1b6b2d' : '#1565c0' }}
        >
          {kindBadge}
        </span>
        <div>
          <span className={rowS.fileName}>{job.label}</span>
          <span className={rowS.meta}>{new Date(job.updatedAt).toLocaleString()}</span>
        </div>
      </div>
      <div className={rowS.rowRight}>
        {pct == null ? (
          <span className={rowS.progressLabel}>—</span>
        ) : (
          <div className={rowS.progressWrap}>
            <div className={rowS.progressTrack}>
              <div className={rowS.progressFill} style={{ width: `${pct}%` }} />
            </div>
            <span className={rowS.progressLabel}>{pct}%</span>
          </div>
        )}
        <div className={rowS.actions}>
          <span
            className={rowS.badge}
            style={{
              background: statusColorBase(job.status === 'running' ? 'in_progress' : 'failed'),
            }}
          >
            {t(`importStatus.${importStatusKey(job.status)}`, job.status)}
          </span>
        </div>
      </div>
    </div>
  );
};
