import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../../db';
import { log } from '../../logger';
import { ensureDir } from '../../utils/file';
import { decodeAudioToReferenceWav } from '../ffmpegAudio';
import { resolveVoiceRootRel, type VoiceFileEntry } from '../discoverVoiceFiles';
import {
  loadVoiceSpeakerRef,
  setVoiceSpeakerRef,
  type VoiceSpeakerRefPick,
} from '../voiceSpeakerRefs';
import {
  AUTO_SELECT_GOOD_ENOUGH_SCORE,
  MANUAL_REFERENCE_NAME,
  entryReferenceCacheRoot,
  speakerReferenceCacheRoot,
} from './constants';
import {
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
import { scoreReferenceWav } from './scoring';

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
  /** Line being synthesized — scored first so siblings are scanned only when needed. */
  preferredEntry: VoiceFileEntry;
  getFallbackEntries: () => VoiceFileEntry[];
  packageDir: string;
  pluginRelPath: string;
  /** Keeps clips without a known transcript (orphan audio) out of the pool. */
  isEligible?: VoiceReferenceEligibility;
};

type CacheDirs = {
  speaker: string;
  entry: string;
  work: string;
};

const findPickedEntry = (
  pick: VoiceSpeakerRefPick,
  preferredEntry: VoiceFileEntry,
  getFallbackEntries: () => VoiceFileEntry[],
): VoiceFileEntry | undefined => {
  if (
    pick.formidLower6.toUpperCase() === preferredEntry.formidLower6.toUpperCase() &&
    pick.variant === preferredEntry.variant
  ) {
    return preferredEntry;
  }
  return getFallbackEntries().find(
    (entry) =>
      entry.formidLower6.toUpperCase() === pick.formidLower6.toUpperCase() &&
      entry.variant === pick.variant,
  );
};

type ScoredEntry = {
  entry: VoiceFileEntry;
  wavPath: string;
  score: number;
};

const scoreEntryReference = async (
  entry: VoiceFileEntry,
  dirs: CacheDirs,
): Promise<ScoredEntry | null> => {
  try {
    const wavPath = await getOrDecodeEntryReferenceWav(entry, dirs.entry, dirs.work);
    const score = scoreReferenceWav(wavPath);
    return { entry, wavPath, score };
  } catch (err) {
    log.warn(
      `Speaker ref skip ${entry.fileName}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
};

const finalizeAutoReference = async (
  db: Tx,
  modId: number,
  speakerKey: string,
  dirs: CacheDirs,
  scored: ScoredEntry,
): Promise<ResolvedSpeakerReference> => {
  const pick: VoiceSpeakerRefPick = {
    formidLower6: scored.entry.formidLower6,
    variant: scored.entry.variant,
  };
  await setVoiceSpeakerRef(db, modId, speakerKey, pick, scored.score);

  const autoMarker = `auto:${scored.entry.formidLower6}_${scored.entry.variant}:${sourceDigest(scored.entry.absolutePath)}`;
  const outPath = await getOrReuseSpeakerReferenceWav(
    speakerKey,
    dirs.speaker,
    autoMarker,
    async () => scored.wavPath,
  );

  log.info(
    `Speaker ref "${speakerKey}": auto ${scored.entry.fileName} (score=${scored.score.toFixed(1)})`,
  );
  return { wavPath: outPath, pick, source: 'auto', score: scored.score };
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
    pick: { formidLower6: MANUAL_REFERENCE_FORMID, variant: 1 },
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
      `Speaker ref "${speakerKey}": saved pick ${savedPick.formidLower6}_${savedPick.variant} not found on disk`,
    );
    return null;
  }

  try {
    const savedMarker = `saved:${pickedEntry.formidLower6}_${pickedEntry.variant}:${sourceDigest(pickedEntry.absolutePath)}`;
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

const autoSelectReference = async (
  input: ResolveSpeakerReferenceInput,
  dirs: CacheDirs,
  isEligible: VoiceReferenceEligibility,
): Promise<ResolvedSpeakerReference | null> => {
  const { db, modId, speakerKey, preferredEntry } = input;
  const preferredScored = isEligible(preferredEntry.formidLower6, preferredEntry.variant)
    ? await scoreEntryReference(preferredEntry, dirs)
    : null;
  if (preferredScored && preferredScored.score > Number.NEGATIVE_INFINITY) {
    return finalizeAutoReference(db, modId, speakerKey, dirs, preferredScored);
  }

  let best: ScoredEntry | null = preferredScored;
  for (const entry of input.getFallbackEntries()) {
    if (!isEligible(entry.formidLower6, entry.variant)) continue;
    const scored = await scoreEntryReference(entry, dirs);
    if (!scored) continue;
    if (!best || scored.score > best.score) {
      best = scored;
    }
    if (scored.score >= AUTO_SELECT_GOOD_ENOUGH_SCORE) {
      break;
    }
  }

  if (!best || best.score === Number.NEGATIVE_INFINITY) {
    log.warn(`Speaker ref "${speakerKey}": no suitable reference found`);
    return null;
  }

  return finalizeAutoReference(db, modId, speakerKey, dirs, best);
};

/**
 * Resolve one speaker's TTS reference clip when synthesizing a voice line.
 * Prefers a hand-placed WAV, then the saved pick, then auto-selection.
 * Auto-select tries `preferredEntry` first and only scans sibling lines on demand.
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
      `Speaker ref "${speakerKey}": dropping pick ${savedPick.formidLower6}_${savedPick.variant} — no dialogue text for that clip`,
    );
  } else if (savedPick) {
    const resolved = await resolveSavedReference(speakerKey, savedPick, input, dirs);
    if (resolved) return resolved;
  }

  return autoSelectReference(input, dirs, isEligible);
};
