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

/**
 * Does switching tags off need a question first? A take made with a tag carries
 * it in its stamp, so with the switch off it reads as stale. Only when the game
 * is known to have no voiced line with a tag is there nothing to lose.
 */
export const effortTagsOffNeedsConfirm = (summary: VoiceEffortGameSummary | undefined): boolean =>
  !summary || summary.synthesizedTaggedTakes > 0;

/**
 * What turning the switch off will do. The count is an upper bound: it is the
 * voiced lines with a tag, some of which may never have been re-made with it.
 */
export const effortTagsOffConfirmMessage = (
  t: TFunction,
  summary: VoiceEffortGameSummary | undefined,
): string =>
  summary
    ? t('settings.voice.effortTagsOffConfirm', { count: summary.synthesizedTaggedTakes })
    : t('settings.voice.effortTagsOffConfirmUnknown');
