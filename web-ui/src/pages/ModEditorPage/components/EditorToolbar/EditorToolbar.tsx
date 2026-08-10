import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ProgressBar } from '../../../../components/StatusBadge';
import { Button } from '../../../../components/Button';
import { DropdownButton } from '../../../../components/DropdownButton';
import { ModAiControls } from '../../../../components/ModAiControls';
import type { ModAiJobEntry } from '../../../../modAiJobsStore';
import { StatusFilter } from '../StatusFilter';
import { type StatusFilterValue } from '../../statusFilter';
import { EditorModeSwitch, type EditorPageMode } from './EditorModeSwitch';
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
  /** Active view mode — 'strings' shows the grid, 'dialogs' shows the transcript editor. */
  pageMode: EditorPageMode;
  stats: ModStats | undefined;
  selectedCount: number;
  translateProgress: { done: number; total: number } | null;
  clearSameAsSource: ClearSameAsSourceState;
  gameId: string | undefined;
  modId: number;
  hasInnrSignature: boolean;
  aiJobs: {
    translate: ModAiJobEntry;
    verify: ModAiJobEntry;
    skipDetect: ModAiJobEntry;
    genderDetect: ModAiJobEntry;
    stressPlace: ModAiJobEntry;
    voice: ModAiJobEntry;
  };

  onSrcLangChange: (lang: string) => void;
  onTargetLangChange: (lang: string) => void;
  onSelectedStatusesChange: (statuses: StatusFilterValue[]) => void;
  onQaOnlyChange: (qaOnly: boolean) => void;
  onClearSameAsSource: () => void;
  onSearchReplace: () => void;
  onApplyTranslationFromMod: () => void;
  applyImportedRunning?: boolean;
  onShortcuts: () => void;
  onBatchTranslate: () => void;
  onPageModeChange: (mode: EditorPageMode) => void;
  onTranslateTm: () => void;
  onTranslateLlm: () => void;
  onTranslateStop: () => void;
  onAiVerify: () => void;
  onSkipDetectHeuristic: () => void;
  onSkipDetectWithLlm: () => void;
  onSkipDetectStop: () => void;
  onGenderDetect: () => void;
  onGenderDetectStop: () => void;
  onStressPlaceMissing: () => void;
  onStressPlaceAll: () => void;
  onStressPlaceStop: () => void;
  onAiVoiceMissing: () => void;
  onAiVoiceAll: () => void;
  onAiVoiceStop: () => void;
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
  clearSameAsSource,
  gameId,
  modId,
  hasInnrSignature,
  aiJobs,
  onSrcLangChange,
  onTargetLangChange,
  onSelectedStatusesChange,
  onQaOnlyChange,
  onClearSameAsSource,
  onSearchReplace,
  onApplyTranslationFromMod,
  applyImportedRunning = false,
  onShortcuts,
  onBatchTranslate,
  onPageModeChange,
  onTranslateTm,
  onTranslateLlm,
  onTranslateStop,
  onAiVerify,
  onSkipDetectHeuristic,
  onSkipDetectWithLlm,
  onSkipDetectStop,
  onGenderDetect,
  onGenderDetectStop,
  onStressPlaceMissing,
  onStressPlaceAll,
  onStressPlaceStop,
  onAiVoiceMissing,
  onAiVoiceAll,
  onAiVoiceStop,
}: EditorToolbarProps) => {
  const { t } = useTranslation();

  return (
    <div className={styles.toolbar}>
      <div className={styles.modHeader}>
        <span className={styles.modName}>{modName ?? '…'}</span>
        <ModAiControls
          translate={aiJobs.translate}
          verify={aiJobs.verify}
          skipDetect={aiJobs.skipDetect}
          genderDetect={aiJobs.genderDetect}
          stressPlace={aiJobs.stressPlace}
          voice={aiJobs.voice}
          onTranslateTm={onTranslateTm}
          onTranslateLlm={onTranslateLlm}
          onTranslateStop={onTranslateStop}
          onVerify={onAiVerify}
          onSkipDetectHeuristic={onSkipDetectHeuristic}
          onSkipDetectWithLlm={onSkipDetectWithLlm}
          onSkipDetectStop={onSkipDetectStop}
          onGenderDetect={onGenderDetect}
          onGenderDetectStop={onGenderDetectStop}
          onStressPlaceMissing={onStressPlaceMissing}
          onStressPlaceAll={onStressPlaceAll}
          onStressPlaceStop={onStressPlaceStop}
          onVoiceMissing={onAiVoiceMissing}
          onVoiceAll={onAiVoiceAll}
          onVoiceStop={onAiVoiceStop}
          variant="circular"
        />
      </div>

      <div className={styles.sep} />

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

      <EditorModeSwitch mode={pageMode} onChange={onPageModeChange} />

      <div className={styles.sep} />

      {pageMode === 'strings' && (
        <>
          <StatusFilter
            selected={selectedStatuses}
            onChange={onSelectedStatusesChange}
            qaOnly={qaOnly}
            onQaOnlyChange={onQaOnlyChange}
          />
          <Button onClick={onSearchReplace} variant="secondary" size="sm">
            {t('modEditor.searchReplace')}
          </Button>
        </>
      )}
      <DropdownButton
        label={t('modEditor.translationMenu')}
        title={t('modEditor.translationMenuTitle')}
        items={[
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
      <Button onClick={onShortcuts} variant="secondary" size="sm" title={t('modEditor.shortcuts')}>
        ?
      </Button>

      {pageMode === 'strings' && selectedCount > 0 && (
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
              {t('modEditor.autoTranslateSelection', { count: selectedCount })}
            </Button>
          )}
        </>
      )}

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
