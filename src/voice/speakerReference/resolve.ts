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
import { scoreReferenceWav } from './scoring';

export type ResolvedSpeakerReference = {
  wavPath: string;
  pick: VoiceSpeakerRefPick;
  source: 'manual' | 'saved' | 'auto';
  score?: number;
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
  entryCacheDir: string,
  workDir: string,
): Promise<ScoredEntry | null> => {
  try {
    const wavPath = await getOrDecodeEntryReferenceWav(entry, entryCacheDir, workDir);
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
  speakerCacheDir: string,
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
    speakerCacheDir,
    autoMarker,
    async () => scored.wavPath,
  );

  log.info(
    `Speaker ref "${speakerKey}": auto ${scored.entry.fileName} (score=${scored.score.toFixed(1)})`,
  );
  return { wavPath: outPath, pick, source: 'auto', score: scored.score };
};

/**
 * Resolve one speaker's XTTS reference clip when synthesizing a voice line.
 * Uses cache / saved DB pick / manual override when available.
 * Auto-select tries `preferredEntry` first and only scans sibling lines on demand.
 */
export const resolveSpeakerReferenceForSpeaker = async (
  db: Tx,
  modId: number,
  speakerKey: string,
  preferredEntry: VoiceFileEntry,
  getFallbackEntries: () => VoiceFileEntry[],
  packageDir: string,
  pluginRelPath: string,
): Promise<ResolvedSpeakerReference | null> => {
  const voiceRootRel = resolveVoiceRootRel(pluginRelPath);
  const voiceRootAbs = path.join(packageDir, ...voiceRootRel.split('/'));
  const speakerCacheDir = speakerReferenceCacheRoot(modId);
  const entryCacheDir = entryReferenceCacheRoot(modId);
  const workDir = path.join(speakerCacheDir, '.work', speakerKey.replace(/[^\w.-]+/g, '_'));
  ensureDir(workDir);

  const cachedWav = tryCachedSpeakerReference(speakerKey, speakerCacheDir);
  if (cachedWav) {
    const cachedPick = await loadVoiceSpeakerRef(db, modId, speakerKey);
    log.debug(`Speaker ref "${speakerKey}": cache hit`);
    return {
      wavPath: cachedWav,
      pick: cachedPick ?? {
        formidLower6: preferredEntry.formidLower6,
        variant: preferredEntry.variant,
      },
      source: cachedPick ? 'saved' : 'auto',
    };
  }

  const manualPath = path.join(voiceRootAbs, speakerKey, MANUAL_REFERENCE_NAME);
  if (fs.existsSync(manualPath)) {
    const manualMarker = `manual:${sourceDigest(manualPath)}`;
    const outPath = await getOrReuseSpeakerReferenceWav(
      speakerKey,
      speakerCacheDir,
      manualMarker,
      async () => {
        const decodedPath = path.join(workDir, MANUAL_REFERENCE_NAME);
        await decodeAudioToReferenceWav(manualPath, decodedPath);
        return decodedPath;
      },
    );
    log.info(`Speaker ref "${speakerKey}": manual ${MANUAL_REFERENCE_NAME}`);
    return {
      wavPath: outPath,
      pick: { formidLower6: 'MANUAL', variant: 1 },
      source: 'manual',
    };
  }

  const savedPick = await loadVoiceSpeakerRef(db, modId, speakerKey);
  if (savedPick) {
    const pickedEntry = findPickedEntry(savedPick, preferredEntry, getFallbackEntries);
    if (pickedEntry) {
      try {
        const entryDigest = sourceDigest(pickedEntry.absolutePath);
        const savedMarker = `saved:${pickedEntry.formidLower6}_${pickedEntry.variant}:${entryDigest}`;
        const outPath = await getOrReuseSpeakerReferenceWav(
          speakerKey,
          speakerCacheDir,
          savedMarker,
          () => getOrDecodeEntryReferenceWav(pickedEntry, entryCacheDir, workDir),
        );
        log.info(`Speaker ref "${speakerKey}": saved ${pickedEntry.fileName}`);
        return { wavPath: outPath, pick: savedPick, source: 'saved' };
      } catch (err) {
        log.warn(
          `Speaker ref "${speakerKey}": saved pick ${pickedEntry.fileName} failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    } else {
      log.warn(
        `Speaker ref "${speakerKey}": saved pick ${savedPick.formidLower6}_${savedPick.variant} not found on disk`,
      );
    }
  }

  const preferredScored = await scoreEntryReference(preferredEntry, entryCacheDir, workDir);
  if (preferredScored && preferredScored.score > Number.NEGATIVE_INFINITY) {
    return finalizeAutoReference(db, modId, speakerKey, speakerCacheDir, preferredScored);
  }

  let best: ScoredEntry | null = preferredScored;
  for (const entry of getFallbackEntries()) {
    const scored = await scoreEntryReference(entry, entryCacheDir, workDir);
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

  return finalizeAutoReference(db, modId, speakerKey, speakerCacheDir, best);
};
