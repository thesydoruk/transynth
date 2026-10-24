import { lookupVoiceSource, type VoiceSourceRow } from '../loadVoiceTranslations';
import { normalizeVoiceOrigin } from '../voiceOrigin';
import { voiceTranslationMapKey } from '../voiceTextRows';
import type { VoiceSpeakerRefPick } from '../voiceSpeakerRefs';

/** Pick FormID used for a hand-placed `_reference.wav`, which has no dialogue record. */
export const MANUAL_REFERENCE_FORMID = 'MANUAL';

/** Answers whether one voice clip may be used as a speaker's TTS reference. */
export type VoiceReferenceEligibility = (
  lineKey: string,
  variant: number,
  origin?: string | null,
) => boolean;

export const anyVoiceReferenceEligible: VoiceReferenceEligibility = () => true;

/**
 * A clip can voice a speaker only when its own English line is known: TTS is
 * conditioned on the reference transcript, so orphan audio (no INFO record
 * anywhere) would be paired with some other line's text.
 */
export const voiceReferenceEligibilityFromSources = (
  sources: Map<string, VoiceSourceRow>,
): VoiceReferenceEligibility => {
  // `<FORMID6>:<variant>` of every source, whatever its origin; built on first need.
  let bareKeys: Set<string> | null = null;
  return (lineKey, variant, origin) => {
    if (lookupVoiceSource(sources, lineKey, variant, origin) != null) return true;
    if (normalizeVoiceOrigin(origin)) return false;
    // A pick saved before origins existed names no plugin; like voiceSpeakerRefMatches,
    // it stands for that line in whichever plugin has it.
    bareKeys ??= new Set([...sources.keys()].map((key) => key.slice(key.lastIndexOf('/') + 1)));
    return bareKeys.has(voiceTranslationMapKey(lineKey, variant));
  };
};

export const isManualVoiceReferencePick = (pick: VoiceSpeakerRefPick): boolean =>
  pick.lineKey.toUpperCase() === MANUAL_REFERENCE_FORMID;

export const isVoiceReferencePickEligible = (
  pick: VoiceSpeakerRefPick,
  isEligible: VoiceReferenceEligibility,
): boolean =>
  isManualVoiceReferencePick(pick) || isEligible(pick.lineKey, pick.variant, pick.originPlugin);
