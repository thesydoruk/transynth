import type { Tx } from '../db';
import type { VoiceFileEntry } from './discoverVoiceFiles';
import {
  decideVoiceReferenceSource,
  isLineReferenceSuitable,
  isLineReferenceTooLong,
} from './decideVoiceReferenceSource';
import { lookupVoiceSource, type VoiceSourceRow } from './loadVoiceTranslations';
import {
  isManualVoiceReferencePick,
  resolveSpeakerReferenceForSpeaker,
  voiceReferenceEligibilityFromSources,
  type ResolvedSpeakerReference,
} from './speakerReference';
import type { TtsReferenceMode } from './voiceToolPaths';

export type SpeakerRefCacheEntry = {
  wavPath: string;
  referenceText: string | null;
};

export type PickedVoiceTtsReference = {
  wavPath: string;
  referenceText: string | null;
};

const referenceTextForPick = (
  sources: Map<string, VoiceSourceRow>,
  pick: ResolvedSpeakerReference['pick'],
): string | null => {
  if (isManualVoiceReferencePick(pick)) return null;
  return lookupVoiceSource(sources, pick.formidLower6, pick.variant);
};

/** Line clip, or the speaker's default reference when the line is unusable/too long. */
export const pickVoiceTtsReference = async (input: {
  db: Tx;
  modId: number;
  packageDir: string;
  pluginRelPath: string;
  speakerKey: string | null;
  entry: VoiceFileEntry;
  lineEnglishWav: string;
  lineSource: string;
  referenceMode: TtsReferenceMode;
  voiceSources: Map<string, VoiceSourceRow>;
  getSiblingEntries: (speakerKey: string) => VoiceFileEntry[];
  speakerRefCache?: Map<string, SpeakerRefCacheEntry>;
}): Promise<PickedVoiceTtsReference> => {
  const {
    db,
    modId,
    packageDir,
    pluginRelPath,
    speakerKey,
    entry,
    lineEnglishWav,
    lineSource,
    referenceMode,
    voiceSources,
    getSiblingEntries,
    speakerRefCache,
  } = input;

  const lineTooLong = isLineReferenceTooLong(lineEnglishWav);
  const decision = decideVoiceReferenceSource(
    referenceMode,
    isLineReferenceSuitable(lineEnglishWav),
    lineTooLong,
  );

  let referenceWav: string | undefined;
  let referenceText: string | null =
    decision.kind === 'line'
      ? lineSource
      : lookupVoiceSource(voiceSources, entry.formidLower6, entry.variant);

  if (decision.kind === 'speaker' && speakerKey) {
    const cached = speakerRefCache?.get(speakerKey);
    if (cached) {
      referenceWav = cached.wavPath;
      referenceText = cached.referenceText;
    } else {
      const resolved = await resolveSpeakerReferenceForSpeaker({
        db,
        modId,
        speakerKey,
        preferredEntry: entry,
        getFallbackEntries: () => getSiblingEntries(speakerKey),
        packageDir,
        pluginRelPath,
        isEligible: voiceReferenceEligibilityFromSources(voiceSources),
      });
      if (resolved) {
        referenceWav = resolved.wavPath;
        referenceText = referenceTextForPick(voiceSources, resolved.pick);
        speakerRefCache?.set(speakerKey, {
          wavPath: resolved.wavPath,
          referenceText,
        });
      }
    }
  }

  return {
    wavPath: referenceWav ?? lineEnglishWav,
    referenceText:
      referenceText ?? lookupVoiceSource(voiceSources, entry.formidLower6, entry.variant),
  };
};
