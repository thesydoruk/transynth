import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type VoiceLinePreview } from '../../../../../api';

export const voiceSpeakersQueryKey = (modId: number, srcLang: string, targetLang: string) =>
  ['voice-speakers', modId, srcLang, targetLang] as const;

export interface UseVoiceActionsParams {
  modId: number;
  srcLang: string;
  targetLang: string;
  speakersQueryKey: readonly unknown[];
  linesQueryKey: readonly unknown[];
  onGenerateSuccess: (line: VoiceLinePreview) => Promise<void>;
}

/** Mutations for reference picks and one-off voice generation. */
export const useVoiceActions = ({
  modId,
  srcLang,
  targetLang,
  speakersQueryKey,
  linesQueryKey,
  onGenerateSuccess,
}: UseVoiceActionsParams) => {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const invalidateVoice = async () => {
    await qc.invalidateQueries({ queryKey: speakersQueryKey });
    await qc.invalidateQueries({ queryKey: linesQueryKey });
  };

  const setReferenceMut = useMutation({
    mutationFn: async ({ speakerKey, line }: { speakerKey: string; line: VoiceLinePreview }) => {
      if (line.isReference) {
        return api.mods.clearVoiceSpeakerRef(modId, speakerKey);
      }
      return api.mods.setVoiceSpeakerRef(modId, speakerKey, line.formidLower6, line.variant);
    },
    onSuccess: () => void invalidateVoice(),
  });

  const generateMut = useMutation({
    mutationFn: (line: VoiceLinePreview) =>
      api.mods.generateVoiceLine(modId, line.formidLower6, line.variant, srcLang, targetLang),
    onSuccess: async (_result, line) => {
      await invalidateVoice();
      await onGenerateSuccess(line);
    },
  });

  const refError =
    setReferenceMut.error instanceof Error
      ? setReferenceMut.error.message
      : setReferenceMut.error
        ? t('modEditor.voiceRefError')
        : null;

  const generateError =
    generateMut.error instanceof Error
      ? generateMut.error.message
      : generateMut.error
        ? t('modEditor.voiceGenerateError')
        : null;

  return {
    setReferenceMut,
    generateMut,
    refError,
    generateError,
    dismissRefError: () => setReferenceMut.reset(),
    dismissGenerateError: () => generateMut.reset(),
  };
};
