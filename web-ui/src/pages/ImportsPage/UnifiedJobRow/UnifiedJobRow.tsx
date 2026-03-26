import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ModImportJob } from '../../../api';
import { kindColor, statusColorBase, statusLabel, type UnifiedJobRowProps } from '../importsShared';
import parentS from '../ImportPage.module.scss';
import s from './UnifiedJobRow.module.scss';

/** Single row in the unified import list, with a colored type badge. */
export const UnifiedJobRow = ({ kind, job, live, isRunning, exportActions, onStart, onPause, onCancel, onDelete }: UnifiedJobRowProps) => {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const imported = live?.imported ?? job.imported_records;
  const total = live?.total ?? job.total_records;
  const pct = total > 0 ? Math.round((imported / total) * 100) : 0;
  const canStart = !isRunning && job.status !== 'in_progress' && (job.status !== 'completed' || kind === 'mod');
  const isMod = kind === 'mod';
  const modJob = isMod ? (job as ModImportJob) : null;
  const hasExtraMenuItems = isMod && (exportActions?.length ?? 0) > 0;
  const isFailed = job.status === 'failed';
  const lastError = isFailed && 'last_error' in job ? (job as { last_error: string | null }).last_error : null;
  const startTooltip = isFailed
    ? t('imports.retryLabel')
    : isMod && job.status === 'completed'
      ? t('imports.reimportTooltip')
      : t('imports.startTooltip');

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (ev: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(ev.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener('click', onDocClick);
    return () => window.removeEventListener('click', onDocClick);
  }, [menuOpen]);

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
          {lastError && (
            <span className={s.errorText} title={lastError}>{lastError}</span>
          )}
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
          {canStart && (
            <button
              onClick={onStart}
              className={isFailed ? s.actionBtnRetry : s.actionBtn}
              title={startTooltip}
              aria-label={startTooltip}
            >
              {isFailed ? t('imports.retryLabel') : '▶'}
            </button>
          )}
          {isRunning && <button onClick={onPause} className={s.actionBtn} title="⏸">⏸</button>}
          {isRunning && <button onClick={onCancel} className={s.actionBtnCancel} title={t('common.cancel')}>⏹</button>}
          {!isRunning && hasExtraMenuItems && (
            <div className={s.menuWrap} ref={menuRef}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen((v) => !v);
                }}
                className={s.actionBtn}
                title={t('common.moreActions')}
                aria-label={t('common.moreActions')}
              >
                ⋯
              </button>
              {menuOpen && (
                <div className={s.menuList}>
                  {(exportActions ?? []).map((action) => (
                    <button
                      key={action.key}
                      onClick={() => {
                        action.onClick();
                        setMenuOpen(false);
                      }}
                      className={s.menuItem}
                      disabled={action.disabled}
                    >
                      <span className={s.menuIcon}>{action.icon}</span>
                      <span>{action.title}</span>
                    </button>
                  ))}
                  <button
                    onClick={() => {
                      onDelete();
                      setMenuOpen(false);
                    }}
                    className={`${s.menuItem} ${s.menuItemDanger}`}
                  >
                    <span className={s.menuIcon}>🗑</span>
                    <span>{t('common.delete')}</span>
                  </button>
                </div>
              )}
            </div>
          )}
          {!isRunning && !hasExtraMenuItems && <button onClick={onDelete} className={s.actionBtnDelete} title={t('common.delete')}>🗑</button>}
        </div>
      </div>
    </div>
  );
};
