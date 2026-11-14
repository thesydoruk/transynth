/**
 * The two directions between a mod's takes and the reference voice store
 * (`referenceVoiceTakes.ts`), both over a {@link VoiceReuseSnapshot}:
 *
 * - {@link reuseReferenceVoiceTakes}: the last pass of voice reuse. Lines no
 *   live donor mod covered get their take from the store when it holds one made
 *   from the same original voice file and the same TTS payload.
 * - {@link snapshotModVoiceToReference}: copy a live mod's current takes into
 *   the store — before the mod is purged, and as the backfill for takes made
 *   before the store existed.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../db';
import { log } from '../logger';
import { ensureDir } from '../utils/file';
import {
  findReferenceVoiceTakes,
  hasReferenceVoiceTakes,
  referenceVoiceFileExt,
  referenceVoiceTakeMapKey,
  saveReferenceVoiceTake,
  shouldReplaceReferenceVoiceTake,
  type StoredReferenceVoiceTake,
} from './referenceVoiceTakes';
import { isReusableVoiceText } from './reuseSynthesizedVoiceMatch';
import { resolveVoiceSourceFileHashes, voiceSourceHashMapKey } from './voiceSourceFileHashes';
import { upsertVoiceSynthesisState } from './voiceSynthesisState';
import {
  loadVoiceReuseSnapshot,
  ttsVersionForLine,
  type VoiceReuseSnapshot,
  type VoiceReuseSnapshotLine,
} from './voiceReuseSnapshot';

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** A line paired with the store key its take has, or would have. */
type KeyedLine = { line: VoiceReuseSnapshotLine; sourceSha1: string; ttsTextVersion: string };

/** SHA-1 of each line's own source file (stored digests are trusted) and its expected stamp. */
const keyLines = async (
  db: Tx,
  snapshot: VoiceReuseSnapshot,
  lines: VoiceReuseSnapshotLine[],
  lang: string,
): Promise<{ keyed: KeyedLine[]; noSourceHash: number }> => {
  const hashes = await resolveVoiceSourceFileHashes(
    db,
    lines.map((line) => ({
      modId: snapshot.modId,
      relPath: line.sourceRelPath,
      absPath: line.sourceAbsPath,
    })),
    { trustStored: true },
  );
  const keyed: KeyedLine[] = [];
  for (const line of lines) {
    const sourceSha1 = hashes.get(voiceSourceHashMapKey(snapshot.modId, line.sourceRelPath));
    if (sourceSha1) keyed.push({ line, sourceSha1, ttsTextVersion: ttsVersionForLine(line, lang) });
  }
  return { keyed, noSourceHash: lines.length - keyed.length };
};

const storedTakeOf = (
  stored: ReadonlyMap<string, StoredReferenceVoiceTake>,
  item: KeyedLine,
): StoredReferenceVoiceTake | undefined =>
  stored.get(referenceVoiceTakeMapKey(item.sourceSha1, item.ttsTextVersion));

/**
 * A stored take fits a line only as the kind of file the line's take is: a
 * `.wav` kept for one game is no use where a `.fuz` is expected.
 */
export const referenceTakeFitsLine = (
  stored: Pick<StoredReferenceVoiceTake, 'fileExt'> | undefined,
  destRelPath: string,
): stored is StoredReferenceVoiceTake =>
  Boolean(stored && stored.fileExt === referenceVoiceFileExt(destRelPath));

/**
 * Copy takes from the reference store into the mod for every line that still
 * has none. Marks the lines it fills (`hasLocalized`) and returns their count.
 * Never throws.
 */
export const reuseReferenceVoiceTakes = async (
  db: Tx,
  dest: VoiceReuseSnapshot,
  targetLang: string,
): Promise<number> => {
  const lang = targetLang.trim().toLowerCase();
  let copied = 0;
  try {
    const needed = dest.lines.filter(
      (line) =>
        !line.hasLocalized &&
        isReusableVoiceText(line.sourceText) &&
        isReusableVoiceText(line.translation),
    );
    // Hashing the source files of a whole mod is only worth it when something may match.
    if (needed.length === 0 || !(await hasReferenceVoiceTakes(db, dest.game, lang))) return 0;

    const { keyed } = await keyLines(db, dest, needed, lang);
    const stored = await findReferenceVoiceTakes(db, {
      game: dest.game,
      tgtLang: lang,
      keys: keyed,
    });
    for (const item of keyed) {
      const take = storedTakeOf(stored, item);
      if (!referenceTakeFitsLine(take, item.line.destRelPath)) continue;
      const destAbs = path.join(dest.localizeDir, item.line.destRelPath);
      try {
        if (!fs.existsSync(destAbs)) {
          ensureDir(path.dirname(destAbs));
          await fs.promises.copyFile(take.absPath, destAbs);
          await upsertVoiceSynthesisState(db, {
            modId: dest.modId,
            lineKey: item.line.lineKey,
            variant: item.line.variant,
            targetLang: lang,
            speakerKey: item.line.speakerKey,
            originPlugin: item.line.originPlugin,
            ttsTextVersion: item.ttsTextVersion,
            voiceSimilarity: take.voiceSimilarity,
          });
          copied += 1;
        }
        item.line.hasLocalized = true;
      } catch (err) {
        log.warn(
          `Voice reuse: failed to copy ${item.line.destRelPath} from the reference store: ${errorText(err)}`,
        );
      }
    }
  } catch (err) {
    log.warn(`Voice reuse: reference store skipped for mod ${dest.modId} (${errorText(err)})`);
  }
  if (copied > 0) {
    log.info(
      `Voice reuse: copied ${copied} take(s) into mod ${dest.modId} (${lang}) from the reference store`,
    );
  }
  return copied;
};

