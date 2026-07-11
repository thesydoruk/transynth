import type { Tx } from '../db';

export type VoiceTranslationRow = {
  formidLower6: string;
  infoFormidHex: string;
  voiceVariant: number;
  translation: string;
  source: string;
};

/** INFO response lines imported as `INFO\NAM1` (multiple per INFO when voiced). */
export const INFO_NAM1_RECORD_PATHS = ['INFO\\NAM1', 'INFO/NAM1'] as const;

/** Map key for voice file `00002CBA_4.fuz` → formid lower-6 + variant (`002CBA:4`). */
export const voiceTranslationMapKey = (formidLower6: string, variant: number): string =>
  `${formidLower6.toUpperCase()}:${variant}`;

const bestTranslationOrder = (statusColumn: string): string => `CASE ${statusColumn}
  WHEN 'skip' THEN 0
  WHEN 'draft' THEN 1
  WHEN 'reviewed' THEN 2
  WHEN 'human' THEN 3
  WHEN 'tm' THEN 4
  WHEN 'fuzzy' THEN 5
  WHEN 'auto' THEN 6
  WHEN 'rejected' THEN 7
  ELSE 8 END`;

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
  }>(
    `WITH voiced AS (
       SELECT
         UPPER(SUBSTRING(r.formid_hex FROM 3)) AS formid_lower6,
         r.formid_hex AS info_formid_hex,
         s.id AS string_id,
         s.text_raw AS source,
         ROW_NUMBER() OVER (PARTITION BY r.id ORDER BY s.id)::int AS voice_variant
       FROM records r
       JOIN strings s ON s.record_id = r.id AND s.lang = $2
       WHERE r.mod_id = $1
         AND r.signature = 'INFO'
         AND r.path = ANY($4::text[])
     )
     SELECT v.formid_lower6,
            v.info_formid_hex,
            v.voice_variant,
            v.source,
            t.text AS translation
     FROM voiced v
     JOIN LATERAL (
       SELECT text
       FROM translations
       WHERE src_string_id = v.string_id AND target_lang = $3
       ORDER BY ${bestTranslationOrder('status')}, COALESCE(confidence, 0) DESC, created_at DESC
       LIMIT 1
     ) t ON TRUE
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
    });
  }
  return map;
};

export type VoiceSourceRow = {
  source: string;
};

/** Load English INFO NAM1 source lines keyed by formid lower-6 + voice variant. */
export const loadVoiceSources = async (
  db: Tx,
  modId: number,
  srcLang: string,
): Promise<Map<string, VoiceSourceRow>> => {
  const { rows } = await db.query<{
    formid_lower6: string;
    voice_variant: number;
    source: string;
  }>(
    `WITH voiced AS (
       SELECT
         UPPER(SUBSTRING(r.formid_hex FROM 3)) AS formid_lower6,
         s.text_raw AS source,
         ROW_NUMBER() OVER (PARTITION BY r.id ORDER BY s.id)::int AS voice_variant
       FROM records r
       JOIN strings s ON s.record_id = r.id AND s.lang = $2
       WHERE r.mod_id = $1
         AND r.signature = 'INFO'
         AND r.path = ANY($3::text[])
     )
     SELECT formid_lower6, voice_variant, source
     FROM voiced
     ORDER BY formid_lower6, voice_variant`,
    [modId, srcLang, [...INFO_NAM1_RECORD_PATHS]],
  );

  const map = new Map<string, VoiceSourceRow>();
  for (const row of rows) {
    const source = row.source?.trim();
    if (!source) continue;
    map.set(voiceTranslationMapKey(row.formid_lower6, row.voice_variant), { source });
  }
  return map;
};

export const lookupVoiceSource = (
  sources: Map<string, VoiceSourceRow>,
  formidLower6: string,
  variant: number,
): string | null => sources.get(voiceTranslationMapKey(formidLower6, variant))?.source ?? null;
