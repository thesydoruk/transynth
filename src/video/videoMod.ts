/**
 * The videos of a game as a mod.
 *
 * Every transcribed phrase becomes a record with one source string, so the
 * translation pipeline that exists for mods — TM, LLM, verify, the editor, the
 * glossary, the reference base — applies to narration unchanged. One mod per
 * game holds all its videos (origin `video`, no Vortex group); the records of
 * one video share a FormID prefix made of the asset id, and the EDID names the
 * video and the phrase for the editor.
 */
import type { Tx } from '../db';
import { bulkInsertRecordImportRows } from '../import/bulk/recordImport';
import { log } from '../logger';
import type { GameId } from '../types';
import { normalizeForHash } from '../utils/textNorm';
import type { VideoPhrase } from './segments';

export const VIDEO_MOD_NAME = 'Video';

/** Narration reads like dialogue: the dialog prompt family and the editor's dialogue view. */
const VIDEO_RECORD_SIGNATURE = 'INFO';
const VIDEO_RECORD_PATH = 'INFO\\NAM1';

export const videoFormIdPrefix = (videoId: number): string =>
  videoId.toString(16).toUpperCase().padStart(4, '0');

export const videoPhraseFormId = (videoId: number, idx: number): string =>
  `${videoFormIdPrefix(videoId)}${idx.toString(16).toUpperCase().padStart(4, '0')}`;

export const videoPhraseEdid = (fileName: string, idx: number): string =>
  `${fileName.replace(/\.[^.]+$/, '')}#${String(idx).padStart(3, '0')}`;

/** The game's Video mod, created on first use. */
export const ensureVideoMod = async (db: Tx, game: GameId): Promise<number> => {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO mods (name, abs_path, version_hash, game, origin)
     VALUES ($1, $2, $3, $4, 'video')
     ON CONFLICT (name, version_hash) WHERE vortex_group_id IS NULL
     DO UPDATE SET game = EXCLUDED.game
     RETURNING id`,
    [VIDEO_MOD_NAME, `video/${game}`, `video:${game}`, game],
  );
  return rows[0]!.id;
};

type ExistingString = { formid_hex: string; string_id: number; text_norm: string };

/**
 * Write a video's phrases into the mod and return the string id of each phrase.
 *
 * A phrase whose source text did not change keeps its string, and with it the
 * translation and its review; a changed or new phrase gets a fresh string, and
 * phrases that disappeared take their records with them.
 */
export const writeVideoPhrasesToMod = async (
  db: Tx,
  opts: { modId: number; videoId: number; fileName: string; srcLang: string; tgtLang: string },
  phrases: readonly VideoPhrase[],
): Promise<Map<number, number>> => {
  const prefix = videoFormIdPrefix(opts.videoId);
  const { rows: existing } = await db.query<ExistingString>(
    `SELECT r.formid_hex, s.id AS string_id, s.text_norm
     FROM records r JOIN strings s ON s.record_id = r.id AND s.lang = $3
     WHERE r.mod_id = $1 AND r.signature = $4 AND r.formid_hex LIKE $2`,
    [opts.modId, `${prefix}%`, opts.srcLang, VIDEO_RECORD_SIGNATURE],
  );
  const byFormId = new Map(existing.map((row) => [row.formid_hex, row]));

  const stringIds = new Map<number, number>();
  const staleFormIds: string[] = [];
  const toInsert: VideoPhrase[] = [];
  const wanted = new Set<string>();
  for (const phrase of phrases) {
    const formId = videoPhraseFormId(opts.videoId, phrase.idx);
    wanted.add(formId);
    const old = byFormId.get(formId);
    if (old && old.text_norm === normalizeForHash(phrase.text)) {
      stringIds.set(phrase.idx, old.string_id);
    } else {
      if (old) staleFormIds.push(formId);
      toInsert.push(phrase);
    }
  }
  for (const formId of byFormId.keys()) if (!wanted.has(formId)) staleFormIds.push(formId);

  if (staleFormIds.length > 0) {
    await db.query(
      `DELETE FROM records WHERE mod_id = $1 AND signature = $3 AND formid_hex = ANY($2::text[])`,
      [opts.modId, staleFormIds, VIDEO_RECORD_SIGNATURE],
    );
  }
  if (toInsert.length > 0) {
    const inserted = await bulkInsertRecordImportRows(
      db,
      opts.modId,
      toInsert.map((phrase) => ({
        signature: VIDEO_RECORD_SIGNATURE,
        formId: videoPhraseFormId(opts.videoId, phrase.idx),
        edid: videoPhraseEdid(opts.fileName, phrase.idx),
        field: VIDEO_RECORD_PATH,
        source: phrase.text,
        target: '',
        status: 0,
      })),
      opts.srcLang,
      opts.tgtLang,
      { sourceKind: 'video', provenance: 'video' },
    );
    inserted.forEach((row, i) => stringIds.set(toInsert[i]!.idx, row.stringId));
  }
  log.info(
    `Video #${opts.videoId} ${opts.fileName}: ${phrases.length} phrase(s) in mod #${opts.modId}, ${toInsert.length} new, ${staleFormIds.length} dropped`,
  );
  return stringIds;
};