export type SnapshotModVoiceResult = {
  /** Takes the store took (or, on a dry run, would take). */
  saved: number;
  /** Takes the store already holds at least as good a copy of. */
  keptExisting: number;
  /** Takes whose stamp is not the one their line's current text gives: they say older words. */
  skippedStale: number;
  /** Takes whose original voice file could not be hashed. */
  noSourceHash: number;
  failed: number;
};

const emptySnapshotResult = (): SnapshotModVoiceResult => ({
  saved: 0,
  keptExisting: 0,
  skippedStale: 0,
  noSourceHash: 0,
  failed: 0,
});

/**
 * Copy a mod's current takes into the reference store: those on disk whose
 * stored stamp equals the version the line's present text gives. Scores come
 * from `voice_synthesis_state`. Never throws.
 */
export const snapshotModVoiceToReference = async (
  db: Tx,
  modId: number,
  targetLang: string,
  options: { dryRun?: boolean } = {},
): Promise<SnapshotModVoiceResult> => {
  const lang = targetLang.trim().toLowerCase();
  const result = emptySnapshotResult();
  try {
    const snapshot = await loadVoiceReuseSnapshot(db, modId, lang);
    if (!snapshot) return result;

    const onDisk = snapshot.lines.filter((line) => line.hasLocalized);
    const current = onDisk.filter(
      (line) =>
        isReusableVoiceText(line.sourceText) &&
        isReusableVoiceText(line.translation) &&
        line.ttsTextVersion === ttsVersionForLine(line, lang),
    );
    result.skippedStale = onDisk.length - current.length;

    const { keyed, noSourceHash } = await keyLines(db, snapshot, current, lang);
    result.noSourceHash = noSourceHash;
    // One lookup for the whole mod: a snapshot of takes the store already has costs no copies.
    const stored = await findReferenceVoiceTakes(db, {
      game: snapshot.game,
      tgtLang: lang,
      keys: keyed,
    });
    for (const item of keyed) {
      if (!shouldReplaceReferenceVoiceTake(storedTakeOf(stored, item), item.line.voiceSimilarity)) {
        result.keptExisting += 1;
        continue;
      }
      const outcome = await saveReferenceVoiceTake(
        db,
        {
          game: snapshot.game,
          tgtLang: lang,
          sourceSha1: item.sourceSha1,
          ttsTextVersion: item.ttsTextVersion,
          takePath: path.join(snapshot.localizeDir, item.line.destRelPath),
          speakerKey: item.line.speakerKey,
          sourceText: item.line.sourceText,
          translation: item.line.translation,
          voiceSimilarity: item.line.voiceSimilarity,
          originModName: snapshot.modName,
        },
        options,
      );
      if (outcome === 'saved') {
        result.saved += 1;
        // Two lines of one mod can share a key; the next one is judged against this take.
        stored.set(referenceVoiceTakeMapKey(item.sourceSha1, item.ttsTextVersion), {
          sourceSha1: item.sourceSha1,
          ttsTextVersion: item.ttsTextVersion,
          fileExt: referenceVoiceFileExt(item.line.destRelPath),
          voiceSimilarity: item.line.voiceSimilarity,
          absPath: '',
        });
      } else if (outcome === 'kept') result.keptExisting += 1;
      else result.failed += 1;
    }
  } catch (err) {
    log.warn(`Reference voice: snapshot of mod ${modId} aborted (${errorText(err)})`);
  }
  return result;
};

/**
 * Before a purge: keep the current takes of these mods, in every language they
 * were voiced in. The take files are still on disk here — their cleanup is
 * scheduled after the rows are gone. Never throws; returns the takes kept.
 */
export const snapshotModsVoiceToReference = async (db: Tx, modIds: number[]): Promise<number> => {
  let saved = 0;
  try {
    if (modIds.length === 0) return 0;
    const { rows } = await db.query<{ mod_id: number; target_lang: string }>(
      `SELECT DISTINCT mod_id, target_lang FROM voice_synthesis_state
        WHERE mod_id = ANY($1::int[]) ORDER BY mod_id, target_lang`,
      [modIds],
    );
    for (const row of rows) {
      saved += (await snapshotModVoiceToReference(db, row.mod_id, row.target_lang)).saved;
    }
    if (saved > 0) {
      log.info(`Reference voice: kept ${saved} take(s) from mods ${modIds.join(',')}`);
    }
  } catch (err) {
    log.warn(`Reference voice: snapshot before purge failed (${errorText(err)})`);
  }
  return saved;
};
