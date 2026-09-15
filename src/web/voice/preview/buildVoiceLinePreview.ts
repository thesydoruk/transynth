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
import {
  canSynthesizeVoiceLine,
  resolveVoiceLineSkipReason,
} from '../../../voice/prepareVoiceTtsText';
import { voiceSpeakerRefMatches } from '../../../voice/voiceSpeakerRefs';
import { lookupVoiceSimilarity } from '../../../voice/voiceSynthesisState';
import type { VoiceLineCatalog } from '../../../voice/lineCatalog';
import type { VoiceLinePreview, VoiceSpeakerSummary } from './types';

/**
 * True when no INFO record carries this FormID — neither in the mod nor in an
 * imported master. Bethesda ships such audio for lines cut after the voice
 * archives were built, so there is nothing to translate or dub.
 *
 * @param sourceFormids - {@link VoiceLineCatalog.sourceFormids}
 */
export const isOrphanVoiceEntry = (sourceFormids: Set<string>, entry: VoiceFileEntry): boolean =>
  !sourceFormids.has(entry.lineKey.toUpperCase());

export const buildVoiceLinePreview = (
  context: VoiceLineCatalog,
  entry: VoiceFileEntry,
  speakerKey: string,
): VoiceLinePreview => {
  const mapKey = voiceTranslationMapKey(entry.lineKey, entry.variant);
  const sourceRow = context.sources.get(mapKey);
  const translationRow = lookupVoiceTranslation(context.translations, entry.lineKey, entry.variant);
  const referencePick = context.speakerRefs[speakerKey] ?? null;
  const hasAudio = context.hasLocalizedTake(entry);
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
      entry.lineKey,
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
  const ttsSkipReason = resolveVoiceLineSkipReason(
    source,
    translation ?? '',
    translationRow?.edid,
    context.markupStyle,
  );
  const synthesizable = canSynthesizeVoiceLine(
    source,
    translation ?? '',
    translationRow?.edid,
    context.markupStyle,
  );

  return {
    lineKey: entry.lineKey,
    infoFormidHex,
    variant: entry.variant,
    fileName: entry.fileName,
    speakerKey,
    stringId: isOrphanAudio ? null : stringId,
    translationId,
    status,
    source,
    translation,
    isReference: referencePick
      ? voiceSpeakerRefMatches(referencePick, entry.lineKey, entry.variant)
      : false,
    isInheritedAudio,
    inheritedFrom,
    isOrphanAudio,
    hasTranslationAudio: hasAudio,
    canGenerateVoice: synthesizable && !hasAudio,
    ttsSkipReason,
    voiceSimilarity: hasAudio
      ? lookupVoiceSimilarity(context.voiceSimilarities, speakerKey, entry.lineKey, entry.variant)
      : null,
  };
};

export const sortVoiceLines = (lines: VoiceLinePreview[]): VoiceLinePreview[] =>
  [...lines].sort((a, b) => {
    const formidCmp = a.lineKey.localeCompare(b.lineKey);
    return formidCmp !== 0 ? formidCmp : a.variant - b.variant;
  });

export const sortSpeakers = (speakers: VoiceSpeakerSummary[]): VoiceSpeakerSummary[] =>
  [...speakers].sort((a, b) =>
    a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }),
  );
