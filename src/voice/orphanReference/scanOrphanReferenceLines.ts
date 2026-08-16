import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../../db';
import { log } from '../../logger';
import { loadModImportPaths } from '../../import/mod/resolvePaths';
import { loadImportedMod, pluginRelPath, resolveImportPackages, toDiskPath } from '../../modImport';
import { mapWithConcurrency } from '../../utils/concurrency';
import { ensureDir } from '../../utils/file';
import {
  decideVoiceReferenceSource,
  isLineReferenceSuitable,
  isLineReferenceTooLong,
} from '../decideVoiceReferenceSource';
import {
  dedupeVoiceFiles,
  discoverVoiceFiles,
  resolveVoiceRootRel,
  type VoiceFileEntry,
} from '../discoverVoiceFiles';
import { voiceTranslationMapKey } from '../loadVoiceTranslations';
import { isManualVoiceReferencePick, voiceSpeakerKey } from '../speakerReference';
import { getOrDecodeEntryReferenceWav } from '../speakerReference/cache';
import { entryReferenceCacheRoot } from '../speakerReference/constants';
import { outputLocalizedFuzRelPath } from '../voiceFilePaths';
import { loadVoiceSpeakerRefs, type VoiceSpeakerRefPick } from '../voiceSpeakerRefs';
import { loadVoiceSourceFormids } from '../voiceSourceFormids';
import type { TtsReferenceMode } from '../voiceToolPaths';

export type OrphanReferenceSpeaker = {
  speakerKey: string;
  pick: VoiceSpeakerRefPick;
};

export type OrphanReferenceLine = {
  speakerKey: string;
  entry: VoiceFileEntry;
  fuzPath: string;
};

export type OrphanReferenceScan = {
  modId: number;
  modName: string;
  targetLang: string;
  extractDir: string;
  pluginPath: string;
  /** Speakers whose saved reference clip has no dialogue record at all. */
  speakers: OrphanReferenceSpeaker[];
  /** Already generated lines that were voiced from one of those clips. */
  lines: OrphanReferenceLine[];
};

export type ScanOrphanReferenceLinesOptions = {
  modId: number;
  targetLang?: string;
  referenceMode: TtsReferenceMode;
  concurrency?: number;
};

const SUITABILITY_CONCURRENCY = 8;

/**
 * True when synthesis voiced this line from the speaker clip instead of the
 * line's own take. In line mode that happens only for takes unusable as
 * reference — the same check the pipeline runs before calling TTS.
 */
const usedSpeakerReference = async (
  entry: VoiceFileEntry,
  referenceMode: TtsReferenceMode,
  modId: number,
  workDir: string,
): Promise<boolean> => {
  if (referenceMode === 'speaker') return true;
  try {
    const wavPath = await getOrDecodeEntryReferenceWav(
      entry,
      entryReferenceCacheRoot(modId),
      workDir,
    );
    const decision = decideVoiceReferenceSource(
      referenceMode,
      isLineReferenceSuitable(wavPath),
      isLineReferenceTooLong(wavPath),
    );
    return decision.kind === 'speaker';
  } catch (err) {
    log.warn(
      `Orphan ref scan: cannot score ${entry.fileName}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return true;
  }
};

/** Speakers of a mod whose saved TTS reference clip is orphan audio. */
export const findOrphanReferenceSpeakers = async (
  db: Tx,
  modId: number,
  pluginPath: string,
  srcLang: string,
  targetLang: string,
): Promise<OrphanReferenceSpeaker[]> => {
  const [refs, sourceFormids] = await Promise.all([
    loadVoiceSpeakerRefs(db, modId),
    loadVoiceSourceFormids(db, modId, pluginPath, srcLang, targetLang),
  ]);

  return Object.entries(refs)
    .filter(
      ([, pick]) =>
        !isManualVoiceReferencePick(pick) && !sourceFormids.has(pick.formidLower6.toUpperCase()),
    )
    .map(([speakerKey, pick]) => ({ speakerKey, pick }));
};

/** Find generated voice lines of one mod that were synthesized from orphan reference audio. */
export const scanOrphanReferenceLines = async (
  db: Tx,
  options: ScanOrphanReferenceLinesOptions,
): Promise<OrphanReferenceScan> => {
  const mod = await loadImportedMod(db, options.modId);
  const paths = await loadModImportPaths(db, { modId: options.modId });
  const targetLang = options.targetLang?.trim() || paths.targetLang;
  const speakers = await findOrphanReferenceSpeakers(
    db,
    mod.modId,
    paths.pluginPath,
    mod.srcLang,
    targetLang,
  );

  const scan: OrphanReferenceScan = {
    modId: mod.modId,
    modName: mod.modName,
    targetLang,
    extractDir: paths.extractDir,
    pluginPath: paths.pluginPath,
    speakers,
    lines: [],
  };
  if (speakers.length === 0) return scan;

  const orphanSpeakerKeys = new Set(speakers.map((speaker) => speaker.speakerKey));
  const workDir = path.join(entryReferenceCacheRoot(mod.modId), '.work');
  ensureDir(workDir);

  const candidates: OrphanReferenceLine[] = [];
  for (const pkg of resolveImportPackages(paths.extractDir, targetLang, paths.pluginPath)) {
    const pluginRel = pluginRelPath(pkg.packageDir, pkg.pluginPath);
    const voiceRootRel = resolveVoiceRootRel(pluginRel);
    for (const entry of dedupeVoiceFiles(discoverVoiceFiles(pkg.packageDir, pluginRel))) {
      const speakerKey = voiceSpeakerKey(entry, voiceRootRel);
      if (!orphanSpeakerKeys.has(speakerKey)) continue;

      const fuzPath = toDiskPath(pkg.localizeDir, outputLocalizedFuzRelPath(entry));
      if (!fs.existsSync(fuzPath)) continue;
      candidates.push({ speakerKey, entry, fuzPath });
    }
  }

  const matched = await mapWithConcurrency(
    candidates,
    Math.max(1, options.concurrency ?? SUITABILITY_CONCURRENCY),
    async (candidate) =>
      (await usedSpeakerReference(candidate.entry, options.referenceMode, mod.modId, workDir))
        ? candidate
        : null,
  );
  scan.lines = matched.filter((line): line is OrphanReferenceLine => line != null);
  return scan;
};

/** `FORMID6:variant` keys of the lines that need re-synthesis. */
export const orphanReferenceLineKeys = (scan: OrphanReferenceScan): Set<string> =>
  new Set(
    scan.lines.map((line) => voiceTranslationMapKey(line.entry.formidLower6, line.entry.variant)),
  );

/** Mods with at least one saved speaker reference, so a stale pick is possible. */
export const listModsWithVoiceSpeakerRefs = async (db: Tx): Promise<number[]> => {
  const { rows } = await db.query<{ mod_id: number }>(
    `SELECT DISTINCT mod_id FROM voice_speaker_refs ORDER BY mod_id`,
  );
  return rows.map((row) => row.mod_id);
};
