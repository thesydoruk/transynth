import { useTranslation } from 'react-i18next';
import type { useVoiceData } from './useVoiceData';

type VoiceData = ReturnType<typeof useVoiceData>;

/**
 * What the lines panel says when it has nothing to show: the first load error
 * among the queries and the actions, and the empty-state line while the
 * speakers load, when the mod has none, or before one is picked.
 */
export const useVoiceMessages = (
  data: VoiceData,
  errors: ReadonlyArray<string | null | undefined>,
): { panelError: string | null; emptyMessage: string | null } => {
  const { t } = useTranslation();
  const speakersError = data.speakersQuery.error;
  const linesError = data.linesQuery.error;
  const loadError =
    speakersError instanceof Error
      ? speakersError.message
      : data.speakersQuery.data && !data.speakersQuery.data.ok
        ? data.speakersQuery.data.message
        : linesError instanceof Error
          ? linesError.message
          : data.linesQuery.data && !data.linesQuery.data.ok
            ? data.linesQuery.data.message
            : null;
  const panelError = loadError ?? errors.find((error) => error != null) ?? null;

  const emptyMessage =
    data.speakersQuery.isLoading || !data.speakersQuery.data
      ? t('modEditor.voiceLoading')
      : data.speakersQuery.data.ok && data.speakers.length === 0
        ? t('modEditor.voiceNoLines')
        : !data.activeSpeaker
          ? t('voice.selectSpeaker')
          : null;

  return { panelError, emptyMessage };
};
