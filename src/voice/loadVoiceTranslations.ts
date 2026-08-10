import type { Tx } from '../db';
import {
  loadModInfoVoiceResponseNumbers,
  voiceVariantFromOrdinal,
  type InfoVoiceResponseMap,
} from './infoResponseNumbers';

export type VoiceTranslationRow = {
  formidLower6: string;
  infoFormidHex: string;
  voiceVariant: number;
  stringId: number;
  translationId: number | null;
  status: string | null;
  translation: string;
  /** Valid stressed text for TTS when present and matching {@link translation}. */
  textStressed: string | null;
  stressSrcText: string | null;
  source: string;
  /** INFO EDID from `records.edid` — used e.g. for `CA_Interject_Stub_*` TTS skip. */
  edid: string | null;
};

/** INFO response lines imported as `INFO\NAM1` (multiple per INFO when voiced). */
export const INFO_NAM1_RECORD_PATHS = ['INFO\\NAM1', 'INFO/NAM1', 'NAM1'] as const;

/** SQL filter matching INFO NAM1 rows regardless of path storage format. */
export const infoNam1RecordsSql = (recordAlias: string, pathParam: string): string =>
  `${recordAlias}.signature = 'INFO'
   AND (
     ${recordAlias}.path = ANY(${pathParam}::text[])
     OR ${recordAlias}.path_simplified = 'NAM1'
     OR SPLIT_PART(REPLACE(${recordAlias}.path, '/', '\\'), '\\', -1) = 'NAM1'
   )`;

/** Map key for voice file `00002CBA_4.fuz` → formid lower-6 + variant (`002CBA:4`). */
export const voiceTranslationMapKey = (formidLower6: string, variant: number): string =>
  `${formidLower6.toUpperCase()}:${variant}`;

/** Resolve a translated voice row for an exact FormID + variant (no sibling fallback). */
export const lookupVoiceTranslation = (
  translations: Map<string, VoiceTranslationRow>,
  formidLower6: string,
  variant: number,
): VoiceTranslationRow | undefined =>
  translations.get(voiceTranslationMapKey(formidLower6, variant));

const resolveVoiceVariant = (
  ordinal: number,
  infoFormidHex: string,
  responseMap: InfoVoiceResponseMap,
): number => voiceVariantFromOrdinal(ordinal, responseMap.get(infoFormidHex.toUpperCase()));

/**
 * Load translated INFO NAM1 lines keyed by lower-6 FormID + voice-file variant.
 *
 * SQL still numbers NAM1 rows with `ROW_NUMBER` (import order). Keys are then
 * remapped to FO4 `TRDA` response numbers so they match `<FormID>_<N>.fuz`.
 */
export const loadVoiceTranslations = async (
  db: Tx,
  modId: number,
  srcLang: string,
  tgtLang: string,
): Promise<Map<string, VoiceTranslationRow>> => {
  const responseMap = await loadModInfoVoiceResponseNumbers(db, modId);
  const { rows } = await db.query<{
    formid_lower6: string;
    info_formid_hex: string;
    voice_ordinal: number;
    string_id: number;
    translation_id: number | null;
    status: string | null;
    translation: string;
    text_stressed: string | null;
    stress_src_text: string | null;
    source: string;
    edid: string | null;
  }>(
    `WITH voiced AS (
       SELECT
         UPPER(SUBSTRING(r.formid_hex FROM 3)) AS formid_lower6,
         r.formid_hex AS info_formid_hex,
         r.edid,
         s.id AS string_id,
         s.text_raw AS source,
         ROW_NUMBER() OVER (PARTITION BY r.id ORDER BY s.id)::int AS voice_ordinal
       FROM records r
       JOIN strings s ON s.record_id = r.id AND s.lang = $2
       WHERE r.mod_id = $1
         AND ${infoNam1RecordsSql('r', '$4')}
     )
     SELECT v.formid_lower6,
            v.info_formid_hex,
            v.voice_ordinal,
            v.string_id,
            v.edid,
            v.source,
            t.id AS translation_id,
            t.status,
            t.text AS translation,
            t.text_stressed,
            t.stress_src_text
     FROM voiced v
     JOIN translations t
       ON t.src_string_id = v.string_id AND t.target_lang = $3
     WHERE t.text IS NOT NULL AND BTRIM(t.text) <> ''
     ORDER BY v.formid_lower6, v.voice_ordinal`,
    [modId, srcLang, tgtLang, [...INFO_NAM1_RECORD_PATHS]],
  );

  const map = new Map<string, VoiceTranslationRow>();
  for (const row of rows) {
    const voiceVariant = resolveVoiceVariant(row.voice_ordinal, row.info_formid_hex, responseMap);
    map.set(voiceTranslationMapKey(row.formid_lower6, voiceVariant), {
      formidLower6: row.formid_lower6,
      infoFormidHex: row.info_formid_hex,
      voiceVariant,
      stringId: row.string_id,
      translationId: row.translation_id,
      status: row.status,
      translation: row.translation,
      textStressed: row.text_stressed,
      stressSrcText: row.stress_src_text,
      source: row.source,
      edid: row.edid,
    });
  }
  return map;
};

