import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type VoiceLinePreview } from '../../../../api';
import { ModalShell } from '../../../../components/ModalShell';
import { VoiceLinesTable } from './components/VoiceLinesTable';
import { useSelectedSpeaker, VoiceSpeakerList } from './components/VoiceSpeakerList';
import { useVoicePlayback } from './hooks/useVoicePlayback';
import { VoiceRegenerateModal } from './VoiceRegenerateModal';
import s from './VoiceModal.module.scss';

interface VoiceModalProps {
  modId: number;
  srcLang: string;
  targetLang: string;
  onClose: () => void;
}

/** Modal listing voiced dialogue lines grouped by NPC, with lazy-cached playback. */
export const VoiceModal = ({ modId, srcLang, targetLang, onClose }: VoiceModalProps) => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [selectedSpeakerKey, setSelectedSpeakerKey] = useState<string | null>(null);
  const [refError, setRefError] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [regenerateLine, setRegenerateLine] = useState<VoiceLinePreview | null>(null);

  const voiceQueryKey = ['voice-lines', modId, srcLang, targetLang] as const;

  const { data, isLoading, error } = useQuery({
    queryKey: voiceQueryKey,
    queryFn: () => api.mods.voiceLines(modId, srcLang, targetLang),
  });

  const { playingTrack, loadingTrack, playError, handlePlay } = useVoicePlayback(modId);

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

  const speakers = data?.ok ? data.speakers : [];
  const selectedSpeaker = useSelectedSpeaker(speakers, selectedSpeakerKey, setSelectedSpeakerKey);
  const totalLines = data?.ok ? data.totalLines : 0;

  const handleSetReference = (line: VoiceLinePreview) => {
    if (!selectedSpeaker) return;
    setRefError(null);
    setReferenceMut.mutate({ speakerKey: selectedSpeaker.key, line });
  };

  const handleGenerate = (line: VoiceLinePreview) => {
    setGenerateError(null);
    generateMut.mutate(line);
  };

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
            <VoiceSpeakerList
              speakers={speakers}
              selectedSpeakerKey={selectedSpeakerKey}
              onSelectSpeaker={setSelectedSpeakerKey}
            />
            <VoiceLinesTable
              speaker={selectedSpeaker}
              playingTrack={playingTrack}
              loadingTrack={loadingTrack}
              regenerateLine={regenerateLine}
              setReferencePending={setReferenceMut.isPending}
              setReferenceLine={setReferenceMut.variables?.line}
              generatePending={generateMut.isPending}
              generateLine={generateMut.variables}
              onPlay={handlePlay}
              onSetReference={handleSetReference}
              onGenerate={handleGenerate}
              onRegenerate={setRegenerateLine}
            />
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
