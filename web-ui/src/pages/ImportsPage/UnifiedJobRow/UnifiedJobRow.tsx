import { useTranslation } from 'react-i18next';
import type { ModImportJob } from '../../../api';
import { kindColor, statusColorBase, statusLabel, type UnifiedJobRowProps } from '../importsShared';
import parentS from '../ImportPage.module.scss';
import s from './UnifiedJobRow.module.scss';

/** Single row in the unified import list, with a colored type badge. */
export const UnifiedJobRow = ({ kind, job, live, isRunning, onStart, onPause, onCancel, onDelete }: UnifiedJobRowProps) => {
  const { t } = useTranslation();
  const imported = live?.imported ?? job.imported_records;
  const total = live?.total ?? job.total_records;
  const pct = total > 0 ? Math.round((imported / total) * 100) : 0;
  const canStart = !isRunning && job.status !== 'in_progress' && (job.status !== 'completed' || kind === 'mod');
  const isMod = kind === 'mod';
  const modJob = isMod ? (job as ModImportJob) : null;
  const startTooltip = isMod && job.status === 'completed'
    ? t('imports.reimportTooltip')
    : t('imports.startTooltip');

  return (
    <div className={parentS.row}>
      <div className={parentS.rowLeft}>
        <span className={parentS.typeBadge} style={{ background: kindColor(kind) }}>{kind.toUpperCase()}</span>
        <div>
          <span className={parentS.fileName}>
            {job.file_name}
            {modJob?.is_localized ? <span className={s.locBadge}>{t('modImport.localized')}</span> : null}
          </span>
          <span className={parentS.meta}>
            {isMod && modJob?.is_localized
              ? t('common.strings', { count: total.toLocaleString() })
              : `${job.src_lang} → ${job.tgt_lang} · ${total.toLocaleString()} records`}
          </span>
        </div>
      </div>
      <div className={parentS.rowRight}>
        {job.status === 'completed' ? (
          <span className={s.badgeCompleted}>{t('importStatus.completed')}</span>
        ) : (isRunning || job.status === 'in_progress') ? (
          <div className={parentS.progressWrap}>
            <div className={parentS.progressTrack}><div className={parentS.progressFill} style={{ width: `${pct}%` }} /></div>
            <span className={parentS.progressLabel}>{pct}%</span>
          </div>
        ) : (
          <span
            className={parentS.badge}
            style={{ background: statusColorBase(job.status) }}
            title={job.status === 'failed' && 'last_error' in job && job.last_error ? job.last_error : undefined}
          >
            {statusLabel(job.status, t)}{job.imported_records > 0 && ` (${pct}%)`}
          </span>
        )}
        <div className={parentS.actions}>
          {canStart && <button onClick={onStart} className={s.actionBtn} title={startTooltip} aria-label={startTooltip}>▶</button>}
          {isRunning && <button onClick={onPause} className={s.actionBtn} title="⏸">⏸</button>}
          {isRunning && <button onClick={onCancel} className={s.actionBtnCancel} title={t('common.cancel')}>⏹</button>}
          {!isRunning && <button onClick={onDelete} className={s.actionBtnDelete} title={t('common.delete')}>🗑</button>}
        </div>
      </div>
    </div>
  );
};
