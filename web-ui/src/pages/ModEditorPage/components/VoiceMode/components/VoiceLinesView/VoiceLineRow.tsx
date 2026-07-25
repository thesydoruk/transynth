import { useTranslation } from 'react-i18next';
import type { VoiceLinePreview } from '../../../../../../api';
import { playTrackKey, type PlayKind } from '../../voiceLineKeys';
import styles from './VoiceLineRow.module.scss';

export interface VoiceLineRowProps {
  line: VoiceLinePreview;
  playingTrack: string | null;
  loadingTrack: string | null;
  setReferencePending: boolean;
  generatePending: boolean;
  regenerateOpen: boolean;
  onPlay: (line: VoiceLinePreview, kind: PlayKind) => void;
  onSetReference: (line: VoiceLinePreview) => void;
  onGenerate: (line: VoiceLinePreview) => void;
  onRegenerate: (line: VoiceLinePreview) => void;
}

/** One voiced line: text, playback controls, and synthesis actions. */
export const VoiceLineRow = ({
  line,
  playingTrack,
  loadingTrack,
  setReferencePending,
  generatePending,
  regenerateOpen,
  onPlay,
  onSetReference,
  onGenerate,
  onRegenerate,
}: VoiceLineRowProps) => {
  const { t } = useTranslation();

  const sourceTrack = playTrackKey('source', line);
  const translationTrack = playTrackKey('translation', line);
  const canGenerate = line.canGenerateVoice ?? Boolean(line.translation?.trim());
  const hasTranslationAudio = Boolean(line.hasTranslationAudio);

  const voiceButton = (kind: PlayKind, label: string, title: string, visible: boolean) => {
    if (!visible) return null;
    const track = kind === 'source' ? sourceTrack : translationTrack;
    const playing = playingTrack === track;
    const loading = loadingTrack === track;

    return (
      <button
        type="button"
        className={`${styles.voiceButton} ${playing ? styles.voicePlaying : ''}`}
        onClick={() => void onPlay(line, kind)}
        disabled={loading}
        title={playing ? t('dialogs.stopPlayback') : title}
        aria-label={playing ? t('dialogs.stopPlayback') : title}
      >
        <span className={styles.voiceGlyph} aria-hidden>
          {loading ? '⋯' : playing ? '■' : '▶'}
        </span>
        {label}
      </button>
    );
  };

  return (
    <article className={`${styles.row} ${line.isReference ? styles.reference : ''}`}>
      <div className={styles.meta}>
        <code className={styles.idCode}>
          {line.infoFormidHex ?? `00${line.formidLower6}`}_{line.variant}
        </code>
        {line.isReference && (
          <span className={styles.refBadge}>{t('modEditor.voiceRefBadge')}</span>
        )}
        {line.isInheritedAudio && (
          <span className={styles.inheritedBadge} title={line.inheritedFrom ?? undefined}>
            {t('modEditor.voiceInheritedBadge')}
          </span>
        )}
        <div className={styles.voice}>
          {voiceButton('source', t('dialogs.playSource'), t('modEditor.voicePlayTitle'), true)}
          {voiceButton(
            'translation',
            t('dialogs.playTranslation'),
            t('modEditor.voicePlayTranslationTitle'),
            hasTranslationAudio,
          )}
        </div>
        <span className={styles.spacer} />
        <div className={styles.actions}>
          {hasTranslationAudio ? (
            <button
              type="button"
              className={styles.action}
              onClick={() => onRegenerate(line)}
              disabled={!line.translation?.trim() || regenerateOpen}
              title={t('modEditor.voiceRegenerateTitle')}
            >
              {t('voice.regenerateBtn')}
            </button>
          ) : (
            <button
              type="button"
              className={styles.action}
              onClick={() => onGenerate(line)}
              disabled={!canGenerate || generatePending}
              title={
                canGenerate
                  ? t('modEditor.voiceGenerateTitle')
                  : t('modEditor.voiceGenerateNeedsTranslation')
              }
            >
              {generatePending ? t('modEditor.voiceGenerating') : t('modEditor.voiceGenerateBtn')}
            </button>
          )}
          <button
            type="button"
            className={`${styles.action} ${line.isReference ? styles.actionActive : ''}`}
            onClick={() => onSetReference(line)}
            disabled={setReferencePending}
            title={
              line.isReference ? t('modEditor.voiceRefClearTitle') : t('modEditor.voiceRefSetTitle')
            }
          >
            {setReferencePending
              ? t('modEditor.voiceRefSaving')
              : line.isReference
                ? t('modEditor.voiceRefClear')
                : t('modEditor.voiceRefSet')}
          </button>
        </div>
      </div>

      <p className={styles.source}>{line.source ?? '—'}</p>
      <p className={line.translation ? styles.translation : styles.emptyTranslation}>
        {line.translation || t('dialogs.noTranslation')}
      </p>
    </article>
  );
};
