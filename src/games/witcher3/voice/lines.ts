/**
 * The voiced lines of a Witcher 3 mod with their text: one row per take,
 * joined through `voice_clips` to the source string and its translation.
 */
import type { Tx } from '../../../db';
import {
  normalizeVoiceText,
  voiceTranslationMapKey,
  type VoiceSourceDetailRow,
  type VoiceTranslationRow,
} from '../../../voice/loadVoiceTranslations';
import { parseW3ClipRelPath } from './clips';
import { W3_VOICE_VARIANT } from './takes';

export type W3VoiceLine = {
  id: number;
  /** The clip's `rel_path` (`…/enpc.w3speech#1185686`). */
  relPath: string;
  /** Package-relative container the take lives in. */
  container: string;
  speakerKey: string;
  stringId: number | null;
  source: string;
  translationId: number | null;
  status: string | null;
  translation: string;
};

export type W3VoiceLineFilter = {
  /** Only these voice keys (`1185686:1`). */
  onlyKeys?: ReadonlySet<string>;
  /** Only lines that have a non-empty translation. */
  translatedOnly?: boolean;
  /** Only this speaker's lines. */
  speakerKey?: string;
};

export const loadW3VoiceLines = async (
  db: Tx,
  modId: number,
  srcLang: string,
  targetLang: string,
  filter: W3VoiceLineFilter = {},
): Promise<W3VoiceLine[]> => {
  const { rows } = await db.query<{
    rel_path: string;
    speaker_key: string;
    string_id: number | null;
    source: string | null;
    translation_id: number | null;
    status: string | null;
    translation: string | null;
  }>(
    `SELECT c.rel_path, c.speaker_key, s.id AS string_id, s.text_raw AS source,
            t.id AS translation_id, t.status, t.text AS translation
     FROM voice_clips c
     LEFT JOIN strings s ON s.record_id = c.record_id AND s.lang = $2
     LEFT JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $3
     WHERE c.mod_id = $1 AND ($4::text IS NULL OR c.speaker_key = $4)
     ORDER BY c.rel_path`,
    [modId, srcLang, targetLang, filter.speakerKey ?? null],
  );
  const lines: W3VoiceLine[] = [];
  for (const row of rows) {
    const parsed = parseW3ClipRelPath(row.rel_path);
    if (!parsed) continue;
    const translation = normalizeVoiceText(row.translation) ?? '';
    if (filter.translatedOnly && !translation) continue;
    if (filter.onlyKeys && !filter.onlyKeys.has(`${parsed.id}:${W3_VOICE_VARIANT}`)) continue;
    lines.push({
      id: parsed.id,
      relPath: row.rel_path,
      container: parsed.container,
      speakerKey: row.speaker_key,
      stringId: row.string_id,
      source: normalizeVoiceText(row.source) ?? '',
      translationId: row.translation_id,
      status: row.status,
      translation,
    });
  }
  return lines;
};

/** The shared catalog's text maps, keyed `LINEKEY:variant`. */
export const w3VoiceTextMaps = (
  lines: readonly W3VoiceLine[],
): {
  sources: Map<string, VoiceSourceDetailRow>;
  translations: Map<string, VoiceTranslationRow>;
  sourceFormids: Set<string>;
} => {
  const sources = new Map<string, VoiceSourceDetailRow>();
  const translations = new Map<string, VoiceTranslationRow>();
  const sourceFormids = new Set<string>();
  for (const line of lines) {
    if (line.stringId == null) continue;
    const lineKey = String(line.id);
    const key = voiceTranslationMapKey(lineKey, W3_VOICE_VARIANT);
    sourceFormids.add(lineKey);
    sources.set(key, {
      source: line.source,
      infoFormidHex: lineKey,
      stringId: line.stringId,
      edid: lineKey,
    });
    translations.set(key, {
      lineKey,
      infoFormidHex: lineKey,
      voiceVariant: W3_VOICE_VARIANT,
      stringId: line.stringId,
      translationId: line.translationId,
      status: line.status,
      translation: line.translation,
      source: line.source,
      edid: lineKey,
    });
  }
  return { sources, translations, sourceFormids };
};
