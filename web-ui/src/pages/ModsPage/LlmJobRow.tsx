import { useTranslation } from 'react-i18next';
import type { OpsLlmJob } from '../../api';
import { statusColorBase, importStatusKey } from './modsShared';
import rowS from './ModsPageRow.module.scss';

type LlmJobRowProps = {
  job: OpsLlmJob;
};

export const LlmJobRow = ({ job }: LlmJobRowProps) => {
  const { t } = useTranslation();
  const label = job.mod_name
    ? t('imports.llmBatchName', { name: job.mod_name })
    : t('imports.llmBatchMod', { id: job.mod_id ?? '?' });
  const pct = job.string_count > 0 ? Math.round((job.done_count / job.string_count) * 100) : null;

  return (
    <div className={rowS.row}>
      <div className={rowS.rowLeft}>
        <span className={rowS.typeBadge} style={{ background: '#1b6b2d' }}>
          {t('imports.llmBadge')}
        </span>
        <div>
          <span className={rowS.fileName}>{label}</span>
          <span className={rowS.meta}>{new Date(job.updated_at).toLocaleString()}</span>
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
            <span className={rowS.progressLabel}>
              {job.done_count}/{job.string_count} ({pct}%)
            </span>
          </div>
        )}
        <div className={rowS.actions}>
          <span
            className={rowS.badge}
            style={{
              background: statusColorBase(
                job.status === 'running'
                  ? 'in_progress'
                  : job.status === 'completed'
                    ? 'completed'
                    : 'failed',
              ),
            }}
          >
            {t(`importStatus.${importStatusKey(job.status)}`, job.status)}
          </span>
        </div>
      </div>
    </div>
  );
};
