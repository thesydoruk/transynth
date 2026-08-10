import { lookupVoiceSource, type VoiceSourceRow } from '../loadVoiceTranslations';
import type { VoiceSpeakerRefPick } from '../voiceSpeakerRefs';

/** Pick FormID used for a hand-placed `_reference.wav`, which has no dialogue record. */
export const MANUAL_REFERENCE_FORMID = 'MANUAL';

/** Answers whether one voice clip may be used as a speaker's TTS reference. */
export type VoiceReferenceEligibility = (formidLower6: string, variant: number) => boolean;

export const anyVoiceReferenceEligible: VoiceReferenceEligibility = () => true;

/**
 * A clip can voice a speaker only when its own English line is known: TTS is
 * conditioned on the reference transcript, so orphan audio (no INFO record
 * anywhere) would be paired with some other line's text.
 */
export const voiceReferenceEligibilityFromSources =
  (sources: Map<string, VoiceSourceRow>): VoiceReferenceEligibility =>
  (formidLower6, variant) =>
    lookupVoiceSource(sources, formidLower6, variant) != null;

export const isManualVoiceReferencePick = (pick: VoiceSpeakerRefPick): boolean =>
  pick.formidLower6.toUpperCase() === MANUAL_REFERENCE_FORMID;

export const isVoiceReferencePickEligible = (
  pick: VoiceSpeakerRefPick,
  isEligible: VoiceReferenceEligibility,
): boolean => isManualVoiceReferencePick(pick) || isEligible(pick.formidLower6, pick.variant);
