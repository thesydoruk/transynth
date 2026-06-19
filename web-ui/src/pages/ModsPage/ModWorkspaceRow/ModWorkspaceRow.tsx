import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Mod, ModImportJob } from '../../../api';
import { ProgressBar, StatusBadge } from '../../../components/StatusBadge';
import { modProgress } from '../../../utils/modProgress';
import parentS from '../ModsPage.module.scss';
import rowS from '../UnifiedJobRow/UnifiedJobRow.module.scss';
import s from './ModWorkspaceRow.module.scss';

export interface ModWorkspaceRowProps {
  mod: Mod;
  importJob?: ModImportJob | null;
  exportActions: Array<{
    key: 'strings' | 'esp' | 'ba2' | 'zip';
    icon: string;
    title: string;
    disabled?: boolean;
    onClick: () => void;
  }>;
  clearingRows?: boolean;
  onOpen: () => void;
  onClearRows: () => void;
  onReimport?: () => void;
  onDeleteImport?: () => void;
}

/** Imported mod row — translation progress plus import/export workspace actions. */
export const ModWorkspaceRow = ({
  mod,
  importJob,
  exportActions,
  clearingRows,
  onOpen,
  onClearRows,
  onReimport,
  onDeleteImport,
}: ModWorkspaceRowProps) => {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { stats, approvedPct, fuzzyPct } = modProgress(mod);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (ev: MouseEvent) => {
      if (!menuRef.current?.contains(ev.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener('click', onDocClick);
    return () => window.removeEventListener('click', onDocClick);
  }, [menuOpen]);

  return (
    <div
      className={`${parentS.row} ${s.row}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className={parentS.rowLeft}>
        <span className={parentS.typeBadge} style={{ background: '#2e7d32' }}>
          MOD
        </span>
        <div className={s.main}>
          <span className={parentS.fileName}>
            {mod.name}
            {importJob?.is_localized ? (
              <span className={rowS.locBadge}>{t('modImport.localized')}</span>
            ) : null}
          </span>
          <span className={parentS.meta}>{t('common.strings', { count: mod.string_count })}</span>
        </div>
      </div>
      <div className={parentS.rowRight} onClick={(e) => e.stopPropagation()}>
        <div className={s.progressBlock}>
          <ProgressBar stats={stats} />
          <div className={s.pctRow}>
            <StatusBadge status={approvedPct === 100 ? 'human' : null} small />
            <span className={s.pctApproved}>{approvedPct}%</span>
            <span className={s.pctFuzzy}>
              {t('mods.fuzzy')} {fuzzyPct}%
            </span>
          </div>
        </div>
        <div className={parentS.actions}>
          <button
            type="button"
            onClick={onOpen}
            className={rowS.actionBtn}
            title={t('mods.openEditor')}
            aria-label={t('mods.openEditor')}
          >
            ✎
          </button>
          <div className={rowS.menuWrap} ref={menuRef}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
              className={rowS.actionBtn}
              title={t('common.moreActions')}
              aria-label={t('common.moreActions')}
            >
              ⋯
            </button>
            {menuOpen && (
              <div className={rowS.menuList}>
                {onReimport && (
                  <button
                    type="button"
                    onClick={() => {
                      onReimport();
                      setMenuOpen(false);
                    }}
                    className={rowS.menuItem}
                  >
                    <span className={rowS.menuIcon}>▶</span>
                    <span>{t('imports.reimportTooltip')}</span>
                  </button>
                )}
                {exportActions.map((action) => (
                  <button
                    key={action.key}
                    type="button"
                    onClick={() => {
                      action.onClick();
                      setMenuOpen(false);
                    }}
                    className={rowS.menuItem}
                    disabled={action.disabled}
                  >
                    <span className={rowS.menuIcon}>{action.icon}</span>
                    <span>{action.title}</span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    onClearRows();
                    setMenuOpen(false);
                  }}
                  className={rowS.menuItem}
                  disabled={clearingRows}
                >
                  <span className={rowS.menuIcon}>⌫</span>
                  <span>{clearingRows ? t('mods.clearingRows') : t('mods.clearRows')}</span>
                </button>
                {onDeleteImport && (
                  <button
                    type="button"
                    onClick={() => {
                      onDeleteImport();
                      setMenuOpen(false);
                    }}
                    className={`${rowS.menuItem} ${rowS.menuItemDanger}`}
                  >
                    <span className={rowS.menuIcon}>🗑</span>
                    <span>{t('common.delete')}</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
