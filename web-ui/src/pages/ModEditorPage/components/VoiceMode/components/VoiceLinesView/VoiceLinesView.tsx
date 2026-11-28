import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';
import type { VoiceEffortChoice, VoiceLinePreview } from '../../../../../../api';
import type { ModAiJobEntry } from '../../../../../../modAiJobsStore';
import { lineKey, type PlayKind } from '../../voiceLineKeys';
import type { VoiceLineCounts } from '../../filterVoiceLines';
import type { VoiceLineFilter } from '../../hooks/useVoiceState';
import type { CommitAdvance } from './VoiceLineRow';
import { VoiceLineRow } from './VoiceLineRow';
import { VoiceLinesHeader } from './VoiceLinesHeader';
import styles from './VoiceLinesView.module.scss';

const ROW_ESTIMATE = 128;

export type VoiceLineHandlers = {
  focusedId: number | null;
  editingId: number | null;
  pendingIds: ReadonlySet<number>;
  onFocus: (line: VoiceLinePreview) => void;
  onEdit: (line: VoiceLinePreview) => void;
  onCancel: () => void;
  onCommit: (line: VoiceLinePreview, text: string, advance: CommitAdvance) => void;
  /** Clear the translation and remove the line's synthesized take. */
  onClear: (line: VoiceLinePreview) => void;
};

export interface VoiceLinesViewProps {
  speakerName: string;
  dubbed: number;
  total: number;
  /** Lines of {@link total} that have no dialogue record and cannot be dubbed. */
  orphans: number;
  hasReference: boolean;
  lines: VoiceLinePreview[];
  hiddenLineCount: number;
  filter: VoiceLineFilter;
  onFilterChange: (filter: VoiceLineFilter) => void;
  counts: VoiceLineCounts;
  /** Vocal-effort tagging of the mod's game; unset when the game never tags lines. */
  effort?: {
    active: boolean;
    /** {@link lineKey} of the line whose tag is being saved. */
    pendingKey: string | null;
    onChoose: (line: VoiceLinePreview, choice: VoiceEffortChoice) => void;
  };
  find: string;
  onFindChange: (value: string) => void;
  playingTrack: string | null;
  loadingTrack: string | null;
  setReferencePending: boolean;
  generatePending: boolean;
  regenerateLine: VoiceLinePreview | null;
  error: string | null;
  onDismissError: () => void;
  onPlay: (line: VoiceLinePreview, kind: PlayKind) => void;
  onSetReference: (line: VoiceLinePreview) => void;
  onGenerate: (line: VoiceLinePreview) => void;
  onRegenerate: (line: VoiceLinePreview) => void;
  lineHandlers: VoiceLineHandlers;
  emptyMessage: string | null;
  isLoadingLines?: boolean;
  voiceJob: ModAiJobEntry;
  voiceProgress: number | null;
  showVoiceProgress: boolean;
  onVoiceMissing: () => void;
  onVoiceAll: () => void;
  onVoiceLowSimilarity: () => void;
  onVoiceStop: () => void;
  synthesizingLines?: ReadonlySet<string>;
  flashedLines?: ReadonlySet<string>;
}

/** Right column: header filters and the stream of voice lines. */
export const VoiceLinesView = ({
  speakerName,
  dubbed,
  total,
  orphans,
  hasReference,
  lines,
  hiddenLineCount,
  filter,
  onFilterChange,
  counts,
  effort,
  find,
  onFindChange,
  playingTrack,
  loadingTrack,
  setReferencePending,
  generatePending,
  regenerateLine,
  error,
  onDismissError,
  onPlay,
  onSetReference,
  onGenerate,
  onRegenerate,
  lineHandlers,
  emptyMessage,
  isLoadingLines = false,
  voiceJob,
  voiceProgress,
  showVoiceProgress,
  onVoiceMissing,
  onVoiceAll,
  onVoiceLowSimilarity,
  onVoiceStop,
  synthesizingLines,
  flashedLines,
}: VoiceLinesViewProps) => {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE,
    overscan: 10,
  });

  if (emptyMessage) {
    return (
      <section className={styles.panel}>
        <p className={styles.placeholder}>{emptyMessage}</p>
      </section>
    );
  }

  return (
    <section className={styles.panel}>
      <VoiceLinesHeader
        speakerName={speakerName}
        dubbed={dubbed}
        total={total}
        orphans={orphans}
        hasReference={hasReference}
        filter={filter}
        onFilterChange={onFilterChange}
        counts={counts}
        showEffortFilter={Boolean(effort)}
        find={find}
        onFindChange={onFindChange}
        hiddenLineCount={hiddenLineCount}
        error={error}
        onDismissError={onDismissError}
        isFetching={isLoadingLines}
        voiceJob={voiceJob}
        voiceProgress={voiceProgress}
        showVoiceProgress={showVoiceProgress}
        onVoiceMissing={onVoiceMissing}
        onVoiceAll={onVoiceAll}
        onVoiceLowSimilarity={onVoiceLowSimilarity}
        onVoiceStop={onVoiceStop}
      />

      <div ref={scrollRef} className={styles.stream}>
        {isLoadingLines ? (
          <p className={styles.placeholder}>{t('modEditor.voiceLoading')}</p>
        ) : lines.length === 0 ? (
          <p className={styles.placeholder}>{t('voice.noLinesMatch')}</p>
        ) : (
          <div className={styles.viewport} style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const line = lines[item.index]!;
              return (
                <div
                  key={`${line.speakerKey}:${line.lineKey}:${line.variant}`}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  className={styles.rowSlot}
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <VoiceLineRow
                    line={line}
                    focused={line.stringId != null && lineHandlers.focusedId === line.stringId}
                    editing={line.stringId != null && lineHandlers.editingId === line.stringId}
                    saving={line.stringId != null && lineHandlers.pendingIds.has(line.stringId)}
                    playingTrack={playingTrack}
                    loadingTrack={loadingTrack}
                    setReferencePending={setReferencePending}
                    generatePending={generatePending}
                    synthesizing={synthesizingLines?.has(lineKey(line)) ?? false}
                    flashed={flashedLines?.has(lineKey(line)) ?? false}
                    regenerateOpen={
                      regenerateLine?.speakerKey === line.speakerKey &&
                      regenerateLine.lineKey === line.lineKey &&
                      regenerateLine.variant === line.variant
                    }
                    effort={
                      effort && {
                        active: effort.active,
                        pending: effort.pendingKey === lineKey(line),
                        onChoose: effort.onChoose,
                      }
                    }
                    onFocus={() => lineHandlers.onFocus(line)}
                    onEdit={() => lineHandlers.onEdit(line)}
                    onCancel={lineHandlers.onCancel}
                    onCommit={(text, advance) => lineHandlers.onCommit(line, text, advance)}
                    onClear={() => lineHandlers.onClear(line)}
                    onPlay={onPlay}
                    onSetReference={onSetReference}
                    onGenerate={onGenerate}
                    onRegenerate={onRegenerate}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      <footer className={styles.hints}>{t('voice.hotkeyHint')}</footer>
    </section>
  );
};
