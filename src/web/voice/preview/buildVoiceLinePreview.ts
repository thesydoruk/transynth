import type { VoiceFileEntry } from '../../../voice/discoverVoiceFiles';
import {
  lookupVoiceTranslation,
  normalizeVoiceText,
  voiceTranslationMapKey,
} from '../../../voice/loadVoiceTranslations';
import {
  formatInheritedFromLabel,
  lookupInheritedVoiceLine,
} from '../../../voice/inheritedVoiceText';
import { voiceSpeakerKey } from '../../../voice/speakerReference';
import { canSynthesizeVoiceLine } from '../../../voice/prepareVoiceTtsText';
import { voiceSpeakerRefMatches } from '../../../voice/voiceSpeakerRefs';
import { formatVoiceSpeakerLabel } from './voiceEntries';
import { hasTranslationAudio } from './translationAudioIndex';
import type { VoiceListContext } from './voiceListContext';
import type { VoiceLinePreview, VoiceSpeakerSummary } from './types';

export const resolveSpeakerKey = (entry: VoiceFileEntry, voiceRootRel: string): string =>
  voiceSpeakerKey(entry, voiceRootRel) || 'Unknown';

export const resolveSpeakerDisplayName = (
  speakerKey: string,
  formidLower6: string,
  dbSpeakerNames: Map<string, string>,
): string => dbSpeakerNames.get(formidLower6.toUpperCase()) || formatVoiceSpeakerLabel(speakerKey);

/**
 * True when no INFO record carries this FormID — neither in the mod nor in an
 * imported master. Bethesda ships such audio for lines cut after the voice
 * archives were built, so there is nothing to translate or dub.
 *
 * @param sourceFormids - {@link VoiceListContext.sourceFormids}
 */
export const isOrphanVoiceEntry = (sourceFormids: Set<string>, entry: VoiceFileEntry): boolean =>
  !sourceFormids.has(entry.formidLower6.toUpperCase());

export const buildVoiceLinePreview = (
  context: VoiceListContext,
  entry: VoiceFileEntry,
  speakerKey: string,
): VoiceLinePreview => {
  const mapKey = voiceTranslationMapKey(entry.formidLower6, entry.variant);
  const sourceRow = context.sources.get(mapKey);
  const translationRow = lookupVoiceTranslation(
    context.translations,
    entry.formidLower6,
    entry.variant,
  );
  const referencePick = context.speakerRefs[speakerKey] ?? null;
  const hasAudio = hasTranslationAudio(context.translationAudio, entry.formidLower6, entry.variant);
  const translationText = normalizeVoiceText(translationRow?.translation) ?? '';
  const localSource =
    normalizeVoiceText(sourceRow?.source) ?? normalizeVoiceText(translationRow?.source);

  let source = localSource;
  let translation = translationText || null;
  let infoFormidHex = sourceRow?.infoFormidHex ?? translationRow?.infoFormidHex ?? null;
  let isInheritedAudio = false;
  let inheritedFrom: string | null = null;
  let stringId = sourceRow?.stringId ?? translationRow?.stringId ?? null;
  let translationId = translationRow?.translationId ?? null;
  let status = translationRow?.status ?? null;

  if (!source && context.inheritedLookup) {
    const inherited = lookupInheritedVoiceLine(
      context.inheritedLookup,
      entry.formidLower6,
      entry.variant,
    );
    if (inherited) {
      source = inherited.source;
      translation = translation ?? inherited.translation;
      infoFormidHex = inherited.infoFormidHex || infoFormidHex;
      stringId = stringId ?? inherited.stringId;
      translationId = translationId ?? inherited.translationId;
      status = status ?? inherited.status;
      isInheritedAudio = true;
      inheritedFrom = formatInheritedFromLabel(inherited.master);
    }
  }

  const isOrphanAudio = isOrphanVoiceEntry(context.sourceFormids, entry);
  const synthesizable = canSynthesizeVoiceLine(source, translation ?? '', translationRow?.edid);

  return {
    formidLower6: entry.formidLower6,
    infoFormidHex,
    variant: entry.variant,
    fileName: entry.fileName,
    stringId: isOrphanAudio ? null : stringId,
    translationId,
    status,
    source,
    translation,
    isReference: referencePick
      ? voiceSpeakerRefMatches(referencePick, entry.formidLower6, entry.variant)
      : false,
    isInheritedAudio,
    inheritedFrom,
    isOrphanAudio,
    hasTranslationAudio: hasAudio,
    canGenerateVoice: synthesizable && !hasAudio,
  };
};

export const sortVoiceLines = (lines: VoiceLinePreview[]): VoiceLinePreview[] =>
  [...lines].sort((a, b) => {
    const formidCmp = a.formidLower6.localeCompare(b.formidLower6);
    return formidCmp !== 0 ? formidCmp : a.variant - b.variant;
  });

export const sortSpeakers = (speakers: VoiceSpeakerSummary[]): VoiceSpeakerSummary[] =>
  [...speakers].sort((a, b) =>
    a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }),
  );
