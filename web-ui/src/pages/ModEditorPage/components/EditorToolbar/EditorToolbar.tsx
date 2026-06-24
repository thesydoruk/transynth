import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ProgressBar } from '../../../../components/StatusBadge';
import { Button } from '../../../../components/Button';
import { DropdownButton } from '../../../../components/DropdownButton';
import { StatusFilter } from '../StatusFilter';
import { type StatusFilterValue } from '../../statusFilter';
import styles from './EditorToolbar.module.scss';

/** Shape returned by the stats API. */
export interface ModStats {
  approved: number;
  draft: number;
  rejected: number;
  tm: number;
  fuzzy: number;
  auto_translated: number;
  skipped: number;
  untranslated: number;
  translated: number;
  total: number;
  percent: number;
}

/** Shape of the TM-apply mutation state passed from the parent. */
export interface TmApplyState {
  isPending: boolean;
  isSuccess: boolean;
  applied: number;
}

/** Shape of the clear-same-as-source mutation state passed from the parent. */
export interface ClearSameAsSourceState {
  isPending: boolean;
  isSuccess: boolean;
  cleared: number;
}

/** Props for the top toolbar strip of the mod editor. */
export interface EditorToolbarProps {
  modName: string | undefined;
  srcLang: string;
  targetLang: string;
  availLangs: string[];
  selectedStatuses: StatusFilterValue[];
  qaOnly: boolean;
  /** Active view mode — 'strings' shows the grid, 'dialogs' shows the tree. */
  pageMode: 'strings' | 'dialogs';
  stats: ModStats | undefined;
  selectedCount: number;
  translateProgress: { done: number; total: number } | null;
  translateError: string | null;
  tmApply: TmApplyState;
  clearSameAsSource: ClearSameAsSourceState;
  gameId: string | undefined;
  modId: number;
  hasInnrSignature: boolean;
  hasBookSignature: boolean;
  qaIssueRowCount: number;

  onSrcLangChange: (lang: string) => void;
  onTargetLangChange: (lang: string) => void;
  onSelectedStatusesChange: (statuses: StatusFilterValue[]) => void;
  onQaOnlyToggle: () => void;
  onTmApply: () => void;
  onClearSameAsSource: () => void;
  onSearchReplace: () => void;
  onApplyTranslationFromMod: () => void;
  applyImportedRunning?: boolean;
  onAiVerify: () => void;
  onAiTranslate: () => void;
  onSkipDetect: () => void;
  aiVerifyRunning?: boolean;
  aiTranslateRunning?: boolean;
  skipDetectRunning?: boolean;
  onShortcuts: () => void;
  onBatchTranslate: () => void;
  onNextQaIssue: () => void;
  onPageModeChange: (mode: 'strings' | 'dialogs') => void;
}

/**
 * Horizontal toolbar at the top of the mod editor page.
 */
