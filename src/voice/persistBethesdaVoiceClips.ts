/**
 * Persist Bethesda INFO response variants and per-speaker voice takes.
 *
 * `strings.voice_variant` is the TRDA / `.fuz` response number.
 * `voice_clips` is one row per speaker folder × that response (Nate/Nora stay
 * distinct). SHA-1 stays in `voice_source_file_hashes`.
 */
import type { Tx } from '../db';
import { CONFIG } from '../config';
import { log } from '../logger';
import { loadModImportPaths } from '../import/mod/resolvePaths';
import { pluginRelPath } from '../modImport/packages';
import { resolveModDirectoryFromPath } from '../formats/mcm';
import { dedupeVoiceFiles, discoverVoiceFiles, resolveVoiceRootRel } from './discoverVoiceFiles';
import { loadModInfoVoiceSlots, voiceVariantFromOrdinal } from './infoResponseNumbers';
import { loadVoicePromptSources } from './voicePromptText';
import {
  infoNam1RecordsSql,
  INFO_NAM1_RECORD_PATHS,
  voiceTranslationMapKey,
} from './voiceTextRows';
import { resolveVoiceSourceFileHashes } from './voiceSourceFileHashes';
import { buildVoiceClipRows, type VoiceClipRow, type VoiceClipStringRef } from './voiceClipRows';

const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

const loadNam1ClipStrings = async (
  db: Tx,
  modId: number,
  srcLang: string,
): Promise<Array<{ lineKey: string; formidHex: string; stringId: number; ordinal: number }>> => {
  const { rows } = await db.query<{
    line_key: string;
    info_formid_hex: string;
    string_id: number;
    voice_ordinal: number;
  }>(
    `WITH voiced AS (
       SELECT
         UPPER(SUBSTRING(r.formid_hex FROM 3)) AS line_key,
         r.formid_hex AS info_formid_hex,
         s.id AS string_id,
         ROW_NUMBER() OVER (PARTITION BY r.id ORDER BY s.id)::int AS voice_ordinal
       FROM records r
       JOIN strings s ON s.record_id = r.id AND s.lang = $2
       WHERE r.mod_id = $1
         AND ${infoNam1RecordsSql('r', '$3')}
     )
     SELECT line_key, info_formid_hex, string_id, voice_ordinal
     FROM voiced
     ORDER BY line_key, voice_ordinal`,
    [modId, srcLang, [...INFO_NAM1_RECORD_PATHS]],
  );
  return rows.map((row) => ({
    lineKey: row.line_key.toUpperCase(),
    formidHex: row.info_formid_hex,
    stringId: row.string_id,
    ordinal: row.voice_ordinal,
  }));
};

const collectClipStringRefs = async (
  db: Tx,
  modId: number,
  srcLang: string,
): Promise<{
  stringsByKey: Map<string, VoiceClipStringRef>;
  variantByStringId: Map<number, number>;
  sharedFrom: Map<string, string>;
}> => {
  const { responses, sharedFrom } = await loadModInfoVoiceSlots(db, modId);
  const nam1 = await loadNam1ClipStrings(db, modId, srcLang);
  const stringsByKey = new Map<string, VoiceClipStringRef>();
  const variantByStringId = new Map<number, number>();

  for (const row of nam1) {
    const variant = voiceVariantFromOrdinal(
      row.ordinal,
      responses.get(row.formidHex.toUpperCase()),
    );
    const key = voiceTranslationMapKey(row.lineKey, variant);
    if (!stringsByKey.has(key)) {
      stringsByKey.set(key, { stringId: row.stringId, formidHex: row.formidHex });
    }
    variantByStringId.set(row.stringId, variant);
  }

  for (const [key, row] of await loadVoicePromptSources(db, modId, srcLang)) {
    if (!stringsByKey.has(key)) {
      stringsByKey.set(key, { stringId: row.stringId, formidHex: row.infoFormidHex });
    }
    if (!variantByStringId.has(row.stringId)) {
      const colon = key.lastIndexOf(':');
      const variant = Number.parseInt(key.slice(colon + 1), 10);
      if (variant >= 1) variantByStringId.set(row.stringId, variant);
    }
  }

  return { stringsByKey, variantByStringId, sharedFrom };
};