export type VoiceSourceRow = {
  source: string;
};

export type VoiceSourceDetailRow = VoiceSourceRow & {
  infoFormidHex: string;
  stringId: number;
};

/** Trim voice text; whitespace-only values are treated as missing. */
export const normalizeVoiceText = (text: string | null | undefined): string | null => {
  const trimmed = text?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
};

/** Load INFO NAM1 source lines keyed by formid lower-6 + voice-file variant. */
export const loadVoiceSourcesDetailed = async (
  db: Tx,
  modId: number,
  srcLang: string,
): Promise<Map<string, VoiceSourceDetailRow>> => {
  const responseMap = await loadModInfoVoiceResponseNumbers(db, modId);
  const { rows } = await db.query<{
    formid_lower6: string;
    info_formid_hex: string;
    voice_ordinal: number;
    string_id: number;
    source: string;
  }>(
    `WITH voiced AS (
       SELECT
         UPPER(SUBSTRING(r.formid_hex FROM 3)) AS formid_lower6,
         r.formid_hex AS info_formid_hex,
         s.id AS string_id,
         s.text_raw AS source,
         ROW_NUMBER() OVER (PARTITION BY r.id ORDER BY s.id)::int AS voice_ordinal
       FROM records r
       JOIN strings s ON s.record_id = r.id AND s.lang = $2
       WHERE r.mod_id = $1
         AND ${infoNam1RecordsSql('r', '$3')}
     )
     SELECT formid_lower6, info_formid_hex, voice_ordinal, string_id, source
     FROM voiced
     ORDER BY formid_lower6, voice_ordinal`,
    [modId, srcLang, [...INFO_NAM1_RECORD_PATHS]],
  );

  const map = new Map<string, VoiceSourceDetailRow>();
  for (const row of rows) {
    const source = normalizeVoiceText(row.source);
    if (!source) continue;
    const voiceVariant = resolveVoiceVariant(row.voice_ordinal, row.info_formid_hex, responseMap);
    map.set(voiceTranslationMapKey(row.formid_lower6, voiceVariant), {
      source,
      infoFormidHex: row.info_formid_hex,
      stringId: row.string_id,
    });
  }
  return map;
};

/** Load English INFO NAM1 source lines keyed by formid lower-6 + voice variant. */
export const loadVoiceSources = async (
  db: Tx,
  modId: number,
  srcLang: string,
): Promise<Map<string, VoiceSourceRow>> => {
  const detailed = await loadVoiceSourcesDetailed(db, modId, srcLang);
  const map = new Map<string, VoiceSourceRow>();
  for (const [key, row] of detailed) {
    map.set(key, { source: row.source });
  }
  return map;
};

export const lookupVoiceSource = (
  sources: Map<string, VoiceSourceRow>,
  formidLower6: string,
  variant: number,
): string | null => sources.get(voiceTranslationMapKey(formidLower6, variant))?.source ?? null;
