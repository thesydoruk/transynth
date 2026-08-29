import type { VoiceFileEntry } from './discoverVoiceFiles';
import { lookupVoiceSource, type VoiceSourceRow } from './loadVoiceTranslations';
import { MIN_REFERENCE_DURATION_SEC } from './speakerReference/constants';
import { isManualVoiceReferencePick } from './speakerReference/eligibility';
import { wavDurationSec } from './speakerReference/pcm';
import type { ResolvedSpeakerReference } from './speakerReference/resolve';

export const SHORT_SIBLING_MIN_TOTAL_SEC = 3;
export const SHORT_SIBLING_MAX_COUNT = 3;

export type VoiceTtsRefClip = {
  wavPath: string;
  speakerText: string | null;
  fileName: string;
};

const sameTake = (a: VoiceFileEntry, b: VoiceFileEntry): boolean =>
  a.formidLower6.toUpperCase() === b.formidLower6.toUpperCase() && a.variant === b.variant;

/** True when the speaker default is a different, usable clip — not this short line. */
export const isUsableSpeakerDefault = (
  resolved: ResolvedSpeakerReference | null,
  entry: VoiceFileEntry,
): boolean => {
  if (!resolved) return false;
  if (wavDurationSec(resolved.wavPath) < MIN_REFERENCE_DURATION_SEC) return false;
  if (isManualVoiceReferencePick(resolved.pick)) return true;
  return (
    resolved.pick.formidLower6.toUpperCase() !== entry.formidLower6.toUpperCase() ||
    resolved.pick.variant !== entry.variant
  );
};

export const lineRefClip = (
  wavPath: string,
  speakerText: string | null,
  fileName: string,
): VoiceTtsRefClip => ({
  wavPath,
  speakerText,
  fileName,
});

/**
 * Append 1–3 other takes of the same speaker until all refs total at least 3s.
 * Decode failures are skipped. Stops early once the duration target is met.
 */
export const collectSiblingFallbackClips = async (
  entry: VoiceFileEntry,
  siblings: VoiceFileEntry[],
  alreadySec: number,
  decode: (candidate: VoiceFileEntry) => Promise<{ wavPath: string; durationSec: number } | null>,
  sources: Map<string, VoiceSourceRow>,
): Promise<{ clips: VoiceTtsRefClip[]; totalSec: number }> => {
  const clips: VoiceTtsRefClip[] = [];
  let totalSec = alreadySec;
  for (const candidate of siblings) {
    if (clips.length >= SHORT_SIBLING_MAX_COUNT || totalSec >= SHORT_SIBLING_MIN_TOTAL_SEC) break;
    if (sameTake(entry, candidate)) continue;
    const decoded = await decode(candidate);
    if (!decoded || !(decoded.durationSec > 0)) continue;
    clips.push({
      wavPath: decoded.wavPath,
      speakerText: lookupVoiceSource(sources, candidate.formidLower6, candidate.variant),
      fileName: candidate.fileName,
    });
    totalSec += decoded.durationSec;
  }
  return { clips, totalSec };
};
