import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  api,
  voiceAudioUrl,
  voiceRegeneratePreviewUrl,
  voiceTranslationAudioUrl,
  type VoiceLinePreview,
  type VoiceRegenerateParams,
  type VoiceRegeneratePreview,
} from '../../../../api';
import { Button } from '../../../../components/Button';
import { ModalShell } from '../../../../components/ModalShell';
import { VoiceRegenerateParamsForm } from '../../../SettingsPage/VoiceTab/VoiceRegenerateParamsForm';
import { VOICE_REGENERATE_KEEP_CURRENT_ID } from '../../../SettingsPage/VoiceTab/voiceSettingsConfig';
import s from './VoiceRegenerateModal.module.scss';

type VoiceRegenerateModalProps = {
  modId: number;
  line: VoiceLinePreview;
  srcLang: string;
  targetLang: string;
  hasCurrentTranslation: boolean;
  onClose: () => void;
  onCommitted: () => void;
};

type CompareTrack =
  | { kind: 'source' }
  | { kind: 'current' }
  | { kind: 'preview'; preview: VoiceRegeneratePreview };

const compareTrackKey = (track: CompareTrack): string => {
  if (track.kind === 'source') return 'source';
  if (track.kind === 'current') return 'current';
  return `preview:${track.preview.id}`;
};

