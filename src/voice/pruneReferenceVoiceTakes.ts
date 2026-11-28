/**
 * Remove reference voice takes of lines TTS no longer speaks.
 *
 * The store keeps every synthesized take by what it was made from, and each
 * row remembers the source text and the translation. When the skip rules grow,
 * the takes made before stay — and would be handed back to the next import of
 * the same line if the rules were ever bypassed. A row without both texts
 * cannot be judged and is left alone; so is a companion interject stub, which
 * only the record's EDID gives away.
 */
import fs from 'node:fs';
import type { Tx } from '../db';
import { findGamePlugin } from '../games/registry';
import { referenceVoiceTakePath } from '../modStorage';
import { resolveVoiceLineSkipReason, type VoiceTtsSkipReason } from './prepareVoiceTtsText';
import { voiceTakesForGame } from './takeFormat';
import { removeVoiceTake } from './takeSidecars';

export type PruneReferenceVoiceTakesResult = {
  /** Rows with both texts, the ones that could be judged. */
  judged: number;
  /** Rows of lines the rules skip. */
  rows: number;
  bytes: number;
  byGame: Record<string, number>;
  byReason: Partial<Record<VoiceTtsSkipReason, number>>;
  /** Rows deleted and take files removed; both 0 on a dry run. */
  rowsRemoved: number;
  filesRemoved: number;
  samples: string[];
};

type Row = {
  game: string;
  source_sha1: string;
  tts_text_version: string;
  file_ext: string;
  file_size: string | number | null;
  source_text: string;
  translation: string;
};

const SAMPLE_LIMIT = 8;

export const pruneSkippedReferenceVoiceTakes = async (
  db: Tx,
  tgtLang: string,
  options: { apply?: boolean } = {},
): Promise<PruneReferenceVoiceTakesResult> => {
  const lang = tgtLang.trim().toLowerCase();
  const { rows } = await db.query<Row>(
    `SELECT game, source_sha1, tts_text_version, file_ext, file_size, source_text, translation
       FROM reference_voice_takes
      WHERE tgt_lang = $1 AND source_text IS NOT NULL AND translation IS NOT NULL
      ORDER BY game, source_sha1, tts_text_version`,
    [lang],
  );

  const result: PruneReferenceVoiceTakesResult = {
    judged: rows.length,
    rows: 0,
    bytes: 0,
    byGame: {},
    byReason: {},
    rowsRemoved: 0,
    filesRemoved: 0,
    samples: [],
  };
  for (const row of rows) {
    const markup = findGamePlugin(row.game)?.voice?.markupStyle;
    const reason = resolveVoiceLineSkipReason(row.source_text, row.translation, null, markup);
    if (!reason) continue;

    result.rows += 1;
    result.bytes += Number(row.file_size ?? 0);
    result.byGame[row.game] = (result.byGame[row.game] ?? 0) + 1;
    result.byReason[reason] = (result.byReason[reason] ?? 0) + 1;
    if (result.samples.length < SAMPLE_LIMIT) {
      result.samples.push(`${row.game} "${row.source_text}" → "${row.translation}"`);
    }
    if (!options.apply) continue;

    let takePath: string;
    try {
      takePath = referenceVoiceTakePath({
        game: row.game,
        lang,
        sourceSha1: row.source_sha1,
        ttsTextVersion: row.tts_text_version,
        fileExt: row.file_ext,
      });
    } catch {
      // A key that cannot be a path names no file of ours; its row is left for a person.
      continue;
    }
    if (fs.existsSync(takePath)) result.filesRemoved += 1;
    removeVoiceTake(takePath, voiceTakesForGame(row.game).sidecarExtensions);
    const deleted = await db.query(
      `DELETE FROM reference_voice_takes
        WHERE game = $1 AND tgt_lang = $2 AND source_sha1 = $3 AND tts_text_version = $4`,
      [row.game, lang, row.source_sha1, row.tts_text_version],
    );
    result.rowsRemoved += deleted.rowCount ?? 0;
  }
  return result;
};
