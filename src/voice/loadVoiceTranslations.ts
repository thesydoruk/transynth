import type { Tx } from '../db';

export type VoiceTranslationRow = {
  formidLower6: string;
  infoFormidHex: string;
  voiceVariant: number;
  translation: string;
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

/** Resolve a translated voice row; falls back to the closest variant for the same FormID. */
export const lookupVoiceTranslation = (
  translations: Map<string, VoiceTranslationRow>,
  formidLower6: string,
  variant: number,
): VoiceTranslationRow | undefined => {
  const exact = translations.get(voiceTranslationMapKey(formidLower6, variant));
  if (exact) return exact;

  const formid = formidLower6.toUpperCase();
  let best: VoiceTranslationRow | undefined;
  let bestDistance = Infinity;
  for (const row of translations.values()) {
    if (row.formidLower6.toUpperCase() !== formid) continue;
    const distance = Math.abs(row.voiceVariant - variant);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = row;
    }
  }
  return best;
};

/**
 * Load translated INFO NAM1 lines keyed by lower-6 FormID + voice variant.
 *
 * Multi-line INFO records share one `records` row but have several `strings` rows
 * (import order matches ESP NAM1 order). Voice assets use `<FormID>_<variant>.fuz`.
 */
export const loadVoiceTranslations = async (
  db: Tx,
  modId: number,
  srcLang: string,
  tgtLang: string,
): Promise<Map<string, VoiceTranslationRow>> => {
  const { rows } = await db.query<{
    formid_lower6: string;
    info_formid_hex: string;
    voice_variant: number;
    translation: string;
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
         ROW_NUMBER() OVER (PARTITION BY r.id ORDER BY s.id)::int AS voice_variant
       FROM records r
       JOIN strings s ON s.record_id = r.id AND s.lang = $2
       WHERE r.mod_id = $1
         AND ${infoNam1RecordsSql('r', '$4')}
     )
     SELECT v.formid_lower6,
            v.info_formid_hex,
            v.voice_variant,
            v.edid,
            v.source,
            t.text AS translation
     FROM voiced v
     JOIN translations t
       ON t.src_string_id = v.string_id AND t.target_lang = $3
     WHERE t.text IS NOT NULL AND BTRIM(t.text) <> ''
     ORDER BY v.formid_lower6, v.voice_variant`,
    [modId, srcLang, tgtLang, [...INFO_NAM1_RECORD_PATHS]],
  );

  const map = new Map<string, VoiceTranslationRow>();
  for (const row of rows) {
    map.set(voiceTranslationMapKey(row.formid_lower6, row.voice_variant), {
      formidLower6: row.formid_lower6,
      infoFormidHex: row.info_formid_hex,
      voiceVariant: row.voice_variant,
      translation: row.translation,
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
};

/** Trim voice text; whitespace-only values are treated as missing. */
export const normalizeVoiceText = (text: string | null | undefined): string | null => {
  const trimmed = text?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
};

/** Load INFO NAM1 source lines keyed by formid lower-6 + voice variant. */
export const loadVoiceSourcesDetailed = async (
  db: Tx,
  modId: number,
  srcLang: string,
): Promise<Map<string, VoiceSourceDetailRow>> => {
  const { rows } = await db.query<{
    formid_lower6: string;
    info_formid_hex: string;
    voice_variant: number;
    source: string;
  }>(
    `WITH voiced AS (
       SELECT
         UPPER(SUBSTRING(r.formid_hex FROM 3)) AS formid_lower6,
         r.formid_hex AS info_formid_hex,
         s.text_raw AS source,
         ROW_NUMBER() OVER (PARTITION BY r.id ORDER BY s.id)::int AS voice_variant
       FROM records r
       JOIN strings s ON s.record_id = r.id AND s.lang = $2
       WHERE r.mod_id = $1
         AND ${infoNam1RecordsSql('r', '$3')}
     )
     SELECT formid_lower6, info_formid_hex, voice_variant, source
     FROM voiced
     ORDER BY formid_lower6, voice_variant`,
    [modId, srcLang, [...INFO_NAM1_RECORD_PATHS]],
  );

  const map = new Map<string, VoiceSourceDetailRow>();
  for (const row of rows) {
    const source = normalizeVoiceText(row.source);
    if (!source) continue;
    map.set(voiceTranslationMapKey(row.formid_lower6, row.voice_variant), {
      source,
      infoFormidHex: row.info_formid_hex,
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
