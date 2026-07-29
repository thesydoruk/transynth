import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';
import type { VoiceLinePreview } from '../../../../../../api';
import type { PlayKind } from '../../voiceLineKeys';
import type { VoiceLineFilter } from '../../hooks/useVoiceState';
import { VoiceLineRow } from './VoiceLineRow';
import { VoiceLinesHeader } from './VoiceLinesHeader';
import styles from './VoiceLinesView.module.scss';

const ROW_ESTIMATE = 96;

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
  counts: { total: number; needsTranslation: number; needsVoice: number };
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
  emptyMessage: string | null;
  isLoadingLines?: boolean;
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
  emptyMessage,
  isLoadingLines = false,
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
        find={find}
        onFindChange={onFindChange}
        hiddenLineCount={hiddenLineCount}
        error={error}
        onDismissError={onDismissError}
        isFetching={isLoadingLines}
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
                  key={`${line.formidLower6}:${line.variant}`}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  className={styles.rowSlot}
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <VoiceLineRow
                    line={line}
                    playingTrack={playingTrack}
                    loadingTrack={loadingTrack}
                    setReferencePending={setReferencePending}
                    generatePending={generatePending}
                    regenerateOpen={
                      regenerateLine?.formidLower6 === line.formidLower6 &&
                      regenerateLine.variant === line.variant
                    }
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
