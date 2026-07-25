import { useTranslation } from 'react-i18next';
import type { VoiceLinePreview } from '../../../../../../api';
import type { PlayKind } from '../../voiceLineKeys';
import type { VoiceLineFilter } from '../../hooks/useVoiceState';
import { VoiceLineRow } from './VoiceLineRow';
import { VoiceLinesHeader } from './VoiceLinesHeader';
import styles from './VoiceLinesView.module.scss';

export interface VoiceLinesViewProps {
  speakerName: string;
  dubbed: number;
  total: number;
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
}

/** Right column: header filters and the stream of voice lines. */
export const VoiceLinesView = ({
  speakerName,
  dubbed,
  total,
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
}: VoiceLinesViewProps) => {
  const { t } = useTranslation();

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
        hasReference={hasReference}
        filter={filter}
        onFilterChange={onFilterChange}
        counts={counts}
        find={find}
        onFindChange={onFindChange}
        hiddenLineCount={hiddenLineCount}
        error={error}
        onDismissError={onDismissError}
      />

      <div className={styles.stream}>
        {lines.length === 0 ? (
          <p className={styles.placeholder}>{t('voice.noLinesMatch')}</p>
        ) : (
          lines.map((line) => (
            <VoiceLineRow
              key={`${line.formidLower6}:${line.variant}`}
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
          ))
        )}
      </div>

      <footer className={styles.hints}>{t('voice.hotkeyHint')}</footer>
    </section>
  );
};
