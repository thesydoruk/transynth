/**
 * Copy already-synthesized takes into another mod when the spoken line and the
 * character's source voice file are byte-identical.
 *
 * Used after TM apply / version carry-over, and as a first pass of Voice → Missing,
 * so a new mod version does not re-run tens of hours of Fish Speech.
 *
 * Live donor mods come first; what they leave uncovered is looked up in the
 * reference voice store, which also holds the takes of mods since deleted.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../db';
import { log } from '../logger';
import { ensureDir } from '../utils/file';
import { resolveVoiceSourceFileHashes, voiceSourceHashMapKey } from './voiceSourceFileHashes';
import {
  isReusableVoiceText,
  matchReusableVoiceLines,
  type ReuseVoiceMatch,
  type ReuseVoiceSourceLine,
} from './reuseSynthesizedVoiceMatch';
import { reuseReferenceVoiceTakes } from './reuseReferenceVoiceTakes';
import {
  loadVoiceReuseSnapshot,
  ttsVersionForLine,
  type VoiceReuseSnapshot,
} from './voiceReuseSnapshot';
import { upsertVoiceSynthesisState } from './voiceSynthesisState';

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
    originPlugin: match.dest.originPlugin,
    // The donor's stamp equals this by construction (the matcher checked it); stamp the
    // dest from its own text so the take is "current" exactly while that text stands.
    ttsTextVersion: ttsVersionForLine(match.dest, targetLang),
    voiceSimilarity: match.source.voiceSimilarity,
  });
  return true;
};

/**
 * Copy synthesized `.fuz` / `.wav` into `destModId` from donor mods, then from
 * the reference voice store, when the line text and the character's source
 * voice file both match exactly.
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
        originPlugin: line.originPlugin,
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
    const textMatches = matchReusableVoiceLines(stillNeeded, donorLines, (line) =>
      ttsVersionForLine(line, lang),
    );
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
            line.originPlugin === pair.dest.originPlugin &&
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
  // Whatever no live donor covered: takes kept from deleted mods and earlier syntheses.
  const fromReference = await reuseReferenceVoiceTakes(db, dest, lang);
  return { copied: copied + fromReference, skipped: Math.max(0, skipped - fromReference) };
};
