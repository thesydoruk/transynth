/**
 * Copy already-synthesized takes into another mod when the spoken line and the
 * character's source voice file are byte-identical.
 *
 * Used after TM apply / version carry-over, and as a first pass of Voice → Missing,
 * so a new mod version does not re-run tens of hours of Fish Speech.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../db';
import { loadModImportPaths } from '../import/mod/resolvePaths';
import { log } from '../logger';
import { loadImportedMod } from '../modImport';
import { ensureDir } from '../utils/file';
import { resolveVoiceSourceFileHashes, voiceSourceHashMapKey } from './voiceSourceFileHashes';
import {
  isReusableVoiceText,
  matchReusableVoiceLines,
  type ReuseVoiceDestLine,
  type ReuseVoiceLineKey,
  type ReuseVoiceMatch,
  type ReuseVoiceSourceLine,
} from './reuseSynthesizedVoiceMatch';
import { gamePlugin } from '../games/registry';
import { prepareVoiceTtsText } from './prepareVoiceTtsText';
import {
  voiceTtsPayloadVersionFromPrepared,
  computeVoiceTtsPayloadVersion,
} from './voiceTtsPayloadVersion';
import { resolveTtsLanguage } from './voiceToolPaths';
import {
  lookupVoiceSimilarity,
  lookupVoiceSynthesisVersion,
  loadVoiceSimilarityMap,
  loadVoiceSynthesisVersionMap,
  upsertVoiceSynthesisState,
} from './voiceSynthesisState';

export type {
  ReuseVoiceDestLine,
  ReuseVoiceLineKey,
  ReuseVoiceMatch,
  ReuseVoiceSourceLine,
} from './reuseSynthesizedVoiceMatch';

export type ReuseSynthesizedVoiceResult = {
  copied: number;
  skipped: number;
};

export type ReuseSynthesizedVoiceOptions = {
  /** When set, only these mods are considered as donors. */
  sourceModIds?: number[];
  /** Restrict copy to one NPC / Disco speaker folder. */
  speakerKey?: string;
};

const localizedAbsPath = (localizeDir: string, relPath: string): string =>
  path.join(localizeDir, relPath);

const hasLocalizedTake = (localizeDir: string, relPath: string): boolean =>
  fs.existsSync(localizedAbsPath(localizeDir, relPath));

const ttsVersionForLine = (line: ReuseVoiceLineKey, tgtLang: string): string => {
  const prepared = prepareVoiceTtsText({
    lineSource: line.sourceText,
    translation: line.translation,
    speakerSource: line.sourceText,
  });
  if (prepared.action === 'synthesize') {
    return voiceTtsPayloadVersionFromPrepared(prepared, tgtLang);
  }
  return computeVoiceTtsPayloadVersion({
    text: line.translation,
    language: resolveTtsLanguage(tgtLang),
  });
};

type VoiceReuseSnapshot = {
  modId: number;
  game: string;
  localizeDir: string;
  lines: Array<
    ReuseVoiceDestLine & {
      ttsTextVersion: string | null;
      voiceSimilarity: number | null;
    }
  >;
};

const loadVoiceReuseSnapshot = async (
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
  const localizeDir = paths.localizeDir;

  const takes = await voice.listTakes(db, {
    modId,
    extractDir: paths.extractDir,
    pluginPath: paths.pluginPath,
    srcLang: mod.srcLang,
    targetLang: lang,
    speakerKey: speakerFilter?.trim() || undefined,
  });

  const lines: VoiceReuseSnapshot['lines'] = takes.map((take) => ({
    speakerKey: take.speakerKey,
    lineKey: take.entry.lineKey,
    variant: take.entry.variant,
    sourceText: take.source,
    translation: take.translation,
    sourceAbsPath: take.entry.absolutePath,
    sourceRelPath: take.entry.relPath,
    destRelPath: take.destRelPath,
    hasLocalized: hasLocalizedTake(localizeDir, take.destRelPath),
    ttsTextVersion: lookupVoiceSynthesisVersion(
      storedVersions,
      take.speakerKey,
      take.entry.lineKey,
      take.entry.variant,
    ),
    voiceSimilarity: lookupVoiceSimilarity(
      storedSimilarities,
      take.speakerKey,
      take.entry.lineKey,
      take.entry.variant,
    ),
  }));

  return { modId, game: mod.game, localizeDir, lines };
};