export const EditorToolbar = ({
  modName,
  srcLang,
  targetLang,
  availLangs,
  selectedStatuses,
  qaOnly,
  pageMode,
  stats,
  selectedCount,
  translateProgress,
  translateError,
  tmApply,
  clearSameAsSource,
  gameId,
  modId,
  hasInnrSignature,
  hasBookSignature,
  qaIssueRowCount,
  onSrcLangChange,
  onTargetLangChange,
  onSelectedStatusesChange,
  onQaOnlyToggle,
  onTmApply,
  onClearSameAsSource,
  onSearchReplace,
  onApplyTranslationFromMod,
  applyImportedRunning = false,
  onAiVerify,
  onAiTranslate,
  onSkipDetect,
  aiVerifyRunning = false,
  aiTranslateRunning = false,
  skipDetectRunning = false,
  onShortcuts,
  onBatchTranslate,
  onNextQaIssue,
  onPageModeChange,
}: EditorToolbarProps) => {
  const { t } = useTranslation();

  return (
    <div className={styles.toolbar}>
      <span className={styles.modName}>{modName ?? '…'}</span>

      <label className={styles.langLabel}>
        {t('modEditor.source')}
        <select
          value={srcLang}
          onChange={(e) => onSrcLangChange(e.target.value)}
          className={styles.langSelect}
        >
          {availLangs.map((l) => (
            <option key={l} value={l}>
              {l.toUpperCase()}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.langLabel}>
        {t('modEditor.target')}
        <select
          value={targetLang}
          onChange={(e) => onTargetLangChange(e.target.value)}
          className={styles.langSelect}
        >
          {availLangs.map((l) => (
            <option key={l} value={l}>
              {l.toUpperCase()}
            </option>
          ))}
        </select>
      </label>

      <div className={styles.sep} />

      <StatusFilter
        selected={selectedStatuses}
        onChange={(next) => {
          onSelectedStatusesChange(next);
        }}
      />
      <Button
        onClick={onQaOnlyToggle}
        variant={qaOnly ? 'primary' : 'secondary'}
        size="sm"
        title={t('modEditor.qaOnlyTitle')}
      >
        {t('modEditor.qaOnly')}
      </Button>

      <div className={styles.sep} />

      <Button onClick={onSearchReplace} variant="secondary" size="sm">
        {t('modEditor.searchReplace')}
      </Button>
      <DropdownButton
        label={t('modEditor.translationMenu')}
        title={t('modEditor.translationMenuTitle')}
        items={[
          {
            label: tmApply.isPending
              ? t('modEditor.applyingTm')
              : tmApply.isSuccess
                ? t('modEditor.tmApplied', { count: tmApply.applied })
                : t('modEditor.applyTm'),
            onClick: onTmApply,
            disabled: tmApply.isPending,
          },
          {
            label: clearSameAsSource.isPending
              ? t('modEditor.clearSameAsSourceRunning')
              : clearSameAsSource.isSuccess
                ? t('modEditor.clearSameAsSourceDone', { count: clearSameAsSource.cleared })
                : t('modEditor.clearSameAsSource'),
            onClick: onClearSameAsSource,
            disabled: clearSameAsSource.isPending,
          },
          {
            label: applyImportedRunning
              ? t('modEditor.applyTranslationFromModRunning')
              : t('modEditor.applyTranslationFromMod'),
            onClick: onApplyTranslationFromMod,
          },
          {
            label: aiTranslateRunning
              ? t('modEditor.aiTranslateRunning')
              : t('modEditor.aiTranslate'),
            onClick: onAiTranslate,
          },
          {
            label: aiVerifyRunning ? t('modEditor.aiVerifyRunning') : t('modEditor.aiVerify'),
            onClick: onAiVerify,
          },
          {
            label: skipDetectRunning ? t('modEditor.skipDetectRunning') : t('modEditor.skipDetect'),
            onClick: onSkipDetect,
          },
        ]}
      />
      {hasInnrSignature && (
        <Link
          to={`/games/${gameId}/mods/${modId}/innr`}
          className={styles.btnSec}
          title={t('modEditor.innrEditorTitle')}
        >
          {t('modEditor.innrEditor')}
        </Link>
      )}
      {hasBookSignature && (
        <Link
          to={`/games/${gameId}/mods/${modId}?signature=BOOK`}
          className={styles.btnSec}
          title={t('modEditor.bookEditorTitle')}
        >
          {t('modEditor.bookEditor')}
        </Link>
      )}
      {qaIssueRowCount > 0 && (
        <Button
          onClick={onNextQaIssue}
          variant="secondary"
          size="sm"
          title={t('modEditor.nextQaIssueTitle')}
        >
          {t('modEditor.nextQaIssue', { count: qaIssueRowCount })}
        </Button>
      )}
      <Button onClick={onShortcuts} variant="secondary" size="sm" title={t('modEditor.shortcuts')}>
        ?
      </Button>

      <div className={styles.sep} />

      <Button
        onClick={() => onPageModeChange(pageMode === 'dialogs' ? 'strings' : 'dialogs')}
        variant={pageMode === 'dialogs' ? 'primary' : 'secondary'}
        size="sm"
        title={t('dialogs.modeButtonTitle')}
      >
        {t('dialogs.modeButton')}
      </Button>

      {selectedCount > 0 && (
        <>
          {translateProgress ? (
            <span className={styles.progressBadge}>
              {t('modEditor.translating', {
                done: translateProgress.done,
                total: translateProgress.total,
              })}
            </span>
          ) : (
            <Button onClick={onBatchTranslate} variant="primary" size="sm">
              {t('modEditor.autoTranslate', { count: selectedCount })}
            </Button>
          )}
        </>
      )}
      {translateError && <span className={styles.errorBadge}>{translateError}</span>}

      {stats && (
        <div className={styles.progressSection}>
          <ProgressBar stats={stats} />
          <span className={styles.progressLabel}>
            {t('modEditor.approvedOfTotal', { approved: stats.approved, total: stats.total })}
          </span>
        </div>
      )}
    </div>
  );
};
