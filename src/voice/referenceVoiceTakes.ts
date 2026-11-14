/**
 * Reference voice store: synthesized takes that outlive the mod they were made for.
 *
 * A take in a mod's `_localize_{hash}/{lang}/` tree dies with the mod, and its
 * stamp with it (`voice_synthesis_state` cascades). The store keeps a copy keyed
 * by what the take was made from — the original voice file's SHA-1 and the TTS
 * payload version — so a later import of the same line gets the audio back
 * without Fish Speech. It is to voice what `reference_translations` is to text.
 *
 * Rows live in `reference_voice_takes`, files under `_reference_voice/` in mod
 * storage (`referenceVoiceTakePath`).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';
import type { Tx } from '../db';
import { referenceGameKey } from '../games/referenceKey';
import { log } from '../logger';
import { referenceVoiceTakePath } from '../modStorage';

export type ReferenceVoiceTakeInput = {
  /** The mod's game id; folded into the reference game key here. */
  game: string | null | undefined;
  tgtLang: string;
  /** SHA-1 of the original (source-language) voice file. */
  sourceSha1: string;
  /** TTS payload version, as stored in `voice_synthesis_state.tts_text_version`. */
  ttsTextVersion: string;
  /** The synthesized take on disk; copied, never moved. */
  takePath: string;
  speakerKey?: string | null;
  sourceText?: string | null;
  translation?: string | null;
  voiceSimilarity?: number | null;
  originModName?: string | null;
};

/** `saved`: the store now holds this take. `kept`: it already held one at least as good. */
export type SaveReferenceVoiceTakeOutcome = 'saved' | 'kept' | 'failed';

export type StoredReferenceVoiceTake = {
  sourceSha1: string;
  ttsTextVersion: string;
  /** Extension with its dot, lower-cased. */
  fileExt: string;
  voiceSimilarity: number | null;
  /** Where the stored file is. */
  absPath: string;
};

/** Extension of a take path the way the store records it: `.fuz`, `.wav`. */
export const referenceVoiceFileExt = (takePath: string): string =>
  path.extname(takePath).toLowerCase();

export const referenceVoiceTakeMapKey = (sourceSha1: string, ttsTextVersion: string): string =>
  `${sourceSha1.toLowerCase()}:${ttsTextVersion.toLowerCase()}`;

/**
 * May a new take replace the stored one? Both were made from the same source
 * audio and the same text, so only the clone score tells them apart: the new
 * take wins when it scored strictly higher, or when the stored one has no score.
 * A new take without a score cannot prove anything and never replaces a row.
 */
export const shouldReplaceReferenceVoiceTake = (
  existing: { voiceSimilarity: number | null } | null | undefined,
  newSimilarity: number | null | undefined,
): boolean => {
  if (!existing) return true;
  if (newSimilarity == null) return false;
  if (existing.voiceSimilarity == null) return true;
  return newSimilarity > existing.voiceSimilarity;
};

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Stored takes for these (source SHA-1, payload version) pairs, keyed by
 * {@link referenceVoiceTakeMapKey}. A row whose file is gone is left out.
 */
export const findReferenceVoiceTakes = async (
  db: Tx,
  query: {
    game: string | null | undefined;
    tgtLang: string;
    keys: Array<{ sourceSha1: string; ttsTextVersion: string }>;
  },
): Promise<Map<string, StoredReferenceVoiceTake>> => {
  const out = new Map<string, StoredReferenceVoiceTake>();
  const game = referenceGameKey(query.game);
  const lang = query.tgtLang.trim().toLowerCase();
  const unique = new Map(
    query.keys.map((key) => [referenceVoiceTakeMapKey(key.sourceSha1, key.ttsTextVersion), key]),
  );
  const keys = [...unique.values()];
  for (let i = 0; i < keys.length; i += CONFIG.dbChunkSize) {
    const part = keys.slice(i, i + CONFIG.dbChunkSize);
    const { rows } = await db.query<{
      source_sha1: string;
      tts_text_version: string;
      file_ext: string;
      voice_similarity: number | string | null;
    }>(
      `SELECT r.source_sha1, r.tts_text_version, r.file_ext, r.voice_similarity
         FROM reference_voice_takes r
         JOIN UNNEST($3::text[], $4::text[]) AS k(source_sha1, tts_text_version)
           ON k.source_sha1 = r.source_sha1 AND k.tts_text_version = r.tts_text_version
        WHERE r.game = $1 AND r.tgt_lang = $2`,
      [
        game,
        lang,
        part.map((key) => key.sourceSha1.toLowerCase()),
        part.map((key) => key.ttsTextVersion.toLowerCase()),
      ],
    );
    for (const row of rows) {
      let absPath: string;
      try {
        absPath = referenceVoiceTakePath({
          game,
          lang,
          sourceSha1: row.source_sha1,
          ttsTextVersion: row.tts_text_version,
          fileExt: row.file_ext,
        });
      } catch {
        continue;
      }
      if (!fs.existsSync(absPath)) continue;
      out.set(referenceVoiceTakeMapKey(row.source_sha1, row.tts_text_version), {
        sourceSha1: row.source_sha1,
        ttsTextVersion: row.tts_text_version,
        fileExt: row.file_ext,
        voiceSimilarity: row.voice_similarity == null ? null : Number(row.voice_similarity),
        absPath,
      });
    }
  }
  return out;
};

