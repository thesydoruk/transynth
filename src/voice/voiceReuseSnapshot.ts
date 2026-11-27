/**
 * One mod's voiced lines as the reuse passes see them: each source take with
 * its text, where its localized take goes, whether that take is on disk, and
 * the stamp it carries.
 */
import path from 'node:path';
import type { Tx } from '../db';
import { gamePlugin } from '../games/registry';
import { loadModImportPaths } from '../import/mod/resolvePaths';
import { log } from '../logger';
import { loadImportedMod } from '../modImport';
import { prepareVoiceTtsText } from './prepareVoiceTtsText';
import type { ReuseVoiceDestLine, ReuseVoiceLineKey } from './reuseSynthesizedVoiceMatch';
import { voiceTakesOf } from './takeFormat';
import { takeOnDisk } from './takeSidecars';
import {
  loadVoiceSimilarityMap,
  loadVoiceSynthesisVersionMap,
  lookupVoiceSimilarity,
  lookupVoiceSynthesisVersion,
} from './voiceSynthesisState';
import { loadActiveVoiceEffortTags, lookupVoiceEffortTag } from './voiceEffortTags';
import { resolveTtsLanguage } from './voiceToolPaths';
import {
  computeVoiceTtsPayloadVersion,
  voiceTtsPayloadVersionFromPrepared,
} from './voiceTtsPayloadVersion';

/** The stamp a take of this line carries when it was made from the text the line has now. */
export const ttsVersionForLine = (line: ReuseVoiceLineKey, tgtLang: string): string => {
  const prepared = prepareVoiceTtsText({
    lineSource: line.sourceText,
    translation: line.translation,
    // Same speaker text as synthesis, or a reused master-backed take would look stale.
    speakerSource: line.speakerSource ?? line.sourceText,
    effortTag: line.effortTag,
  });
  if (prepared.action === 'synthesize') {
    return voiceTtsPayloadVersionFromPrepared(prepared, tgtLang);
  }
  return computeVoiceTtsPayloadVersion({
    text: line.translation,
    language: resolveTtsLanguage(tgtLang),
  });
};

export type VoiceReuseSnapshotLine = ReuseVoiceDestLine & {
  ttsTextVersion: string | null;
  voiceSimilarity: number | null;
};

export type VoiceReuseSnapshot = {
  modId: number;
  modName: string;
  game: string;
  localizeDir: string;
  lines: VoiceReuseSnapshotLine[];
};

/** Null when the mod's files are gone or its game has no voice support. */
export const loadVoiceReuseSnapshot = async (
  db: Tx,
  modId: number,
  targetLang: string,
  speakerFilter?: string,
): Promise<VoiceReuseSnapshot | null> => {
  const lang = targetLang.trim().toLowerCase();
  let paths;
  try {
    paths = await loadModImportPaths(db, { modId });
  } catch (err) {
    log.warn(
      `Voice reuse: skip mod ${modId} (${err instanceof Error ? err.message : String(err)})`,
    );
    return null;
  }

  const mod = await loadImportedMod(db, modId);
  const voice = gamePlugin(mod.game).voice;
  if (!voice) return null;

  const storedVersions = await loadVoiceSynthesisVersionMap(db, modId, lang);
  const storedSimilarities = await loadVoiceSimilarityMap(db, modId, lang);
  const effortTags = await loadActiveVoiceEffortTags(db, modId, mod.game);
  const localizeDir = paths.localizeDir;
  // A take counts as there only with the files that travel with it.
  const sidecarExtensions = voiceTakesOf(voice).sidecarExtensions;

  const takes = await voice.listTakes(db, {
    modId,
    extractDir: paths.extractDir,
    pluginPath: paths.pluginPath,
    srcLang: mod.srcLang,
    targetLang: lang,
    speakerKey: speakerFilter?.trim() || undefined,
  });

  const lines: VoiceReuseSnapshotLine[] = takes.map((take) => ({
    speakerKey: take.speakerKey,
    originPlugin: take.entry.originPlugin ?? '',
    lineKey: take.entry.lineKey,
    variant: take.entry.variant,
    sourceText: take.source,
    translation: take.translation,
    ...(take.speakerSource ? { speakerSource: take.speakerSource } : {}),
    effortTag: lookupVoiceEffortTag(
      effortTags,
      take.speakerKey,
      take.entry.lineKey,
      take.entry.variant,
      take.entry.originPlugin,
    ),
    sourceAbsPath: take.entry.absolutePath,
    sourceRelPath: take.entry.relPath,
    destRelPath: take.destRelPath,
    hasLocalized: takeOnDisk(path.join(localizeDir, take.destRelPath), sidecarExtensions),
    ttsTextVersion: lookupVoiceSynthesisVersion(
      storedVersions,
      take.speakerKey,
      take.entry.lineKey,
      take.entry.variant,
      take.entry.originPlugin,
    ),
    voiceSimilarity: lookupVoiceSimilarity(
      storedSimilarities,
      take.speakerKey,
      take.entry.lineKey,
      take.entry.variant,
      take.entry.originPlugin,
    ),
  }));

  return { modId, modName: mod.modName, game: mod.game, localizeDir, lines };
};
