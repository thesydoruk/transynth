import path from 'node:path';
import type { Tx } from '../db';
import { getJobRuntime } from '../pipeline/jobRuntime';
import { writeSystemLog } from '../web/services/systemLog';
import type { VoiceFileEntry } from './discoverVoiceFiles';
import {
  decideVoiceReferenceSource,
  isLineReferenceSuitable,
  isLineReferenceTooLong,
} from './decideVoiceReferenceSource';
import { lookupVoiceSource, type VoiceSourceRow } from './loadVoiceTranslations';
import type { VoiceTtsMarkupStyle } from './prepareVoiceTtsText';
import {
  isManualVoiceReferencePick,
  resolveSpeakerReferenceForSpeaker,
  voiceReferenceEligibilityFromSources,
  type ResolvedSpeakerReference,
} from './speakerReference';
import { getOrDecodeEntryReferenceWav } from './speakerReference/cache';
import { entryReferenceCacheRoot } from './speakerReference/constants';
import { wavDurationSec } from './speakerReference/pcm';
import type { TtsReferenceMode } from './voiceToolPaths';
import {
  collectSiblingFallbackClips,
  isUsableSpeakerDefault,
  lineRefClip,
  type VoiceTtsRefClip,
} from './pickShortVoiceReferences';

export type { VoiceTtsRefClip };

export type SpeakerRefCacheEntry = {
  wavPath: string;
  referenceText: string | null;
  resolved: ResolvedSpeakerReference;
};

export type PickedVoiceTtsReference = {
  clips: VoiceTtsRefClip[];
  strategy: 'line' | 'speaker' | 'short_with_default' | 'short_sibling_fallback';
};

const referenceTextForPick = (
  sources: Map<string, VoiceSourceRow>,
  pick: ResolvedSpeakerReference['pick'],
): string | null => {
  if (isManualVoiceReferencePick(pick)) return null;
  return lookupVoiceSource(sources, pick.formidLower6, pick.variant);
};

const resolveCachedSpeakerRef = async (input: {
  db: Tx;
  modId: number;
  packageDir: string;
  pluginRelPath: string;
  speakerKey: string;
  entry: VoiceFileEntry;
  voiceSources: Map<string, VoiceSourceRow>;
  getSiblingEntries: (speakerKey: string) => VoiceFileEntry[];
  speakerRefCache?: Map<string, SpeakerRefCacheEntry>;
  markup?: VoiceTtsMarkupStyle;
}): Promise<ResolvedSpeakerReference | null> => {
  const cached = input.speakerRefCache?.get(input.speakerKey);
  if (cached) return cached.resolved;
  const resolved = await resolveSpeakerReferenceForSpeaker({
    db: input.db,
    modId: input.modId,
    speakerKey: input.speakerKey,
    preferredEntry: input.entry,
    getFallbackEntries: () => input.getSiblingEntries(input.speakerKey),
    packageDir: input.packageDir,
    pluginRelPath: input.pluginRelPath,
    isEligible: voiceReferenceEligibilityFromSources(input.voiceSources),
    getSourceText: (formidLower6, variant) =>
      lookupVoiceSource(input.voiceSources, formidLower6, variant),
    markup: input.markup,
  });
  if (resolved) {
    input.speakerRefCache?.set(input.speakerKey, {
      wavPath: resolved.wavPath,
      referenceText: referenceTextForPick(input.voiceSources, resolved.pick),
      resolved,
    });
  }
  return resolved;
};

const logSiblingFallback = async (
  db: Tx,
  input: {
    modId: number;
    speakerKey: string;
    entry: VoiceFileEntry;
    extras: VoiceTtsRefClip[];
    totalSec: number;
  },
): Promise<void> => {
  const runtime = getJobRuntime();
  await writeSystemLog(db, {
    level: 'info',
    source: 'tts',
    message: 'Short voice line used sibling references (no default speaker ref)',
    jobId: runtime?.jobId,
    jobKind: runtime?.kind,
    modId: input.modId,
    details: {
      speakerKey: input.speakerKey,
      formidLower6: input.entry.formidLower6,
      variant: input.entry.variant,
      lineFile: input.entry.fileName,
      siblings: input.extras.map((clip) => clip.fileName),
      siblingCount: input.extras.length,
      totalDurationSec: Number(input.totalSec.toFixed(2)),
    },
  });
};

/** Line clip first; extra speaker clips only when the original take is short. */
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
  markup?: VoiceTtsMarkupStyle;
}): Promise<PickedVoiceTtsReference> => {
  const lineClip = lineRefClip(input.lineEnglishWav, input.lineSource, input.entry.fileName);
  const lineTooLong = isLineReferenceTooLong(input.lineEnglishWav);
  const decision = decideVoiceReferenceSource(
    input.referenceMode,
    isLineReferenceSuitable(input.lineEnglishWav),
    lineTooLong,
  );

  if (decision.kind === 'line') {
    return { clips: [lineClip], strategy: 'line' };
  }

  const speakerKey = input.speakerKey;
  const resolved = speakerKey ? await resolveCachedSpeakerRef({ ...input, speakerKey }) : null;

  if (decision.kind === 'speaker') {
    if (resolved) {
      return {
        clips: [
          lineRefClip(
            resolved.wavPath,
            referenceTextForPick(input.voiceSources, resolved.pick),
            path.basename(resolved.wavPath),
          ),
        ],
        strategy: 'speaker',
      };
    }
    return { clips: [lineClip], strategy: 'line' };
  }

  if (isUsableSpeakerDefault(resolved, input.entry) && resolved) {
    return {
      clips: [
        lineClip,
        lineRefClip(
          resolved.wavPath,
          referenceTextForPick(input.voiceSources, resolved.pick),
          path.basename(resolved.wavPath),
        ),
      ],
      strategy: 'short_with_default',
    };
  }

  const workDir = path.dirname(input.lineEnglishWav);
  const extras = speakerKey
    ? await collectSiblingFallbackClips(
        input.entry,
        input.getSiblingEntries(speakerKey),
        wavDurationSec(input.lineEnglishWav),
        async (candidate) => {
          try {
            const wavPath = await getOrDecodeEntryReferenceWav(
              candidate,
              entryReferenceCacheRoot(input.modId),
              workDir,
            );
            const durationSec = wavDurationSec(wavPath);
            return durationSec > 0 ? { wavPath, durationSec } : null;
          } catch {
            return null;
          }
        },
        input.voiceSources,
      )
    : { clips: [], totalSec: wavDurationSec(input.lineEnglishWav) };

  if (speakerKey && extras.clips.length > 0) {
    await logSiblingFallback(input.db, {
      modId: input.modId,
      speakerKey,
      entry: input.entry,
      extras: extras.clips,
      totalSec: extras.totalSec,
    });
  }

  return {
    clips: [lineClip, ...extras.clips],
    strategy: 'short_sibling_fallback',
  };
};
