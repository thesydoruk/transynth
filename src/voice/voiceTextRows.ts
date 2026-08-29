/**
 * Shared row shapes and SQL fragments for the text behind a voiced line.
 *
 * Voice files are named `<FormID>_<responseNumber>.fuz`, so every loader keys its
 * result by lower-6 FormID + response number (see {@link voiceTranslationMapKey}).
 *
 * Two record paths can carry the spoken text:
 *
 *   `INFO\NAM1` — the response line, used for both NPC and player dialogue
 *   `INFO\RNAM` — the dialogue-wheel prompt; it is what the player actually says
 *                 when the INFO has no `NAM1` of its own
 */

export type VoiceTranslationRow = {
  formidLower6: string;
  infoFormidHex: string;
  voiceVariant: number;
  stringId: number;
  translationId: number | null;
  status: string | null;
  translation: string;
  source: string;
  /** INFO EDID from `records.edid` — used e.g. for `CA_Interject_Stub_*` TTS skip. */
  edid: string | null;
};

export type VoiceSourceRow = {
  source: string;
};

export type VoiceSourceDetailRow = VoiceSourceRow & {
  infoFormidHex: string;
  stringId: number;
};

/** INFO response lines imported as `INFO\NAM1` (multiple per INFO when voiced). */
export const INFO_NAM1_RECORD_PATHS = ['INFO\\NAM1', 'INFO/NAM1', 'NAM1'] as const;

/** Player dialogue-wheel prompts imported as `INFO\RNAM`. */
export const INFO_PROMPT_RECORD_PATHS = ['INFO\\RNAM', 'INFO/RNAM', 'RNAM'] as const;

const infoSubrecordSql = (recordAlias: string, pathParam: string, subrecord: string): string =>
  `${recordAlias}.signature = 'INFO'
   AND (
     ${recordAlias}.path = ANY(${pathParam}::text[])
     OR ${recordAlias}.path_simplified = '${subrecord}'
     OR SPLIT_PART(REPLACE(${recordAlias}.path, '/', '\\'), '\\', -1) = '${subrecord}'
   )`;

/** SQL filter matching INFO NAM1 rows regardless of path storage format. */
export const infoNam1RecordsSql = (recordAlias: string, pathParam: string): string =>
  infoSubrecordSql(recordAlias, pathParam, 'NAM1');

/** SQL filter matching INFO RNAM (prompt) rows regardless of path storage format. */
export const infoPromptRecordsSql = (recordAlias: string, pathParam: string): string =>
  infoSubrecordSql(recordAlias, pathParam, 'RNAM');

/** Map key for voice file `00002CBA_4.fuz` → formid lower-6 + variant (`002CBA:4`). */
export const voiceTranslationMapKey = (formidLower6: string, variant: number): string =>
  `${formidLower6.toUpperCase()}:${variant}`;

/** Trim voice text; whitespace-only values are treated as missing. */
export const normalizeVoiceText = (text: string | null | undefined): string | null => {
  const trimmed = text?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
};

/** Copy entries from `extra` into `target` without overwriting existing keys. */
export const fillMissingVoiceKeys = <T>(target: Map<string, T>, extra: Map<string, T>): void => {
  for (const [key, row] of extra) {
    if (!target.has(key)) target.set(key, row);
  }
};

/** Guard against `DNAM` pointing in a loop or through a long chain of stubs. */
const MAX_SHARED_RESPONSE_HOPS = 8;

const resolveSharedSource = (
  alias: string,
  sharedFrom: Map<string, string>,
  keysByFormid: Map<string, string[]>,
): string | null => {
  let current = sharedFrom.get(alias);
  const seen = new Set<string>([alias]);
  for (let hop = 0; current != null && hop < MAX_SHARED_RESPONSE_HOPS; hop += 1) {
    if (seen.has(current)) return null;
    if (keysByFormid.has(current)) return current;
    seen.add(current);
    current = sharedFrom.get(current);
  }
  return null;
};

/**
 * Give INFOs that borrow their responses via `DNAM` the text of the INFO they
 * point at, so their own `.fuz` files stop looking orphaned.
 *
 * Existing keys are never overwritten — a record's own response always wins.
 */
export const expandSharedResponseAliases = <T>(
  map: Map<string, T>,
  sharedFrom: Map<string, string>,
): void => {
  if (sharedFrom.size === 0 || map.size === 0) return;

  const keysByFormid = new Map<string, string[]>();
  for (const key of map.keys()) {
    const formid = key.substring(0, key.indexOf(':'));
    const group = keysByFormid.get(formid);
    if (group) group.push(key);
    else keysByFormid.set(formid, [key]);
  }

  for (const alias of sharedFrom.keys()) {
    if (keysByFormid.has(alias)) continue;
    const source = resolveSharedSource(alias, sharedFrom, keysByFormid);
    if (!source) continue;
    for (const sourceKey of keysByFormid.get(source) ?? []) {
      const variant = sourceKey.substring(sourceKey.indexOf(':') + 1);
      const aliasKey = `${alias}:${variant}`;
      if (!map.has(aliasKey)) map.set(aliasKey, map.get(sourceKey)!);
    }
  }
};
