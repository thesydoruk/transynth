import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Mod, ModImportJob } from '../../../api';
import { ProgressBar, StatusBadge } from '../../../components/StatusBadge';
import { modProgress } from '../../../utils/modProgress';
import parentS from '../ModsPageRow.module.scss';
import rowS from '../UnifiedJobRow/UnifiedJobRow.module.scss';
import { ModDataMenuItems } from '../ModDataMenuItems';
import { ModAiControls } from '../../../components/ModAiControls';
import { useModAiJobsForMod } from '../../../hooks/useModAiJobsForMod';
import s from './ModWorkspaceRow.module.scss';

export interface ModWorkspaceRowProps {
  mod: Mod;
  importJob?: ModImportJob | null;
  exportActions: Array<{
    key: 'langpack' | 'fullMod';
    icon: string;
    title: string;
    disabled?: boolean;
    onClick: () => void;
  }>;
  clearingRows?: boolean;
  deletingAll?: boolean;
  selected?: boolean;
  multiSelectActive?: boolean;
  onSelectedChange?: (selected: boolean) => void;
  onOpen: () => void;
  onClearRows: () => void;
  onDeleteAll: () => void;
  onDeleteImport?: () => void;
  onAiTranslateTm?: () => void;
  onAiTranslateLlm?: () => void;
  onAiTranslateStop?: () => void;
  onAiVerify?: () => void;
  onSkipDetectHeuristic?: () => void;
  onSkipDetectWithLlm?: () => void;
  onSkipDetectStop?: () => void;
  onGenderDetect?: () => void;
  onGenderDetectStop?: () => void;
  onAiVoiceMissing?: () => void;
  onAiVoiceAll?: () => void;
  onAiVoiceStop?: () => void;
}

/** Imported mod row — translation progress plus import/export workspace actions. */
export const ModWorkspaceRow = ({
  mod,
  importJob,
  exportActions,
  clearingRows,
  deletingAll,
  selected,
  multiSelectActive,
  onSelectedChange,
  onOpen,
  onClearRows,
  onDeleteAll,
  onDeleteImport,
  onAiTranslateTm,
  onAiTranslateLlm,
  onAiTranslateStop,
  onAiVerify,
  onSkipDetectHeuristic,
  onSkipDetectWithLlm,
  onSkipDetectStop,
  onGenderDetect,
  onGenderDetectStop,
  onAiVoiceMissing,
  onAiVoiceAll,
  onAiVoiceStop,
}: ModWorkspaceRowProps) => {
  const { t } = useTranslation();
  const aiJobs = useModAiJobsForMod(mod.id);
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
      className={`${parentS.row} ${s.row}${selected ? ` ${s.rowSelected}` : ''}`}
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
        {onSelectedChange && (
          <input
            type="checkbox"
            className={s.selectCheckbox}
            checked={selected ?? false}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onSelectedChange(e.target.checked)}
            aria-label={t('mods.selectMod', { name: mod.name })}
          />
        )}
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
        {(onAiTranslateTm ||
          onAiTranslateLlm ||
          onAiVerify ||
          onSkipDetectHeuristic ||
          onSkipDetectWithLlm ||
          onGenderDetect ||
          onAiVoiceMissing ||
          onAiVoiceAll) && (
          <ModAiControls
            compact
            translate={aiJobs.translate}
            verify={aiJobs.verify}
            skipDetect={aiJobs.skipDetect}
            genderDetect={aiJobs.genderDetect}
            voice={aiJobs.voice}
            onTranslateTm={onAiTranslateTm ?? (() => {})}
            onTranslateLlm={onAiTranslateLlm ?? (() => {})}
            onTranslateStop={onAiTranslateStop ?? (() => {})}
            onVerify={onAiVerify ?? (() => {})}
            onSkipDetectHeuristic={onSkipDetectHeuristic ?? (() => {})}
            onSkipDetectWithLlm={onSkipDetectWithLlm ?? (() => {})}
            onSkipDetectStop={onSkipDetectStop ?? (() => {})}
            onGenderDetect={onGenderDetect ?? (() => {})}
            onGenderDetectStop={onGenderDetectStop ?? (() => {})}
            onVoiceMissing={onAiVoiceMissing ?? (() => {})}
            onVoiceAll={onAiVoiceAll ?? (() => {})}
            onVoiceStop={onAiVoiceStop ?? (() => {})}
          />
        )}
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
                {!multiSelectActive &&
                  exportActions.map((action) => (
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
                <ModDataMenuItems
                  clearingRows={clearingRows}
                  deletingAll={deletingAll}
                  batchOnly={multiSelectActive}
                  onClearRows={onClearRows}
                  onDeleteAll={onDeleteAll}
                  onAfterAction={() => setMenuOpen(false)}
                />
                {!multiSelectActive && onDeleteImport && (
                  <button
                    type="button"
                    onClick={() => {
                      onDeleteImport();
                      setMenuOpen(false);
                    }}
                    className={`${rowS.menuItem} ${rowS.menuItemDanger}`}
                  >
                    <span className={rowS.menuIcon}>🗑</span>
                    <span>{t('mods.deleteImportJob')}</span>
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