/** Other imported versions of the same mod, newest first. */
const listSameNameVoiceReuseModIds = async (db: Tx, destModId: number): Promise<number[]> => {
  const { rows } = await db.query<{ id: number }>(
    `SELECT id FROM mods
     WHERE name = (SELECT name FROM mods WHERE id = $1)
       AND id != $1
     ORDER BY created_at DESC`,
    [destModId],
  );
  return rows.map((row) => row.id);
};

/** Mods that already synthesized at least one of these FormIDs. */
const listOverlappingVoiceReuseModIds = async (
  db: Tx,
  destModId: number,
  targetLang: string,
  formids: string[],
): Promise<number[]> => {
  if (formids.length === 0) return [];
  const { rows } = await db.query<{ mod_id: number }>(
    `SELECT DISTINCT mod_id
     FROM voice_synthesis_state
     WHERE target_lang = $1
       AND mod_id != $2
       AND line_key = ANY($3::text[])`,
    [targetLang.trim().toLowerCase(), destModId, formids],
  );
  return rows.map((row) => row.mod_id);
};

const resolveSourceModIds = async (
  db: Tx,
  dest: VoiceReuseSnapshot,
  targetLang: string,
  explicit?: number[],
): Promise<number[]> => {
  if (explicit && explicit.length > 0) {
    return [...new Set(explicit.filter((id) => id > 0 && id !== dest.modId))];
  }
  const formids = [...new Set(dest.lines.map((line) => line.lineKey))];
  const ids = new Set<number>([
    ...(await listSameNameVoiceReuseModIds(db, dest.modId)),
    ...(await listOverlappingVoiceReuseModIds(db, dest.modId, targetLang, formids)),
  ]);
  ids.delete(dest.modId);
  return [...ids];
};

const copyOneTake = async (
  dest: VoiceReuseSnapshot,
  match: ReuseVoiceMatch,
  targetLang: string,
  db: Tx,
): Promise<boolean> => {
  const destAbs = path.join(dest.localizeDir, match.dest.destRelPath);
  if (fs.existsSync(destAbs)) return false;
  ensureDir(path.dirname(destAbs));
  await fs.promises.copyFile(match.source.localizedAbsPath, destAbs);
  await upsertVoiceSynthesisState(db, {
    modId: dest.modId,
    lineKey: match.dest.lineKey,
    variant: match.dest.variant,
    targetLang,
    speakerKey: match.dest.speakerKey,
    ttsTextVersion: match.source.ttsTextVersion ?? ttsVersionForLine(match.dest, targetLang),
    voiceSimilarity: match.source.voiceSimilarity,
  });
  return true;
};

/**
 * Copy synthesized `.fuz` / `.wav` into `destModId` from donor mods when the
 * line text and the character's source voice file both match exactly.
 */
export const reuseSynthesizedVoice = async (
  db: Tx,
  destModId: number,
  targetLang: string,
  options: ReuseSynthesizedVoiceOptions = {},
): Promise<ReuseSynthesizedVoiceResult> => {
  try {
    return await reuseSynthesizedVoiceUnsafe(db, destModId, targetLang, options);
  } catch (err) {
    log.warn(
      `Voice reuse: aborted for mod ${destModId} (${err instanceof Error ? err.message : String(err)})`,
    );
    return { copied: 0, skipped: 0 };
  }
};

