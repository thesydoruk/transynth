import { useMemo, type UIEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { StringRow, RagSuggestion, QAIssue, TranslationHistoryEntry } from '../../../../api';
import { Button } from '../../../../components/Button';
import { SuggestionsPanel } from '../SuggestionsPanel';
import { QAPanel } from '../QAPanel';
import { HistoryPanel } from '../HistoryPanel';
import { getPlaceholderParts } from './utils';
import styles from './DetailPanel.module.scss';

/** Bottom-panel tab identifiers. */
export type BottomTab = 'suggestions' | 'qa' | 'history';

/** Props for the detail editing panel below the string grid. */
export interface DetailPanelProps {
  /** The row currently being edited. */
  activeRow: StringRow;
  /** Working copy of the translation text. */
  draftTranslation: string;
  srcLang: string;
  targetLang: string;
  /** Currently selected sub-tab (suggestions / qa / history). */
  activeTab: BottomTab;
  /** Visual indicator for the save button. */
  saveIndicator: 'idle' | 'saving' | 'saved';
  savePending: boolean;
  /** Maximum character length rule (if any) for the active row. */
  activeMaxLength: number | null;

  /** RAG reference examples for the active row. */
  suggestions: RagSuggestion[];
  /** QA issues for the active row. */
  qaIssues: QAIssue[];
  /** Edit history for the active row. */
  history: TranslationHistoryEntry[];

  /** Ref attached to the translation textarea (for external focus). */
  translAreaRef: React.RefObject<HTMLTextAreaElement | null>;

  onDraftChange: (text: string) => void;
  onSave: () => void;
  onCopySource: () => void;
  onTabChange: (tab: BottomTab) => void;
  onOpenBookEditor: () => void;
}

/**
 * Bottom detail panel shown when a grid row is active.
 *
 * Contains two side-by-side text areas (source / translation), action
 * buttons, a character count / max-length indicator, and a tabbed
 * sub-panel for TM suggestions, QA issues, and edit history.
 */
export const DetailPanel = ({
  activeRow,
  draftTranslation,
  srcLang,
  targetLang,
  activeTab,
  saveIndicator,
  savePending,
  activeMaxLength,
  suggestions,
  qaIssues,
  history,
  translAreaRef,
  onDraftChange,
  onSave,
  onCopySource,
  onTabChange,
  onOpenBookEditor,
}: DetailPanelProps) => {
  const { t } = useTranslation();
  const placeholderParts = useMemo(() => getPlaceholderParts(draftTranslation), [draftTranslation]);

  const maxLengthRemaining =
    activeMaxLength != null ? activeMaxLength - draftTranslation.length : null;
  const maxLengthExceeded = maxLengthRemaining != null && maxLengthRemaining < 0;
  const maxLengthNear =
    maxLengthRemaining != null && maxLengthRemaining >= 0 && maxLengthRemaining <= 20;
  const syncOverlayScroll = (e: UIEvent<HTMLTextAreaElement>) => {
    const overlay = e.currentTarget.previousElementSibling;
    if (!(overlay instanceof HTMLDivElement)) return;
    overlay.scrollTop = e.currentTarget.scrollTop;
    overlay.scrollLeft = e.currentTarget.scrollLeft;
  };

  return (
    <div className={styles.detailPanel}>
      <div className={styles.detailPanels}>
        {/* Source text */}
        <div className={styles.textPanel}>
          <div className={styles.panelLabel}>
            {t('modEditor.sourceTextLabel', { lang: srcLang.toUpperCase() })}
          </div>
          {activeRow.context && (
            <div className={styles.speakerContext} title={t('modEditor.speakerContextTitle')}>
              {t('modEditor.speakerContextLabel')}
              {activeRow.context}
            </div>
          )}
          <textarea readOnly value={activeRow.source} className={styles.sourceArea} rows={4} />
          <div className={styles.charCount}>
            {t('modEditor.charCount', { count: activeRow.source.length })}
          </div>
        </div>

        {/* Translation text */}
        <div className={styles.textPanel}>
          <div className={styles.panelLabel}>
            {t('modEditor.translationTextLabel', { lang: targetLang.toUpperCase() })}
            {(activeRow.signature === 'BOOK' || /<[a-zA-Z]/.test(activeRow.source)) && (
              <button
                className={styles.btnSec}
                style={{ marginLeft: 'auto', padding: '2px 10px', fontSize: '12px' }}
                onClick={onOpenBookEditor}
                title={t('bookEditor.openBtn')}
              >
                📖 {t('bookEditor.openBtn')}
              </button>
            )}
          </div>
          <div className={styles.translAreaWrap}>
            <div className={styles.translAreaOverlay} aria-hidden="true">
              <div className={styles.translAreaOverlayContent}>
                {draftTranslation.length === 0 ? (
                  <span className={styles.translPlaceholder}>
                    {t('modEditor.enterTranslation')}
                  </span>
                ) : (
                  placeholderParts.map((part, index) => (
                    <span
                      key={`${part.isPlaceholder ? 'ph' : 'txt'}-${index}`}
                      className={part.isPlaceholder ? styles.placeholderToken : undefined}
                    >
                      {part.text}
                    </span>
                  ))
                )}
              </div>
            </div>
            <textarea
              ref={translAreaRef}
              value={draftTranslation}
              onChange={(e) => onDraftChange(e.target.value)}
              className={styles.translArea}
              rows={4}
              onScroll={syncOverlayScroll}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onSave();
              }}
              placeholder={t('modEditor.enterTranslation')}
            />
          </div>
          <div className={styles.detailBtnBar}>
            <div className={styles.charInfo}>
              <div className={styles.charCount}>
                {t('modEditor.charCount', { count: draftTranslation.length })}
              </div>
              {activeMaxLength != null && (
                <div
                  className={`${styles.maxLengthHint} ${maxLengthExceeded ? styles.maxLengthHintError : maxLengthNear ? styles.maxLengthHintWarn : styles.maxLengthHintOk}`}
                >
                  {t('modEditor.maxLength', { max: activeMaxLength })}
                  {' · '}
                  {maxLengthExceeded
                    ? t('modEditor.maxLengthExceeded', { count: Math.abs(maxLengthRemaining ?? 0) })
                    : t('modEditor.maxLengthRemaining', { count: maxLengthRemaining ?? 0 })}
                </div>
              )}
            </div>
            <div className={styles.detailSaveRow}>
              <Button
                variant="secondary"
                size="sm"
                onClick={onCopySource}
                title={t('modEditor.copySourceToTranslation')}
              >
                {t('modEditor.copySrc')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={onSave}
                disabled={savePending}
                title="Ctrl+Enter"
              >
                {savePending
                  ? t('modEditor.saving')
                  : saveIndicator === 'saved'
                    ? t('modEditor.saved')
                    : t('common.save')}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom tabs */}
      <div className={styles.tabs}>
        {(['suggestions', 'qa', 'history'] as BottomTab[]).map((tab) => (
          <button
            key={tab}
            className={`${styles.tabBtn} ${activeTab === tab ? styles.tabBtnActive : ''}`}
            onClick={() => onTabChange(tab)}
          >
            {tab === 'suggestions'
              ? t('modEditor.tabSuggestions')
              : tab === 'qa'
                ? t('modEditor.tabQa')
                : t('modEditor.tabHistory')}
          </button>
        ))}
      </div>
      <div className={styles.tabContent}>
        {activeTab === 'suggestions' && (
          <SuggestionsPanel
            suggestions={suggestions ?? []}
            onApply={(text) => onDraftChange(text)}
          />
        )}
        {activeTab === 'qa' && <QAPanel issues={qaIssues ?? []} />}
        {activeTab === 'history' && <HistoryPanel items={history ?? []} />}
      </div>
    </div>
  );
};
