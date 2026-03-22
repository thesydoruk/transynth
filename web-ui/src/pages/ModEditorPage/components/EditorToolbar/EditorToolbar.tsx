import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ProgressBar } from '../../../../components/StatusBadge';
import styles from './EditorToolbar.module.scss';

/** Shape returned by the stats API. */
export interface ModStats {
  approved: number;
  draft: number;
  rejected: number;
  tm: number;
  fuzzy: number;
  auto_translated: number;
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

/** Props for the top toolbar strip of the mod editor. */
export interface EditorToolbarProps {
  modName: string | undefined;
  srcLang: string;
  targetLang: string;
  availLangs: string[];
  status: string;
  qaOnly: boolean;
  stats: ModStats | undefined;
  selectedCount: number;
  translateProgress: { done: number; total: number } | null;
  translateError: string | null;
  tmApply: TmApplyState;
  bulkReviewPending: boolean;
  gameId: string | undefined;
  modId: number;
  hasInnrSignature: boolean;
  hasBookSignature: boolean;
  qaIssueRowCount: number;
  untranslatedCount: number | undefined;
  statusOpts: string[];

  onSrcLangChange: (lang: string) => void;
  onTargetLangChange: (lang: string) => void;
  onStatusChange: (status: string) => void;
  onQaOnlyToggle: () => void;
  onTmApply: () => void;
  onSearchReplace: () => void;
  onShortcuts: () => void;
  onBatchTranslate: () => void;
  onBulkReview: (status: 'reviewed' | 'rejected') => void;
  onNextUntranslated: () => void;
  onNextQaIssue: () => void;
}

/**
 * Horizontal toolbar at the top of the mod editor page.
 *
 * Contains language selectors, status / QA filters, action buttons
 * (TM apply, search-replace, INNR editor, auto-translate), bulk-review
 * buttons, and a progress bar summarising translation coverage.
 */
export const EditorToolbar = ({
  modName,
  srcLang,
  targetLang,
  availLangs,
  status,
  qaOnly,
  stats,
  selectedCount,
  translateProgress,
  translateError,
  tmApply,
  bulkReviewPending,
  gameId,
  modId,
  hasInnrSignature,
  hasBookSignature,
  qaIssueRowCount,
  untranslatedCount,
  statusOpts,
  onSrcLangChange,
  onTargetLangChange,
  onStatusChange,
  onQaOnlyToggle,
  onTmApply,
  onSearchReplace,
  onShortcuts,
  onBatchTranslate,
  onBulkReview,
  onNextUntranslated,
  onNextQaIssue,
}: EditorToolbarProps) => {
  const { t } = useTranslation();

  return (
    <div className={styles.toolbar}>
      <span className={styles.modName}>{modName ?? '…'}</span>

      {/* Language selectors */}
      <label className={styles.langLabel}>
        {t('modEditor.source')}
        <select value={srcLang} onChange={(e) => onSrcLangChange(e.target.value)} className={styles.langSelect}>
          {availLangs.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
        </select>
      </label>
      <label className={styles.langLabel}>
        {t('modEditor.target')}
        <select value={targetLang} onChange={(e) => onTargetLangChange(e.target.value)} className={styles.langSelect}>
          {availLangs.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
        </select>
      </label>

      <div className={styles.sep} />

      {/* Status filter */}
      <select value={status} onChange={(e) => onStatusChange(e.target.value)} className={styles.filterSelect}>
        {statusOpts.map((o) => <option key={o} value={o}>{o === 'all' ? t('modEditor.allStatuses') : o}</option>)}
      </select>
      <button onClick={onQaOnlyToggle} className={qaOnly ? styles.btnPri : styles.btnSec} title={t('modEditor.qaOnlyTitle')}>
        {t('modEditor.qaOnly')}
      </button>
      <button
        onClick={() => onStatusChange(status === 'draft' ? 'all' : 'draft')}
        className={status === 'draft' ? styles.btnPri : styles.btnSec}
        title={t('modEditor.showDraftsTitle')}
      >
        {stats?.draft ? t('modEditor.reviewModeCount', { count: stats.draft }) : t('modEditor.reviewMode')}
      </button>

      <div className={styles.sep} />

      {/* Actions */}
      <button onClick={onTmApply} disabled={tmApply.isPending} className={styles.btnSec} title={t('modEditor.autoFillTmTitle')}>
        {tmApply.isPending ? t('modEditor.applyingTm') : tmApply.isSuccess ? t('modEditor.tmApplied', { count: tmApply.applied }) : t('modEditor.applyTm')}
      </button>
      <button onClick={onSearchReplace} className={styles.btnSec}>{t('modEditor.searchReplace')}</button>
      {hasInnrSignature && (
        <Link to={`/games/${gameId}/mods/${modId}/innr`} className={styles.btnSec} title={t('modEditor.innrEditorTitle')}>
          {t('modEditor.innrEditor')}
        </Link>
      )}
      {hasBookSignature && (
        <Link to={`/games/${gameId}/mods/${modId}?signature=BOOK`} className={styles.btnSec} title={t('modEditor.bookEditorTitle')}>
          {t('modEditor.bookEditor')}
        </Link>
      )}
      {(untranslatedCount ?? 0) > 0 && (
        <button onClick={onNextUntranslated} className={styles.btnSec} title={t('modEditor.nextUntranslatedTitle')}>
          {t('modEditor.nextUntranslated', { count: untranslatedCount })}
        </button>
      )}
      {qaIssueRowCount > 0 && (
        <button onClick={onNextQaIssue} className={styles.btnSec} title={t('modEditor.nextQaIssueTitle')}>
          {t('modEditor.nextQaIssue', { count: qaIssueRowCount })}
        </button>
      )}
      <button onClick={onShortcuts} className={styles.btnSec} title={t('modEditor.shortcuts')}>?</button>

      {selectedCount > 0 && (
        <>
          {translateProgress
            ? <span className={styles.progressBadge}>{t('modEditor.translating', { done: translateProgress.done, total: translateProgress.total })}</span>
            : <button onClick={onBatchTranslate} className={styles.btnPri}>{t('modEditor.autoTranslate', { count: selectedCount })}</button>
          }
          <button
            onClick={() => onBulkReview('reviewed')}
            disabled={bulkReviewPending}
            className={styles.btnApprove}
            title={t('modEditor.confirm')}
          >
            {bulkReviewPending ? '…' : t('modEditor.approveCount', { count: selectedCount })}
          </button>
          <button
            onClick={() => onBulkReview('rejected')}
            disabled={bulkReviewPending}
            className={styles.btnDanger}
            title={t('modEditor.reject')}
          >
            {bulkReviewPending ? '…' : t('modEditor.rejectCount', { count: selectedCount })}
          </button>
        </>
      )}
      {translateError && <span className={styles.errorBadge}>{translateError}</span>}

      {/* Progress bar */}
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
