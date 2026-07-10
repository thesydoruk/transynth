import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, voiceAudioUrl, type VoiceLinePreview } from '../../../../api';
import { Button } from '../../../../components/Button';
import { ModalShell } from '../../../../components/ModalShell';
import s from './VoiceModal.module.scss';

interface VoiceModalProps {
  modId: number;
  srcLang: string;
  targetLang: string;
  onClose: () => void;
}

const lineKey = (line: VoiceLinePreview): string => `${line.formidLower6}:${line.variant}`;

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
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [selectedSpeakerKey, setSelectedSpeakerKey] = useState<string | null>(null);
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['voice-lines', modId, srcLang, targetLang],
    queryFn: () => api.mods.voiceLines(modId, srcLang, targetLang),
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
    setPlayingKey(null);
    setLoadingKey(null);
  }, []);

  useEffect(() => () => stopPlayback(), [stopPlayback]);

  const handlePlay = useCallback(
    async (line: VoiceLinePreview) => {
      const key = lineKey(line);
      if (playingKey === key) {
        stopPlayback();
        return;
      }

      stopPlayback();
      setPlayError(null);
      setLoadingKey(key);

      const audio = audioRef.current ?? new Audio();
      audioRef.current = audio;

      const url = voiceAudioUrl(modId, line.formidLower6, line.variant);
      audio.src = url;

      const onCanPlay = () => {
        setLoadingKey(null);
        setPlayingKey(key);
        void audio.play().catch((err: unknown) => {
          setPlayError(err instanceof Error ? err.message : String(err));
          setPlayingKey(null);
        });
      };

      const onEnded = () => {
        setPlayingKey(null);
      };

      const onError = () => {
        setLoadingKey(null);
        setPlayingKey(null);
        setPlayError(t('modEditor.voicePlayError'));
      };

      audio.addEventListener('canplay', onCanPlay, { once: true });
      audio.addEventListener('ended', onEnded);
      audio.addEventListener('error', onError, { once: true });
      audio.load();
    },
    [modId, playingKey, stopPlayback, t],
  );

  const totalLines = data?.ok ? data.totalLines : 0;

  return (
    <ModalShell
      title={t('modEditor.voiceTitle')}
      onClose={onClose}
      closeAriaLabel={t('common.close')}
      size="2xl"
      stretchContent
    >
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
                      <span className={s.speakerName}>{group.displayName}</span>
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
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>{t('modEditor.voiceColId')}</th>
                    <th>{t('modEditor.voiceColSource')}</th>
                    <th>{t('modEditor.voiceColTranslation')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(selectedSpeaker?.lines ?? []).map((line) => {
                    const key = lineKey(line);
                    const isPlaying = playingKey === key;
                    const isLoading = loadingKey === key;
                    return (
                      <tr key={key}>
                        <td className={s.idCell}>
                          <code>
                            {line.infoFormidHex ?? `00${line.formidLower6}`}_{line.variant}
                          </code>
                        </td>
                        <td className={s.textCell}>{line.source ?? '—'}</td>
                        <td className={s.textCell}>{line.translation ?? '—'}</td>
                        <td className={s.playCell}>
                          <Button
                            variant={isPlaying ? 'primary' : 'secondary'}
                            size="sm"
                            onClick={() => void handlePlay(line)}
                            disabled={isLoading}
                            title={t('modEditor.voicePlayTitle')}
                          >
                            {isLoading
                              ? t('modEditor.voicePlayLoading')
                              : isPlaying
                                ? t('modEditor.voicePlayStop')
                                : t('modEditor.voicePlay')}
                          </Button>
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
    </ModalShell>
  );
};