/** Modal for regenerating one voice line with parameter tuning and A/B comparison. */
export const VoiceRegenerateModal = ({
  modId,
  line,
  srcLang,
  targetLang,
  hasCurrentTranslation,
  onClose,
  onCommitted,
}: VoiceRegenerateModalProps) => {
  const { t } = useTranslation();
  const sessionId = useMemo(() => crypto.randomUUID(), []);
  const [params, setParams] = useState<VoiceRegenerateParams | null>(null);
  const [previews, setPreviews] = useState<VoiceRegeneratePreview[]>([]);
  const [selectedId, setSelectedId] = useState<string>(
    hasCurrentTranslation ? VOICE_REGENERATE_KEEP_CURRENT_ID : '',
  );
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playingTrack, setPlayingTrack] = useState<string | null>(null);
  const [loadingTrack, setLoadingTrack] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const compareGroupName = useId();

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

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await api.mods.initVoiceRegenerateSession(
          modId,
          line.formidLower6,
          line.variant,
          sessionId,
          srcLang,
          targetLang,
        );
        if (cancelled) return;
        setParams(result.defaultParams);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t('modEditor.voiceRegenerateInitError'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void init();
    return () => {
      cancelled = true;
    };
  }, [line.formidLower6, line.variant, modId, sessionId, srcLang, targetLang, t]);

  const discardSession = useCallback(async () => {
    try {
      await api.mods.discardVoiceRegenerate(modId, sessionId);
    } catch {
      // Best-effort cleanup when closing without commit.
    }
  }, [modId, sessionId]);

  const handleClose = useCallback(() => {
    stopPlayback();
    void discardSession();
    onClose();
  }, [discardSession, onClose, stopPlayback]);

  const handleGenerate = async () => {
    if (!params) return;
    setGenerating(true);
    setError(null);
    try {
      const result = await api.mods.generateVoiceRegeneratePreview(modId, sessionId, {
        formidLower6: line.formidLower6,
        variant: line.variant,
        srcLang,
        targetLang,
        params,
      });
      const preview: VoiceRegeneratePreview = {
        id: result.previewId,
        attempt: result.attempt,
        createdAt: new Date().toISOString(),
        audioUrl: result.audioUrl,
        params: result.params,
      };
      setPreviews((current) => [...current, preview]);
      setSelectedId(preview.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('modEditor.voiceRegenerateGenerateError'));
    } finally {
      setGenerating(false);
    }
  };

  const handlePlay = useCallback(
    async (track: CompareTrack) => {
      const trackKey = compareTrackKey(track);
      if (playingTrack === trackKey) {
        stopPlayback();
        return;
      }

      stopPlayback();
      setError(null);
      setLoadingTrack(trackKey);

      const audio = audioRef.current ?? new Audio();
      audioRef.current = audio;

      const url =
        track.kind === 'source'
          ? voiceAudioUrl(modId, line.formidLower6, line.variant)
          : track.kind === 'current'
            ? `${voiceTranslationAudioUrl(modId, line.formidLower6, line.variant)}?t=${Date.now()}`
            : `${voiceRegeneratePreviewUrl(modId, sessionId, track.preview.id)}?t=${Date.now()}`;

      audio.src = url;

      const onCanPlay = () => {
        setLoadingTrack(null);
        setPlayingTrack(trackKey);
        void audio.play().catch((err: unknown) => {
          setError(err instanceof Error ? err.message : t('modEditor.voicePlayError'));
          setPlayingTrack(null);
        });
      };

      const onEnded = () => setPlayingTrack(null);
      const onAudioError = () => {
        setLoadingTrack(null);
        setPlayingTrack(null);
        setError(t('modEditor.voicePlayError'));
      };

      audio.addEventListener('canplay', onCanPlay, { once: true });
      audio.addEventListener('ended', onEnded);
      audio.addEventListener('error', onAudioError, { once: true });
      audio.load();
    },
    [line.formidLower6, line.variant, modId, playingTrack, sessionId, stopPlayback, t],
  );

  const handleCommit = async () => {
    if (!selectedId) {
      setError(t('modEditor.voiceRegenerateSelectError'));
      return;
    }
    setCommitting(true);
    setError(null);
    try {
      await api.mods.commitVoiceRegenerate(modId, sessionId, selectedId);
      stopPlayback();
      onCommitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('modEditor.voiceRegenerateCommitError'));
    } finally {
      setCommitting(false);
    }
  };

  const compareTracks: CompareTrack[] = useMemo(() => {
    const tracks: CompareTrack[] = [{ kind: 'source' }];
    if (hasCurrentTranslation) tracks.push({ kind: 'current' });
    for (const preview of previews) tracks.push({ kind: 'preview', preview });
    return tracks;
  }, [hasCurrentTranslation, previews]);

  const lineLabel = line.infoFormidHex ?? `00${line.formidLower6}_${line.variant}`;

  return (
    <div className={s.overlay}>
      <ModalShell
        title={t('modEditor.voiceRegenerateTitle')}
        onClose={handleClose}
        closeAriaLabel={t('common.cancel')}
        size="xl"
        stretchContent
        closeDisabled={committing || generating}
      >
        <div className={s.body}>
          <div className={s.scroll}>
            <p className={s.lineMeta}>
              <strong>{lineLabel}</strong>
              <br />
              {line.translation ?? '—'}
            </p>

            {loading && <p className={s.status}>{t('common.loading')}</p>}
            {error && <p className={s.error}>{error}</p>}

            {params && (
              <>
                <div className={s.section}>
                  <h3 className={s.sectionTitle}>{t('modEditor.voiceRegenerateParamsTitle')}</h3>
                  <VoiceRegenerateParamsForm
                    params={params}
                    onChange={setParams}
                    disabled={generating || committing}
                  />
                  <Button
                    variant="secondary"
                    onClick={() => void handleGenerate()}
                    disabled={generating || committing}
                  >
                    {generating
                      ? t('modEditor.voiceRegenerateGenerating')
                      : t('modEditor.voiceRegenerateGenerate')}
                  </Button>
                </div>

                <div className={s.section}>
                  <h3 className={s.sectionTitle}>{t('modEditor.voiceRegenerateCompareTitle')}</h3>
                  <ul className={s.compareList}>
                    {compareTracks.map((track) => {
                      const trackKey = compareTrackKey(track);
                      const selectableId =
                        track.kind === 'source'
                          ? null
                          : track.kind === 'current'
                            ? VOICE_REGENERATE_KEEP_CURRENT_ID
                            : track.preview.id;
                      const isSelected = selectableId != null && selectedId === selectableId;
                      const isPlaying = playingTrack === trackKey;
                      const isLoading = loadingTrack === trackKey;
                      const title =
                        track.kind === 'source'
                          ? t('modEditor.voiceRegenerateSource')
                          : track.kind === 'current'
                            ? t('modEditor.voiceRegenerateCurrent')
                            : t('modEditor.voiceRegenerateAttempt', { n: track.preview.attempt });

                      return (
                        <li
                          key={trackKey}
                          className={`${s.compareItem} ${isSelected ? s.compareItemSelected : ''}`}
                        >
                          {selectableId ? (
                            <input
                              type="radio"
                              name={compareGroupName}
                              checked={isSelected}
                              disabled={committing}
                              onChange={() => setSelectedId(selectableId)}
                              aria-label={title}
                            />
                          ) : (
                            <span aria-hidden="true">•</span>
                          )}
                          <div className={s.compareLabel}>
                            <span className={s.compareTitle}>{title}</span>
                            {track.kind === 'preview' && (
                              <span className={s.compareMeta}>
                                {t('modEditor.voiceRegenerateAttemptMeta', {
                                  backend: track.preview.params.backend,
                                  temperature: track.preview.params.temperature,
                                })}
                              </span>
                            )}
                          </div>
                          <Button
                            variant={isPlaying ? 'primary' : 'secondary'}
                            size="sm"
                            onClick={() => void handlePlay(track)}
                            disabled={isLoading || committing}
                          >
                            {isLoading
                              ? t('modEditor.voicePlayLoading')
                              : isPlaying
                                ? t('modEditor.voicePlayStop')
                                : t('modEditor.voicePlay')}
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </>
            )}
          </div>

          {params && (
            <div className={s.footer}>
              <Button variant="secondary" onClick={handleClose} disabled={committing || generating}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="primary"
                onClick={() => void handleCommit()}
                disabled={committing || generating || !selectedId}
              >
                {committing ? t('modEditor.voiceRegenerateCommitting') : t('common.ok')}
              </Button>
            </div>
          )}
        </div>
      </ModalShell>
    </div>
  );
};
