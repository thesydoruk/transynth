import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MOD_BADGE_COLOR,
  statusColorBase,
  statusLabel,
  canStartImportJob,
  importStartTooltip,
  importStartButtonLabel,
  importStatusI18nKey,
  type UnifiedJobRowProps,
} from '../modsShared';
import { ModDataMenuItems } from '../ModDataMenuItems';
import parentS from '../ModsPageRow.module.scss';
import s from './UnifiedJobRow.module.scss';

/** Single row in the unified import list, with a colored type badge. */
export const UnifiedJobRow = ({
  job,
  live,
  isRunning,
  exportActions,
  modDataMenu,
  onStart,
  onPause,
  onCancel,
  onDelete,
}: UnifiedJobRowProps) => {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const imported = live?.imported ?? job.imported_records;
  const total = live?.total ?? job.total_records;
  const pct = total > 0 ? Math.round((imported / total) * 100) : 0;
  const canStart = canStartImportJob(job, isRunning);
  const isFailed = job.status === 'failed';
  const startTooltip = importStartTooltip(job, isRunning, t);
  const startButtonLabel = importStartButtonLabel(job, isRunning, t);

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
        <span className={parentS.typeBadge} style={{ background: MOD_BADGE_COLOR }}>
          {t('imports.tabMod')}
        </span>
        <div>
          <span className={parentS.fileName}>
            {job.file_name}
            {job.is_localized ? (
              <span className={s.locBadge}>{t('modImport.localized')}</span>
            ) : null}
          </span>
          <span className={parentS.meta}>{t('common.strings', { count: total })}</span>
        </div>
      </div>
      <div className={parentS.rowRight}>
        {job.status === 'completed' ? (
          <span className={s.badgeCompleted}>{t('importStatus.completed')}</span>
        ) : isRunning ? (
          <div className={parentS.progressWrap}>
            <div className={parentS.progressTrack}>
              <div className={parentS.progressFill} style={{ width: `${pct}%` }} />
            </div>
            <span className={parentS.progressLabel}>{pct}%</span>
          </div>
        ) : (
          <span
            className={parentS.badge}
            style={{ background: statusColorBase(importStatusI18nKey(job, isRunning)) }}
          >
            {statusLabel(job.status, t, job, isRunning)}
            {job.imported_records > 0 && ` (${pct}%)`}
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
              {startButtonLabel}
            </button>
          )}
          {isRunning && (
            <button
              onClick={onPause}
              className={s.actionBtn}
              title={t('imports.pauseImportLabel')}
              aria-label={t('imports.pauseImportLabel')}
            >
              {t('imports.pauseBtn')}
            </button>
          )}
          {isRunning && (
            <button
              onClick={onCancel}
              className={s.actionBtnCancel}
              title={t('imports.cancelImportLabel')}
              aria-label={t('imports.cancelImportLabel')}
            >
              {t('imports.cancelBtn')}
            </button>
          )}
          {!isRunning && (
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
                  {modDataMenu && (
                    <ModDataMenuItems
                      clearingRows={modDataMenu.clearingRows}
                      deletingAll={modDataMenu.deletingAll}
                      onClearRows={modDataMenu.onClearRows}
                      onDeleteAll={modDataMenu.onDeleteAll}
                      onAfterAction={() => setMenuOpen(false)}
                    />
                  )}
                  <button
                    onClick={() => {
                      onDelete();
                      setMenuOpen(false);
                    }}
                    className={`${s.menuItem} ${s.menuItemDanger}`}
                    disabled={modDataMenu?.clearingRows || modDataMenu?.deletingAll}
                  >
                    <span className={s.menuIcon}>🗑</span>
                    <span>{t('mods.deleteImportJob')}</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
