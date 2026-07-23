import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ModImportJob } from '../../../api';
import {
  kindColor,
  statusColorBase,
  statusLabel,
  canStartImportJob,
  importStartTooltip,
  importStartButtonLabel,
  importStatusI18nKey,
  importKindBadgeLabel,
  type UnifiedJobRowProps,
} from '../modsShared';
import { ModDataMenuItems } from '../ModDataMenuItems';
import parentS from '../ModsPageRow.module.scss';
import s from './UnifiedJobRow.module.scss';

/** Single row in the unified import list, with a colored type badge. */
export const UnifiedJobRow = ({
  kind,
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
  const isMod = kind === 'mod';
  const modJob = isMod ? (job as ModImportJob) : null;
  const canStart = canStartImportJob(job, isRunning, kind);
  const hasExportActions = (exportActions?.length ?? 0) > 0;
  const showOverflowMenu = !isRunning && (isMod || hasExportActions);
  const showStandaloneDelete = !isRunning && !showOverflowMenu;
  const isFailed = job.status === 'failed';
  const startTooltip = importStartTooltip(job, isRunning, kind, t);
  const startButtonLabel = importStartButtonLabel(job, isRunning, t);
  const lastError =
    isFailed && 'last_error' in job ? (job as { last_error: string | null }).last_error : null;

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
        <span className={parentS.typeBadge} style={{ background: kindColor(kind) }}>
          {importKindBadgeLabel(kind, t)}
        </span>
        <div>
          <span className={parentS.fileName}>
            {job.file_name}
            {modJob?.is_localized ? (
              <span className={s.locBadge}>{t('modImport.localized')}</span>
            ) : null}
          </span>
          <span className={parentS.meta}>
            {isMod
              ? t('common.strings', { count: total })
              : t('imports.langPairMeta', {
                  src: job.src_lang,
                  tgt: job.tgt_lang,
                  count: total,
                })}
          </span>
          {lastError && (
            <span className={s.errorText} title={lastError}>
              {lastError}
            </span>
          )}
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
            title={
              job.status === 'failed' && 'last_error' in job && job.last_error
                ? job.last_error
                : undefined
            }
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
          {!isRunning && showOverflowMenu && (
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
                  {isMod && (
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
                  )}
                  {!isMod && (
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
                  )}
                </div>
              )}
            </div>
          )}
          {showStandaloneDelete && (
            <button onClick={onDelete} className={s.actionBtnDelete} title={t('common.delete')}>
              🗑
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
