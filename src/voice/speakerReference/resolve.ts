import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../../db';
import { log } from '../../logger';
import { ensureDir } from '../../utils/file';
import { decodeAudioToReferenceWav } from '../ffmpegAudio';
import { resolveVoiceRootRel, type VoiceFileEntry } from '../discoverVoiceFiles';
import {
  loadVoiceSpeakerRef,
  voiceSpeakerRefMatches,
  type VoiceSpeakerRefPick,
} from '../voiceSpeakerRefs';
import type { VoiceTtsMarkupStyle } from '../prepareVoiceTtsText';
import { autoSelectReference, type CacheDirs } from './autoSelectScan';
import {
  MANUAL_REFERENCE_NAME,
  entryReferenceCacheRoot,
  speakerReferenceCacheRoot,
} from './constants';
import {
  entryReferenceId,
  getOrDecodeEntryReferenceWav,
  getOrReuseSpeakerReferenceWav,
  sourceDigest,
  tryCachedSpeakerReference,
} from './cache';
import {
  MANUAL_REFERENCE_FORMID,
  anyVoiceReferenceEligible,
  isVoiceReferencePickEligible,
  type VoiceReferenceEligibility,
} from './eligibility';

export type ResolvedSpeakerReference = {
  wavPath: string;
  pick: VoiceSpeakerRefPick;
  source: 'manual' | 'saved' | 'auto';
  score?: number;
};

export type ResolveSpeakerReferenceInput = {
  db: Tx;
  modId: number;
  speakerKey: string;
  /** Line being synthesized — accepted immediately when it is already 8–12s + in-tempo. */
  preferredEntry: VoiceFileEntry;
  getFallbackEntries: () => VoiceFileEntry[];
  packageDir: string;
  pluginRelPath: string;
  /** Keeps clips without a known transcript (orphan audio) out of the pool. */
  isEligible?: VoiceReferenceEligibility;
  /** English line text for syllable-rate ranking. */
  getSourceText?: (lineKey: string, variant: number, origin?: string | null) => string | null;
  markup?: VoiceTtsMarkupStyle;
  /** A cancelled job stops the sibling scan instead of finishing it. */
  signal?: AbortSignal;
};

const findPickedEntry = (
  pick: VoiceSpeakerRefPick,
  preferredEntry: VoiceFileEntry,
  getFallbackEntries: () => VoiceFileEntry[],
): VoiceFileEntry | undefined => {
  // A pick that carries an origin only matches a take of that origin.
  const matches = (entry: VoiceFileEntry): boolean =>
    voiceSpeakerRefMatches(pick, entry.lineKey, entry.variant, entry.originPlugin) &&
    (!pick.originPlugin || entry.originPlugin === pick.originPlugin);
  if (matches(preferredEntry)) return preferredEntry;
  return getFallbackEntries().find(matches);
};

const resolveManualReference = async (
  speakerKey: string,
  manualPath: string,
  dirs: CacheDirs,
): Promise<ResolvedSpeakerReference> => {
  const manualMarker = `manual:${sourceDigest(manualPath)}`;
  const outPath = await getOrReuseSpeakerReferenceWav(
    speakerKey,
    dirs.speaker,
    manualMarker,
    async () => {
      const decodedPath = path.join(dirs.work, MANUAL_REFERENCE_NAME);
      await decodeAudioToReferenceWav(manualPath, decodedPath);
      return decodedPath;
    },
  );
  log.info(`Speaker ref "${speakerKey}": manual ${MANUAL_REFERENCE_NAME}`);
  return {
    wavPath: outPath,
    pick: { lineKey: MANUAL_REFERENCE_FORMID, variant: 1 },
    source: 'manual',
  };
};

const resolveSavedReference = async (
  speakerKey: string,
  savedPick: VoiceSpeakerRefPick,
  input: ResolveSpeakerReferenceInput,
  dirs: CacheDirs,
): Promise<ResolvedSpeakerReference | null> => {
  // The cached WAV is only trustworthy while the pick that produced it stands.
  const cachedWav = tryCachedSpeakerReference(speakerKey, dirs.speaker);
  if (cachedWav) {
    log.debug(`Speaker ref "${speakerKey}": cache hit`);
    return { wavPath: cachedWav, pick: savedPick, source: 'saved' };
  }

  const pickedEntry = findPickedEntry(savedPick, input.preferredEntry, input.getFallbackEntries);
  if (!pickedEntry) {
    log.warn(
      `Speaker ref "${speakerKey}": saved pick ${savedPick.originPlugin ? `${savedPick.originPlugin}/` : ''}${savedPick.lineKey}_${savedPick.variant} not found on disk`,
    );
    return null;
  }

  try {
    const savedMarker = `saved:${entryReferenceId(pickedEntry)}:${sourceDigest(pickedEntry.absolutePath)}`;
    const outPath = await getOrReuseSpeakerReferenceWav(speakerKey, dirs.speaker, savedMarker, () =>
      getOrDecodeEntryReferenceWav(pickedEntry, dirs.entry, dirs.work),
    );
    log.info(`Speaker ref "${speakerKey}": saved ${pickedEntry.fileName}`);
    return { wavPath: outPath, pick: savedPick, source: 'saved' };
  } catch (err) {
    log.warn(
      `Speaker ref "${speakerKey}": saved pick ${pickedEntry.fileName} failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
};

/**
 * Resolve one speaker's TTS reference clip when synthesizing a voice line.
 * Prefers a hand-placed WAV, then the saved pick, then auto-selection.
 * Auto-select accepts the current line only when it is 8–12s and in-tempo;
 * otherwise it ranks a bounded spread of eligible siblings (prefer 8–12s,
 * else closest longer). Throws an `AbortError` when `signal` fires mid-scan.
 */
export const resolveSpeakerReferenceForSpeaker = async (
  input: ResolveSpeakerReferenceInput,
): Promise<ResolvedSpeakerReference | null> => {
  const { db, modId, speakerKey } = input;
  const isEligible = input.isEligible ?? anyVoiceReferenceEligible;
  const voiceRootRel = resolveVoiceRootRel(input.pluginRelPath);
  const voiceRootAbs = path.join(input.packageDir, ...voiceRootRel.split('/'));
  const speakerCacheDir = speakerReferenceCacheRoot(modId);
  const dirs: CacheDirs = {
    speaker: speakerCacheDir,
    entry: entryReferenceCacheRoot(modId),
    work: path.join(speakerCacheDir, '.work', speakerKey.replace(/[^\w.-]+/g, '_')),
  };
  ensureDir(dirs.work);

  const manualPath = path.join(voiceRootAbs, speakerKey, MANUAL_REFERENCE_NAME);
  if (fs.existsSync(manualPath)) {
    return resolveManualReference(speakerKey, manualPath, dirs);
  }

  const savedPick = await loadVoiceSpeakerRef(db, modId, speakerKey);
  if (savedPick && !isVoiceReferencePickEligible(savedPick, isEligible)) {
    log.warn(
      `Speaker ref "${speakerKey}": dropping pick ${savedPick.originPlugin ? `${savedPick.originPlugin}/` : ''}${savedPick.lineKey}_${savedPick.variant} — no dialogue text for that clip`,
    );
  } else if (savedPick) {
    const resolved = await resolveSavedReference(speakerKey, savedPick, input, dirs);
    if (resolved) return resolved;
  }

  return autoSelectReference(input, dirs, isEligible);
};
