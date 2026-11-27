import type { TFunction } from 'i18next';
import type { VoiceEffortGameSummary } from '../../../api';

/** The line under the effort-tags switch: what analysis found for the game so far. */
export const effortTagsHint = (t: TFunction, summary: VoiceEffortGameSummary): string =>
  t('settings.voice.effortTagsSummary', {
    mods: summary.analyzedMods,
    tagged: summary.taggedTakes,
    synthesized: summary.synthesizedTaggedTakes,
  });

/**
 * What turning the switch on will do: which takes go stale, or that nothing
 * changes yet. Without a summary (still loading, or the request failed) it
 * says what happens in general.
 */
export const effortTagsConfirmMessage = (
  t: TFunction,
  summary: VoiceEffortGameSummary | undefined,
): string => {
  if (!summary) return t('settings.voice.effortTagsConfirmUnknown');
  if (summary.analyzedMods === 0) return t('settings.voice.effortTagsConfirmNotAnalyzed');
  if (summary.synthesizedTaggedTakes === 0) {
    return t('settings.voice.effortTagsConfirmNoneStale', { tagged: summary.taggedTakes });
  }
  return t('settings.voice.effortTagsConfirmStale', { count: summary.synthesizedTaggedTakes });
};
