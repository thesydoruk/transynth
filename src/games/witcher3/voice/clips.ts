/**
 * Index a Witcher 3 upload's voice into `voice_clips`.
 *
 * A take is a row of a `<lang>pc.w3speech` container, and its string id is the
 * id of the line's text — so the join is exact, no inference. The clip's
 * `rel_path` names the container and the row (`content/content0/enpc.w3speech#1185686`),
 * since the take has no file of its own.
 *
 * Clips start with the speaker `unknown`; the scene files then name the voice
 * tag that says each one (see `speakers.ts`), and a take the scenes do not
 * cover stays `unknown`.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../../../db';
import { CONFIG } from '../../../config';
import { listW3SpeechFiles, type W3LanguageFile } from '../packLayout';
import { readW3SpeechIndex } from '../w3speech';
import { parseW3RecordPath, W3_RECORD_SIGNATURES } from '../import/tables';

export const W3_UNKNOWN_SPEAKER = 'unknown';

/** `rel_path` of one take: its container, `#`, its string id. */
export const w3ClipRelPath = (container: W3LanguageFile, id: number): string =>
  `${container.contentDir ? `${container.contentDir}/` : ''}${path.basename(container.absPath)}#${id}`;

/** Inverse of {@link w3ClipRelPath}. */
export const parseW3ClipRelPath = (relPath: string): { container: string; id: number } | null => {
  const hash = relPath.lastIndexOf('#');
  if (hash < 0) return null;
  const id = Number(relPath.slice(hash + 1));
  return Number.isInteger(id) && id >= 0 ? { container: relPath.slice(0, hash), id } : null;
};

type RecordRef = { recordId: number; stringId: number; contentDir: string };

/** Source-language rows of the mod, by string id; a take prefers the table beside it. */
const loadRecordsById = async (
  db: Tx,
  modId: number,
  lang: string,
): Promise<Map<number, RecordRef[]>> => {
  const { rows } = await db.query<{ record_id: number; string_id: number; path: string }>(
    `SELECT r.id AS record_id, s.id AS string_id, r.path
     FROM records r
     JOIN strings s ON s.record_id = r.id AND s.lang = $3
     WHERE r.mod_id = $1 AND r.signature = ANY($2::text[])`,
    [modId, [...W3_RECORD_SIGNATURES], lang],
  );
  const byId = new Map<number, RecordRef[]>();
  for (const row of rows) {
    const parsed = parseW3RecordPath(row.path);
    if (!parsed) continue;
    const list = byId.get(parsed.id) ?? [];
    list.push({ recordId: row.record_id, stringId: row.string_id, contentDir: parsed.contentDir });
    byId.set(parsed.id, list);
  }
  return byId;
};

export type W3ClipRow = {
  relPath: string;
  lineKey: string;
  recordId: number | null;
  stringId: number | null;
  container: string;
};

/** Clip rows for every take of `containers`, linked to the line each one speaks. */
export const buildW3ClipRows = (
  containers: readonly W3LanguageFile[],
  recordsById: ReadonlyMap<number, RecordRef[]>,
): W3ClipRow[] => {
  const rows: W3ClipRow[] = [];
  for (const container of containers) {
    const fd = fs.openSync(container.absPath, 'r');
    try {
      for (const row of readW3SpeechIndex(fd).rows) {
        const refs = recordsById.get(row.id) ?? [];
        const ref = refs.find((r) => r.contentDir === container.contentDir) ?? refs[0];
        const relPath = w3ClipRelPath(container, row.id);
        rows.push({
          relPath,
          lineKey: String(row.id),
          recordId: ref?.recordId ?? null,
          stringId: ref?.stringId ?? null,
          container: relPath.slice(0, relPath.lastIndexOf('#')),
        });
      }
    } finally {
      fs.closeSync(fd);
    }
  }
  return rows;
};

/** Replace the mod's clip rows with the takes of its `speechLang` voice. */
export const persistW3VoiceClips = async (
  db: Tx,
  modId: number,
  extractRoot: string,
  speechLang: string,
  storedLang: string,
): Promise<{ clips: number; linked: number }> => {
  await db.query(`DELETE FROM voice_clips WHERE mod_id = $1`, [modId]);
  const containers = listW3SpeechFiles(extractRoot).filter((file) => file.lang === speechLang);
  if (containers.length === 0) return { clips: 0, linked: 0 };

  const rows = buildW3ClipRows(containers, await loadRecordsById(db, modId, storedLang));
  for (let i = 0; i < rows.length; i += CONFIG.dbChunkSize) {
    const slice = rows.slice(i, i + CONFIG.dbChunkSize);
    await db.query(
      `INSERT INTO voice_clips(
         mod_id, rel_path, speaker_key, line_key, variant, clip_key, string_id, record_id, game_data
       )
       SELECT $1, u.rel_path, $2, u.line_key, 1, u.line_key, u.string_id, u.record_id,
              jsonb_build_object('container', u.container)
       FROM UNNEST($3::text[], $4::text[], $5::int[], $6::int[], $7::text[])
         AS u(rel_path, line_key, string_id, record_id, container)
       ON CONFLICT (mod_id, rel_path) DO NOTHING`,
      [
        modId,
        W3_UNKNOWN_SPEAKER,
        slice.map((row) => row.relPath),
        slice.map((row) => row.lineKey),
        slice.map((row) => row.stringId),
        slice.map((row) => row.recordId),
        slice.map((row) => row.container),
      ],
    );
  }
  return { clips: rows.length, linked: rows.filter((row) => row.recordId !== null).length };
};