const reuseSynthesizedVoiceUnsafe = async (
  db: Tx,
  destModId: number,
  targetLang: string,
  options: ReuseSynthesizedVoiceOptions,
): Promise<ReuseSynthesizedVoiceResult> => {
  const lang = targetLang.trim().toLowerCase();
  const dest = await loadVoiceReuseSnapshot(db, destModId, lang, options.speakerKey);
  if (!dest) return { copied: 0, skipped: 0 };

  const needed = dest.lines.filter(
    (line) =>
      !line.hasLocalized &&
      isReusableVoiceText(line.sourceText) &&
      isReusableVoiceText(line.translation),
  );
  if (needed.length === 0) return { copied: 0, skipped: dest.lines.length };

  const sourceModIds = await resolveSourceModIds(db, dest, lang, options.sourceModIds);
  if (sourceModIds.length === 0) return { copied: 0, skipped: needed.length };

  let copied = 0;
  let skipped = needed.length;

  for (const sourceModId of sourceModIds) {
    if (needed.every((line) => line.hasLocalized)) break;
    const source = await loadVoiceReuseSnapshot(db, sourceModId, lang, options.speakerKey);
    if (!source || source.game !== dest.game) continue;

    const donorLines: ReuseVoiceSourceLine[] = [];
    for (const line of source.lines) {
      if (!line.hasLocalized) continue;
      const localizedAbsPath = path.join(source.localizeDir, line.destRelPath);
      if (!fs.existsSync(localizedAbsPath)) continue;
      donorLines.push({
        speakerKey: line.speakerKey,
        sourceText: line.sourceText,
        translation: line.translation,
        sourceAbsPath: line.sourceAbsPath,
        sourceRelPath: line.sourceRelPath,
        localizedAbsPath,
        lineKey: line.lineKey,
        variant: line.variant,
        ttsTextVersion: line.ttsTextVersion,
        voiceSimilarity: line.voiceSimilarity,
      });
    }
    if (donorLines.length === 0) continue;

    const stillNeeded = dest.lines.filter(
      (line) =>
        !line.hasLocalized &&
        isReusableVoiceText(line.sourceText) &&
        isReusableVoiceText(line.translation),
    );
    const textMatches = matchReusableVoiceLines(stillNeeded, donorLines);
    const hashes = await resolveVoiceSourceFileHashes(
      db,
      textMatches.flatMap((pair) => [
        {
          modId: dest.modId,
          relPath: pair.dest.sourceRelPath,
          absPath: pair.dest.sourceAbsPath,
        },
        {
          modId: source.modId,
          relPath: pair.source.sourceRelPath,
          absPath: pair.source.sourceAbsPath,
        },
      ]),
      { trustStored: true },
    );
    const confirmed = textMatches.filter((pair) => {
      const destHash = hashes.get(voiceSourceHashMapKey(dest.modId, pair.dest.sourceRelPath));
      const sourceHash = hashes.get(voiceSourceHashMapKey(source.modId, pair.source.sourceRelPath));
      return Boolean(destHash && sourceHash && destHash === sourceHash);
    });

    ensureDir(dest.localizeDir);
    for (const pair of confirmed) {
      try {
        const wrote = await copyOneTake(dest, pair, lang, db);
        if (!wrote) continue;
        const destLine = dest.lines.find(
          (line) =>
            line.speakerKey === pair.dest.speakerKey &&
            line.lineKey === pair.dest.lineKey &&
            line.variant === pair.dest.variant &&
            line.destRelPath === pair.dest.destRelPath,
        );
        if (destLine) destLine.hasLocalized = true;
        copied += 1;
        skipped -= 1;
      } catch (err) {
        log.warn(
          `Voice reuse: failed to copy ${pair.dest.destRelPath} from mod ${sourceModId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  if (copied > 0) {
    log.info(
      `Voice reuse: copied ${copied} take(s) into mod ${destModId} (${lang}) from [${sourceModIds.join(', ')}]`,
    );
  }
  return { copied, skipped: Math.max(0, skipped) };
};