/** Does the store hold anything for this game and language? Lets reuse skip hashing when not. */
export const hasReferenceVoiceTakes = async (
  db: Tx,
  game: string | null | undefined,
  tgtLang: string,
): Promise<boolean> => {
  const { rows } = await db.query(
    `SELECT 1 FROM reference_voice_takes WHERE game = $1 AND tgt_lang = $2 LIMIT 1`,
    [referenceGameKey(game), tgtLang.trim().toLowerCase()],
  );
  return rows.length > 0;
};

/** Copy through a temp file in the same directory, so a reader never sees half a take. */
const copyFileAtomic = async (from: string, to: string): Promise<void> => {
  await fs.promises.mkdir(path.dirname(to), { recursive: true });
  const temp = `${to}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.promises.copyFile(from, temp);
    await fs.promises.rename(temp, to);
  } catch (err) {
    await fs.promises.unlink(temp).catch(() => undefined);
    throw err;
  }
};

const saveReferenceVoiceTakeUnsafe = async (
  db: Tx,
  input: ReferenceVoiceTakeInput,
  options: { dryRun?: boolean },
): Promise<SaveReferenceVoiceTakeOutcome> => {
  const game = referenceGameKey(input.game);
  const lang = input.tgtLang.trim().toLowerCase();
  const sourceSha1 = input.sourceSha1.trim().toLowerCase();
  const ttsTextVersion = input.ttsTextVersion.trim().toLowerCase();
  const fileExt = referenceVoiceFileExt(input.takePath);
  const dest = referenceVoiceTakePath({ game, lang, sourceSha1, ttsTextVersion, fileExt });
  const newSimilarity = input.voiceSimilarity ?? null;

  const stat = await fs.promises.stat(input.takePath);
  if (!stat.isFile() || stat.size <= 0) throw new Error(`not a take file: ${input.takePath}`);

  const { rows } = await db.query<{ file_ext: string; voice_similarity: number | string | null }>(
    `SELECT file_ext, voice_similarity FROM reference_voice_takes
      WHERE game = $1 AND tgt_lang = $2 AND source_sha1 = $3 AND tts_text_version = $4`,
    [game, lang, sourceSha1, ttsTextVersion],
  );
  const row = rows[0];
  const oldPath = row
    ? referenceVoiceTakePath({ game, lang, sourceSha1, ttsTextVersion, fileExt: row.file_ext })
    : null;
  // A row whose file is gone holds nothing; any take may fill it.
  const existing =
    row && oldPath && fs.existsSync(oldPath)
      ? { voiceSimilarity: row.voice_similarity == null ? null : Number(row.voice_similarity) }
      : null;
  if (!shouldReplaceReferenceVoiceTake(existing, newSimilarity)) return 'kept';
  if (options.dryRun) return 'saved';

  await copyFileAtomic(input.takePath, dest);
  await db.query(
    `INSERT INTO reference_voice_takes (
       game, tgt_lang, source_sha1, tts_text_version, speaker_key, source_text, translation,
       file_ext, file_size, voice_similarity, origin_mod_name
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (game, tgt_lang, source_sha1, tts_text_version) DO UPDATE SET
       speaker_key = EXCLUDED.speaker_key,
       source_text = EXCLUDED.source_text,
       translation = EXCLUDED.translation,
       file_ext = EXCLUDED.file_ext,
       file_size = EXCLUDED.file_size,
       voice_similarity = EXCLUDED.voice_similarity,
       origin_mod_name = EXCLUDED.origin_mod_name,
       updated_at = NOW()`,
    [
      game,
      lang,
      sourceSha1,
      ttsTextVersion,
      input.speakerKey?.trim() ?? '',
      input.sourceText ?? null,
      input.translation ?? null,
      fileExt,
      stat.size,
      newSimilarity,
      input.originModName ?? null,
    ],
  );
  // The same key under another extension would be a file no row points at.
  if (oldPath && oldPath !== dest) await fs.promises.unlink(oldPath).catch(() => undefined);
  return 'saved';
};

/**
 * Keep a freshly synthesized take in the reference store. Never throws: the
 * take in the mod is already written, and losing the copy must not fail the
 * synthesis that made it.
 */
export const saveReferenceVoiceTake = async (
  db: Tx,
  input: ReferenceVoiceTakeInput,
  options: { dryRun?: boolean } = {},
): Promise<SaveReferenceVoiceTakeOutcome> => {
  try {
    return await saveReferenceVoiceTakeUnsafe(db, input, options);
  } catch (err) {
    log.warn(`Reference voice: could not keep ${input.takePath} (${errorText(err)})`);
    return 'failed';
  }
};