const writeVoiceVariants = async (
  db: Tx,
  modId: number,
  variantByStringId: Map<number, number>,
): Promise<number> => {
  await db.query(
    `UPDATE strings s
        SET voice_variant = NULL
       FROM records r
      WHERE s.record_id = r.id
        AND r.mod_id = $1
        AND s.voice_variant IS NOT NULL`,
    [modId],
  );
  if (variantByStringId.size === 0) return 0;

  const ids = [...variantByStringId.keys()];
  const variants = ids.map((id) => variantByStringId.get(id)!);
  await db.query(
    `UPDATE strings AS s
        SET voice_variant = u.variant
       FROM UNNEST($1::int[], $2::int[]) AS u(id, variant)
      WHERE s.id = u.id`,
    [ids, variants],
  );
  return ids.length;
};

const replaceVoiceClips = async (db: Tx, modId: number, rows: VoiceClipRow[]): Promise<number> => {
  await db.query(`DELETE FROM voice_clips WHERE mod_id = $1`, [modId]);
  if (rows.length === 0) return 0;

  const batchSize = Math.max(1, CONFIG.dbChunkSize);
  for (const part of chunk(rows, batchSize)) {
    await db.query(
      // `formid_hex` and the DNAM alias source are Creation Engine's own
      // business, so they ride in `game_data` rather than widening the table
      // every game shares.
      `INSERT INTO voice_clips(
         mod_id, speaker_key, line_key, variant, string_id, rel_path, game_data
       )
       SELECT $1, u.speaker_key, u.line_key, u.variant, u.string_id, u.rel_path,
              jsonb_strip_nulls(jsonb_build_object(
                'formid_hex', u.formid_hex,
                'shared_from_formid', u.shared_from_formid))
         FROM UNNEST(
           $2::text[], $3::text[], $4::int[], $5::int[], $6::text[], $7::text[], $8::text[]
         ) AS u(speaker_key, line_key, variant, string_id, rel_path,
                formid_hex, shared_from_formid)`,
      [
        modId,
        part.map((row) => row.speakerKey),
        part.map((row) => row.lineKey),
        part.map((row) => row.variant),
        part.map((row) => row.stringId),
        part.map((row) => row.relPath),
        part.map((row) => row.formidHex),
        part.map((row) => row.sharedFromFormid),
      ],
    );
  }
  return rows.length;
};

export type PersistBethesdaVoiceClipsResult = {
  clips: number;
  variants: number;
};

export type PersistBethesdaVoiceClipsOptions = {
  /** Hash source `.fuz`/`.wav` into `voice_source_file_hashes`. Default true. */
  hashSourceFiles?: boolean;
};

/** Replace clip + variant rows for one Bethesda mod from the extract pack. */
export const persistBethesdaVoiceClips = async (
  db: Tx,
  modId: number,
  srcLang = CONFIG.defaultSrcLang,
  options: PersistBethesdaVoiceClipsOptions = {},
): Promise<PersistBethesdaVoiceClipsResult> => {
  const { stringsByKey, variantByStringId, sharedFrom } = await collectClipStringRefs(
    db,
    modId,
    srcLang,
  );
  const variants = await writeVoiceVariants(db, modId, variantByStringId);

  let paths;
  try {
    paths = await loadModImportPaths(db, { modId });
  } catch (err) {
    log.warn(
      `Voice clips: skip files for mod ${modId} (${err instanceof Error ? err.message : String(err)})`,
    );
    await db.query(`DELETE FROM voice_clips WHERE mod_id = $1`, [modId]);
    return { clips: 0, variants };
  }

  const packageDir = resolveModDirectoryFromPath(paths.pluginPath);
  const pluginRel = pluginRelPath(packageDir, paths.pluginPath);
  const voiceRootRel = resolveVoiceRootRel(pluginRel);
  const files = dedupeVoiceFiles(discoverVoiceFiles(packageDir, pluginRel));
  const clipRows = buildVoiceClipRows(files, voiceRootRel, stringsByKey, sharedFrom);
  const clips = await replaceVoiceClips(db, modId, clipRows);

  if (files.length > 0 && options.hashSourceFiles !== false) {
    try {
      await resolveVoiceSourceFileHashes(
        db,
        files.map((file) => ({
          modId,
          relPath: file.relPath,
          absPath: file.absolutePath,
        })),
      );
    } catch (err) {
      log.warn(
        `Voice clips: source hashes skipped for mod ${modId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  return { clips, variants };
};
