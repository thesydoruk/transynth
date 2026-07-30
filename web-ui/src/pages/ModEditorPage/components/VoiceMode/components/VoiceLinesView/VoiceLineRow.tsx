import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { VoiceLinePreview } from '../../../../../../api';
import { StatusBadge } from '../../../../../../components/StatusBadge';
import type { CommitAdvance } from '../../../DialogsMode/components/DialogLineRow/DialogLineRow';
import { playTrackKey, type PlayKind } from '../../voiceLineKeys';
import styles from './VoiceLineRow.module.scss';

export type { CommitAdvance };

export interface VoiceLineRowProps {
  line: VoiceLinePreview;
  focused: boolean;
  editing: boolean;
  saving: boolean;
  playingTrack: string | null;
  loadingTrack: string | null;
  setReferencePending: boolean;
  generatePending: boolean;
  regenerateOpen: boolean;
  onFocus: () => void;
  onEdit: () => void;
  onCancel: () => void;
  onCommit: (text: string, advance: CommitAdvance) => void;
  onPlay: (line: VoiceLinePreview, kind: PlayKind) => void;
  onSetReference: (line: VoiceLinePreview) => void;
  onGenerate: (line: VoiceLinePreview) => void;
  onRegenerate: (line: VoiceLinePreview) => void;
}

/** One voiced line: source text, inline-editable translation, playback, and synthesis. */
export const VoiceLineRow = ({
  line,
  focused,
  editing,
  saving,
  playingTrack,
  loadingTrack,
  setReferencePending,
  generatePending,
  regenerateOpen,
  onFocus,
  onEdit,
  onCancel,
  onCommit,
  onPlay,
  onSetReference,
  onGenerate,
  onRegenerate,
}: VoiceLineRowProps) => {
  const { t } = useTranslation();
  const rowRef = useRef<HTMLElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const cancelledRef = useRef(false);
  const [draft, setDraft] = useState(line.translation ?? '');

  const editable = line.stringId != null && !line.isOrphanAudio;
  // Orphan audio has no transcript to condition TTS on; keep the button only to unset a stale pick.
  const canBeReference = !line.isOrphanAudio || line.isReference;
  const sourceTrack = playTrackKey('source', line);
  const translationTrack = playTrackKey('translation', line);
  const canGenerate = line.canGenerateVoice ?? Boolean(line.translation?.trim());
  const hasTranslationAudio = Boolean(line.hasTranslationAudio);

  useEffect(() => {
    if (editing) {
      cancelledRef.current = false;
      setDraft(line.translation ?? '');
    }
  }, [editing, line.translation]);

  useEffect(() => {
    if (focused) rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [focused]);

  useEffect(() => {
    const area = areaRef.current;
    if (!editing || !area) return;
    area.style.height = 'auto';
    area.style.height = `${area.scrollHeight}px`;
  }, [editing, draft]);

  const commit = (advance: CommitAdvance) => {
    cancelledRef.current = advance !== 'none';
    onCommit(draft, advance);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && event.ctrlKey) {
      event.preventDefault();
      commit(event.shiftKey ? 'nextTodo' : 'next');
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancelledRef.current = true;
      onCancel();
    }
  };

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
    <article
      ref={rowRef}
      className={`${styles.row} ${line.isReference ? styles.reference : ''} ${focused ? styles.focused : ''} ${saving ? styles.saving : ''}`}
      onMouseDown={editable ? onFocus : undefined}
    >
      <div className={styles.meta}>
        <code className={styles.idCode}>
          {line.infoFormidHex ?? `00${line.formidLower6}`}_{line.variant}
        </code>
        {line.status && <StatusBadge status={line.status} small />}
        {line.isReference && (
          <span className={styles.refBadge}>{t('modEditor.voiceRefBadge')}</span>
        )}
        {line.isInheritedAudio && (
          <span className={styles.inheritedBadge} title={line.inheritedFrom ?? undefined}>
            {t('modEditor.voiceInheritedBadge')}
          </span>
        )}
        {line.isOrphanAudio && (
          <span className={styles.orphanBadge} title={t('modEditor.voiceOrphanTitle')}>
            {t('modEditor.voiceOrphanBadge')}
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
        {saving && <span className={styles.savingTag}>{t('dialogs.saving')}</span>}
        <div className={styles.actions}>
          {editable && (
            <button
              type="button"
              className={styles.action}
              onClick={() => onCommit('', 'none')}
              disabled={!line.translation}
              title={t('dialogs.clearTitle')}
            >
              {t('dialogs.clear')}
            </button>
          )}
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
          {canBeReference && (
            <button
              type="button"
              className={`${styles.action} ${line.isReference ? styles.actionActive : ''}`}
              onClick={() => onSetReference(line)}
              disabled={setReferencePending}
              title={
                line.isReference
                  ? t('modEditor.voiceRefClearTitle')
                  : t('modEditor.voiceRefSetTitle')
              }
            >
              {setReferencePending
                ? t('modEditor.voiceRefSaving')
                : line.isReference
                  ? t('modEditor.voiceRefClear')
                  : t('modEditor.voiceRefSet')}
            </button>
          )}
        </div>
      </div>

      <p className={styles.source}>{line.source ?? '—'}</p>

      {editable && editing ? (
        <textarea
          ref={areaRef}
          className={styles.textarea}
          value={draft}
          disabled={saving}
          autoFocus
          rows={1}
          placeholder={t('modEditor.enterTranslation')}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (!cancelledRef.current) commit('none');
          }}
        />
      ) : editable ? (
        <button
          type="button"
          className={`${styles.translation} ${line.translation ? '' : styles.empty}`}
          onClick={onEdit}
          title={t('dialogs.clickToEdit')}
        >
          {line.translation || t('dialogs.noTranslation')}
        </button>
      ) : (
        <p className={line.translation ? styles.translationReadOnly : styles.emptyTranslation}>
          {line.translation || t('dialogs.noTranslation')}
        </p>
      )}
    </article>
  );
};
