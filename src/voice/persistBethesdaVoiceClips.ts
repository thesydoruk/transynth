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
): Promise<
  Array<{ formidLower6: string; formidHex: string; stringId: number; ordinal: number }>
> => {
  const { rows } = await db.query<{
    formid_lower6: string;
    info_formid_hex: string;
    string_id: number;
    voice_ordinal: number;
  }>(
    `WITH voiced AS (
       SELECT
         UPPER(SUBSTRING(r.formid_hex FROM 3)) AS formid_lower6,
         r.formid_hex AS info_formid_hex,
         s.id AS string_id,
         ROW_NUMBER() OVER (PARTITION BY r.id ORDER BY s.id)::int AS voice_ordinal
       FROM records r
       JOIN strings s ON s.record_id = r.id AND s.lang = $2
       WHERE r.mod_id = $1
         AND ${infoNam1RecordsSql('r', '$3')}
     )
     SELECT formid_lower6, info_formid_hex, string_id, voice_ordinal
     FROM voiced
     ORDER BY formid_lower6, voice_ordinal`,
    [modId, srcLang, [...INFO_NAM1_RECORD_PATHS]],
  );
  return rows.map((row) => ({
    formidLower6: row.formid_lower6.toUpperCase(),
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
    const key = voiceTranslationMapKey(row.formidLower6, variant);
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
      `INSERT INTO voice_clips(
         mod_id, speaker_key, formid_lower6, variant, formid_hex,
         string_id, rel_path, shared_from_formid
       )
       SELECT $1, * FROM UNNEST(
         $2::text[], $3::text[], $4::int[], $5::text[],
         $6::int[], $7::text[], $8::text[]
       )`,
      [
        modId,
        part.map((row) => row.speakerKey),
        part.map((row) => row.formidLower6),
        part.map((row) => row.variant),
        part.map((row) => row.formidHex),
        part.map((row) => row.stringId),
        part.map((row) => row.relPath),
        part.map((row) => row.sharedFromFormid),
      ],
    );
  }
  return rows.length;
};

export const countBethesdaVoiceClips = async (db: Tx, modId: number): Promise<number> => {
  const { rows } = await db.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM voice_clips WHERE mod_id = $1`,
    [modId],
  );
  return Number(rows[0]?.n ?? 0);
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

/** Build clip rows when this mod has none yet (existing imports / first page open). */
export const ensureBethesdaVoiceClips = async (
  db: Tx,
  modId: number,
  srcLang = CONFIG.defaultSrcLang,
): Promise<PersistBethesdaVoiceClipsResult> => {
  const existing = await countBethesdaVoiceClips(db, modId);
  if (existing > 0) return { clips: existing, variants: 0 };
  return persistBethesdaVoiceClips(db, modId, srcLang, { hashSourceFiles: false });
};
