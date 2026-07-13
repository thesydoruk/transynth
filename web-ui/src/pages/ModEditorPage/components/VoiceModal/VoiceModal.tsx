import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  api,
  voiceAudioUrl,
  voiceTranslationAudioUrl,
  type VoiceLinePreview,
} from '../../../../api';
import { Button } from '../../../../components/Button';
import { ModalShell } from '../../../../components/ModalShell';
import { VoiceRegenerateModal } from './VoiceRegenerateModal';
import s from './VoiceModal.module.scss';

interface VoiceModalProps {
  modId: number;
  srcLang: string;
  targetLang: string;
  onClose: () => void;
}

type PlayKind = 'source' | 'translation';

const lineKey = (line: VoiceLinePreview): string => `${line.formidLower6}:${line.variant}`;

const playTrackKey = (kind: PlayKind, line: VoiceLinePreview): string => `${kind}:${lineKey(line)}`;

const speakerHue = (key: string): number => {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = key.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
};

/** Modal listing voiced dialogue lines grouped by NPC, with lazy-cached playback. */
export const VoiceModal = ({ modId, srcLang, targetLang, onClose }: VoiceModalProps) => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [selectedSpeakerKey, setSelectedSpeakerKey] = useState<string | null>(null);
  const [playingTrack, setPlayingTrack] = useState<string | null>(null);
  const [loadingTrack, setLoadingTrack] = useState<string | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);
  const [refError, setRefError] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [regenerateLine, setRegenerateLine] = useState<VoiceLinePreview | null>(null);

  const voiceQueryKey = ['voice-lines', modId, srcLang, targetLang] as const;

  const { data, isLoading, error } = useQuery({
    queryKey: voiceQueryKey,
    queryFn: () => api.mods.voiceLines(modId, srcLang, targetLang),
  });

  const setReferenceMut = useMutation({
    mutationFn: async ({ speakerKey, line }: { speakerKey: string; line: VoiceLinePreview }) => {
      if (line.isReference) {
        return api.mods.clearVoiceSpeakerRef(modId, speakerKey);
      }
      return api.mods.setVoiceSpeakerRef(modId, speakerKey, line.formidLower6, line.variant);
    },
    onSuccess: () => {
      setRefError(null);
      void qc.invalidateQueries({ queryKey: voiceQueryKey });
    },
    onError: (err: unknown) => {
      setRefError(err instanceof Error ? err.message : t('modEditor.voiceRefError'));
    },
  });

  const speakers = data?.ok ? data.speakers : [];

  useEffect(() => {
    if (!selectedSpeakerKey && speakers.length > 0) {
      setSelectedSpeakerKey(speakers[0]!.key);
    }
  }, [selectedSpeakerKey, speakers]);

  const selectedSpeaker = useMemo(
    () => speakers.find((group) => group.key === selectedSpeakerKey) ?? null,
    [speakers, selectedSpeakerKey],
  );

  const stopPlayback = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    setPlayingTrack(null);
    setLoadingTrack(null);
  }, []);

  useEffect(() => () => stopPlayback(), [stopPlayback]);

  const handlePlay = useCallback(
    async (line: VoiceLinePreview, kind: PlayKind) => {
      const track = playTrackKey(kind, line);
      if (playingTrack === track) {
        stopPlayback();
        return;
      }

      stopPlayback();
      setPlayError(null);
      setLoadingTrack(track);

      const audio = audioRef.current ?? new Audio();
      audioRef.current = audio;

      const url =
        kind === 'source'
          ? voiceAudioUrl(modId, line.formidLower6, line.variant)
          : `${voiceTranslationAudioUrl(modId, line.formidLower6, line.variant)}?t=${Date.now()}`;

      audio.src = url;

      const onCanPlay = () => {
        setLoadingTrack(null);
        setPlayingTrack(track);
        void audio.play().catch((err: unknown) => {
          setPlayError(
            err instanceof Error
              ? err.message
              : kind === 'source'
                ? t('modEditor.voicePlayError')
                : t('modEditor.voicePlayTranslationError'),
          );
          setPlayingTrack(null);
        });
      };

      const onEnded = () => {
        setPlayingTrack(null);
      };

      const onError = () => {
        setLoadingTrack(null);
        setPlayingTrack(null);
        setPlayError(
          kind === 'source'
            ? t('modEditor.voicePlayError')
            : t('modEditor.voicePlayTranslationError'),
        );
      };

      audio.addEventListener('canplay', onCanPlay, { once: true });
      audio.addEventListener('ended', onEnded);
      audio.addEventListener('error', onError, { once: true });
      audio.load();
    },
    [modId, playingTrack, stopPlayback, t],
  );

  const generateMut = useMutation({
    mutationFn: (line: VoiceLinePreview) =>
      api.mods.generateVoiceLine(modId, line.formidLower6, line.variant, srcLang, targetLang),
    onSuccess: async (_result, line) => {
      setGenerateError(null);
      await qc.invalidateQueries({ queryKey: voiceQueryKey });
      await handlePlay(line, 'translation');
    },
    onError: (err: unknown) => {
      setGenerateError(err instanceof Error ? err.message : t('modEditor.voiceGenerateError'));
    },
  });

  const handleSetReference = (line: VoiceLinePreview) => {
    if (!selectedSpeaker) return;
    setRefError(null);
    setReferenceMut.mutate({ speakerKey: selectedSpeaker.key, line });
  };

  const handleGenerate = (line: VoiceLinePreview) => {
    setGenerateError(null);
    generateMut.mutate(line);
  };

  const totalLines = data?.ok ? data.totalLines : 0;

  return (
    <ModalShell
      title={t('modEditor.voiceTitle')}
      onClose={onClose}
      closeAriaLabel={t('common.close')}
      size="2xl"
      stretchContent
    >
      <div className={s.body}>
        <p className={s.intro}>
          {t('modEditor.voiceIntro', {
            src: srcLang.toUpperCase(),
            target: targetLang.toUpperCase(),
            count: totalLines,
          })}
        </p>

        {isLoading && <p className={s.status}>{t('modEditor.voiceLoading')}</p>}
        {error && (
          <p className={s.error}>
            {error instanceof Error ? error.message : t('modEditor.voiceLoadError')}
          </p>
        )}
        {data && !data.ok && <p className={s.error}>{data.message}</p>}
        {playError && <p className={s.error}>{playError}</p>}
        {refError && <p className={s.error}>{refError}</p>}
        {generateError && <p className={s.error}>{generateError}</p>}

        {speakers.length > 0 && (
          <div className={s.layout}>
            <aside className={s.speakerList}>
              <h3 className={s.sectionTitle}>{t('modEditor.voiceSpeakers')}</h3>
              <ul className={s.speakerItems}>
                {speakers.map((group) => {
                  const hue = speakerHue(group.key);
                  const active = group.key === selectedSpeakerKey;
                  return (
                    <li key={group.key}>
                      <button
                        type="button"
                        className={`${s.speakerBtn} ${active ? s.speakerBtnActive : ''}`}
                        style={{ '--speaker-hue': hue } as CSSProperties}
                        onClick={() => setSelectedSpeakerKey(group.key)}
                      >
                        <span className={s.speakerName}>
                          {group.referencePick && (
                            <span className={s.speakerRefMark} title={t('modEditor.voiceRefSet')}>
                              ★
                            </span>
                          )}
                          {group.displayName}
                        </span>
                        <span className={s.speakerCount}>{group.lines.length}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </aside>

            <section className={s.linesPanel}>
              <h3 className={s.sectionTitle}>
                {selectedSpeaker
                  ? t('modEditor.voiceLinesFor', { speaker: selectedSpeaker.displayName })
                  : t('modEditor.voiceLines')}
              </h3>
              {selectedSpeaker?.referencePick ? (
                <p className={s.refHint}>{t('modEditor.voiceRefHint')}</p>
              ) : (
                <p className={s.refHint}>{t('modEditor.voiceRefHintEmpty')}</p>
              )}
              <div className={s.tableWrap}>
                <table className={s.table}>
                  <thead>
                    <tr>
                      <th>{t('modEditor.voiceColId')}</th>
                      <th>{t('modEditor.voiceColSource')}</th>
                      <th>{t('modEditor.voiceColTranslation')}</th>
                      <th>{t('modEditor.voiceColActions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedSpeaker?.lines ?? []).map((line) => {
                      const key = lineKey(line);
                      const sourceTrack = playTrackKey('source', line);
                      const translationTrack = playTrackKey('translation', line);
                      const isSourcePlaying = playingTrack === sourceTrack;
                      const isTranslationPlaying = playingTrack === translationTrack;
                      const isSourceLoading = loadingTrack === sourceTrack;
                      const isTranslationLoading = loadingTrack === translationTrack;
                      const isRefSaving =
                        setReferenceMut.isPending &&
                        setReferenceMut.variables?.line.formidLower6 === line.formidLower6 &&
                        setReferenceMut.variables?.line.variant === line.variant;
                      const isGenerating =
                        generateMut.isPending &&
                        generateMut.variables?.formidLower6 === line.formidLower6 &&
                        generateMut.variables?.variant === line.variant;
                      const canGenerate =
                        line.canGenerateVoice ?? Boolean(line.translation?.trim());
                      const hasTranslationAudio = Boolean(line.hasTranslationAudio);

                      return (
                        <tr key={key} className={line.isReference ? s.referenceRow : undefined}>
                          <td className={s.idCell}>
                            <code>
                              {line.infoFormidHex ?? `00${line.formidLower6}`}_{line.variant}
                            </code>
                            {line.isReference && (
                              <span className={s.refBadge}>{t('modEditor.voiceRefBadge')}</span>
                            )}
                            {line.isInheritedAudio && (
                              <span
                                className={s.inheritedBadge}
                                title={line.inheritedFrom ?? undefined}
                              >
                                {t('modEditor.voiceInheritedBadge')}
                              </span>
                            )}
                          </td>
                          <td className={s.textCell}>{line.source ?? '—'}</td>
                          <td className={s.textCell}>{line.translation ?? '—'}</td>
                          <td className={s.playCell}>
                            <div className={s.actionGroup}>
                              <Button
                                variant={isSourcePlaying ? 'primary' : 'secondary'}
                                size="sm"
                                onClick={() => void handlePlay(line, 'source')}
                                disabled={isSourceLoading}
                                title={t('modEditor.voicePlayTitle')}
                                aria-label={t('modEditor.voicePlayTitle')}
                              >
                                <span className={s.iconBtnGlyph} aria-hidden>
                                  {isSourceLoading
                                    ? t('modEditor.voicePlayLoading')
                                    : isSourcePlaying
                                      ? t('modEditor.voicePlayStop')
                                      : t('modEditor.voicePlay')}
                                </span>
                              </Button>
                              {hasTranslationAudio ? (
                                <>
                                  <Button
                                    variant={isTranslationPlaying ? 'primary' : 'secondary'}
                                    size="sm"
                                    onClick={() => void handlePlay(line, 'translation')}
                                    disabled={isTranslationLoading}
                                    title={t('modEditor.voicePlayTranslationTitle')}
                                    aria-label={t('modEditor.voicePlayTranslationTitle')}
                                  >
                                    <span
                                      className={`${s.iconBtnGlyph} ${s.translationBtn}`}
                                      aria-hidden
                                    >
                                      {isTranslationLoading
                                        ? t('modEditor.voicePlayLoading')
                                        : isTranslationPlaying
                                          ? t('modEditor.voicePlayTranslationStop')
                                          : t('modEditor.voicePlayTranslation')}
                                    </span>
                                  </Button>
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => setRegenerateLine(line)}
                                    disabled={
                                      !Boolean(line.translation?.trim()) || Boolean(regenerateLine)
                                    }
                                    title={t('modEditor.voiceRegenerateTitle')}
                                    aria-label={t('modEditor.voiceRegenerateTitle')}
                                  >
                                    <span
                                      className={`${s.iconBtnGlyph} ${s.regenerateBtn}`}
                                      aria-hidden
                                    >
                                      {t('modEditor.voiceRegenerate')}
                                    </span>
                                  </Button>
                                </>
                              ) : (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => handleGenerate(line)}
                                  disabled={!canGenerate || generateMut.isPending}
                                  title={
                                    canGenerate
                                      ? t('modEditor.voiceGenerateTitle')
                                      : t('modEditor.voiceGenerateNeedsTranslation')
                                  }
                                  aria-label={
                                    canGenerate
                                      ? t('modEditor.voiceGenerateTitle')
                                      : t('modEditor.voiceGenerateNeedsTranslation')
                                  }
                                >
                                  <span
                                    className={`${s.iconBtnGlyph} ${s.generateBtn}`}
                                    aria-hidden
                                  >
                                    {isGenerating
                                      ? t('modEditor.voiceGenerating')
                                      : t('modEditor.voiceGenerate')}
                                  </span>
                                </Button>
                              )}
                              <Button
                                variant={line.isReference ? 'primary' : 'secondary'}
                                size="sm"
                                onClick={() => handleSetReference(line)}
                                disabled={setReferenceMut.isPending}
                                title={
                                  line.isReference
                                    ? t('modEditor.voiceRefClearTitle')
                                    : t('modEditor.voiceRefSetTitle')
                                }
                                aria-label={
                                  line.isReference
                                    ? t('modEditor.voiceRefClearTitle')
                                    : t('modEditor.voiceRefSetTitle')
                                }
                              >
                                <span
                                  className={`${s.iconBtnGlyph} ${line.isReference ? s.iconBtnGlyphActive : ''}`}
                                  aria-hidden
                                >
                                  {isRefSaving
                                    ? t('modEditor.voiceRefSaving')
                                    : line.isReference
                                      ? '★'
                                      : '☆'}
                                </span>
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {data?.ok && speakers.length === 0 && (
          <p className={s.status}>{t('modEditor.voiceNoLines')}</p>
        )}
      </div>

      {regenerateLine && (
        <VoiceRegenerateModal
          modId={modId}
          line={regenerateLine}
          srcLang={srcLang}
          targetLang={targetLang}
          hasCurrentTranslation={Boolean(regenerateLine.hasTranslationAudio)}
          onClose={() => setRegenerateLine(null)}
          onCommitted={async () => {
            setRegenerateLine(null);
            await qc.invalidateQueries({ queryKey: voiceQueryKey });
          }}
        />
      )}
    </ModalShell>
  );
};
