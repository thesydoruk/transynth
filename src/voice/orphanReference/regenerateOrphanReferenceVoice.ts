import type { Tx } from '../../db';
import { log } from '../../logger';
import { localizeModImportVoice } from '../localizeModImportVoice';
import { clearCachedSpeakerReference } from '../speakerReference/cache';
import { speakerReferenceCacheRoot } from '../speakerReference/constants';
import { clearVoiceSpeakerRef } from '../voiceSpeakerRefs';
import { loadVoiceProjectSettings } from '../voiceProjectSettings';
import type { TtsReferenceMode } from '../voiceToolPaths';
import {
  listModsWithVoiceSpeakerRefs,
  orphanReferenceLineKeys,
  scanOrphanReferenceLines,
  type OrphanReferenceScan,
} from './scanOrphanReferenceLines';

export type RegenerateOrphanReferenceVoiceOptions = {
  /** Defaults to every mod that has a saved speaker reference. */
  modIds?: number[];
  targetLang?: string;
  referenceMode?: TtsReferenceMode;
  ttsBaseUrl?: string;
  /** Report findings without touching picks, audio, or TTS. */
  dryRun?: boolean;
  /** Drop the stale picks but leave re-synthesis to a later voice job. */
  skipSynthesis?: boolean;
  limit?: number;
};

export type RegenerateOrphanReferenceVoiceModResult = {
  modId: number;
  modName: string;
  speakers: string[];
  lineCount: number;
  written: number;
  failed: number;
  error?: string;
};

export type RegenerateOrphanReferenceVoiceResult = {
  mods: RegenerateOrphanReferenceVoiceModResult[];
  totalSpeakers: number;
  totalLines: number;
  totalWritten: number;
};

const describeScan = (scan: OrphanReferenceScan): string =>
  `mod "${scan.modName}" id=${scan.modId}: ${scan.speakers.length} orphan reference(s), ${scan.lines.length} generated line(s)`;

/** Forget a stale pick so the next resolve auto-selects a clip that has dialogue text. */
const dropOrphanReference = async (db: Tx, modId: number, speakerKey: string): Promise<void> => {
  await clearVoiceSpeakerRef(db, modId, speakerKey);
  clearCachedSpeakerReference(speakerKey, speakerReferenceCacheRoot(modId));
};

const regenerateOneMod = async (
  db: Tx,
  modId: number,
  referenceMode: TtsReferenceMode,
  options: RegenerateOrphanReferenceVoiceOptions,
): Promise<RegenerateOrphanReferenceVoiceModResult> => {
  const scan = await scanOrphanReferenceLines(db, {
    modId,
    targetLang: options.targetLang,
    referenceMode,
  });
  const base = {
    modId: scan.modId,
    modName: scan.modName,
    speakers: scan.speakers.map((speaker) => `${speaker.speakerKey}=${speaker.pick.formidLower6}`),
    lineCount: scan.lines.length,
    written: 0,
    failed: 0,
  };
  if (scan.speakers.length === 0) return base;

  log.info(describeScan(scan));
  if (options.dryRun) return base;

  for (const speaker of scan.speakers) {
    await dropOrphanReference(db, scan.modId, speaker.speakerKey);
  }
  if (options.skipSynthesis || scan.lines.length === 0) return base;

  const result = await localizeModImportVoice(db, {
    modId: scan.modId,
    extractDir: scan.extractDir,
    pluginPath: scan.pluginPath,
    tgtLang: scan.targetLang,
    ttsBaseUrl: options.ttsBaseUrl,
    scope: 'all',
    onlyKeys: orphanReferenceLineKeys(scan),
    limit: options.limit,
  });

  for (const warning of result.warnings) log.warn(`Orphan ref regenerate: ${warning}`);
  return {
    ...base,
    written: result.written.length,
    failed: result.warnings.length,
  };
};

/**
 * Re-voice every line that was synthesized from an orphan reference clip — audio
 * left in the archives with no dialogue record, so TTS was conditioned on some
 * other line's transcript. Stale picks are dropped first, letting auto-select
 * choose a clip whose own text is known.
 */
export const regenerateOrphanReferenceVoice = async (
  db: Tx,
  options: RegenerateOrphanReferenceVoiceOptions = {},
): Promise<RegenerateOrphanReferenceVoiceResult> => {
  const modIds = options.modIds?.length ? options.modIds : await listModsWithVoiceSpeakerRefs(db);
  const referenceMode = options.referenceMode ?? (await loadVoiceProjectSettings(db)).referenceMode;

  log.info(
    `Orphan reference voice scan: ${modIds.length} mod(s), refMode=${referenceMode}${options.dryRun ? ' (dry-run)' : ''}`,
  );

  const mods: RegenerateOrphanReferenceVoiceModResult[] = [];
  for (const modId of modIds) {
    try {
      mods.push(await regenerateOneMod(db, modId, referenceMode, options));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`Orphan ref regenerate mod id=${modId} failed: ${message}`);
      mods.push({
        modId,
        modName: `#${modId}`,
        speakers: [],
        lineCount: 0,
        written: 0,
        failed: 0,
        error: message,
      });
    }
  }

  return {
    mods,
    totalSpeakers: mods.reduce((sum, mod) => sum + mod.speakers.length, 0),
    totalLines: mods.reduce((sum, mod) => sum + mod.lineCount, 0),
    totalWritten: mods.reduce((sum, mod) => sum + mod.written, 0),
  };
};
