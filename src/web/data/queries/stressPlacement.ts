import type { Tx } from '../../../db';
import { withPgRetry } from '../../../db';
import type { ImportPackageContext } from '../../../modImport';
import { pluginRelPath } from '../../../modImport';
import { dedupeVoiceFiles, discoverVoiceFiles, resolveVoiceRootRel } from '../../../voice/discoverVoiceFiles';
import {
  loadVoiceTranslations,
  lookupVoiceTranslation,
  type VoiceTranslationRow,
} from '../../../voice/loadVoiceTranslations';
import { canSynthesizeVoiceLine } from '../../../voice/prepareVoiceTtsText';
import { voiceSpeakerKey } from '../../../voice/speakerReference';
import {
  isStressedTranslationCurrent,
  stressedMatchesSource,
} from '../../../voice/stressedTranslation';

export type StressPlaceRow = {
  translation_id: number;
  string_id: number;
  formid_lower6: string;
  voice_variant: number;
  translation: string;
  source: string;
  edid: string | null;
  text_stressed: string | null;
  stress_src_text: string | null;
};

export type ModStressPlaceScope = 'missing' | 'all';

const isStressPending = (row: VoiceTranslationRow): boolean =>
  !isStressedTranslationCurrent({
    translation: row.translation,
    textStressed: row.textStressed,
    stressSrcText: row.stressSrcText,
  });

const toStressPlaceRow = (row: VoiceTranslationRow): StressPlaceRow | null => {
  if (row.translationId == null) return null;
  return {
    translation_id: row.translationId,
    string_id: row.stringId,
    formid_lower6: row.formidLower6,
    voice_variant: row.voiceVariant,
    translation: row.translation,
    source: row.source,
    edid: row.edid,
    text_stressed: row.textStressed,
    stress_src_text: row.stressSrcText,
  };
};

/** Enumerate voiced lines that need Ukrainian stress marks (same scope as TTS). */
export async function* iterateStressPlaceCandidates(
  db: Tx,
  packages: readonly ImportPackageContext[],
  modId: number,
  srcLang: string,
  tgtLang: string,
  scope: ModStressPlaceScope,
  speakerKey?: string,
): AsyncGenerator<StressPlaceRow> {
  const translations = await withPgRetry(
    () => loadVoiceTranslations(db, modId, srcLang, tgtLang),
    { label: 'loadVoiceTranslations' },
  );
  const speakerFilter = speakerKey?.trim() || '';

  for (const pkg of packages) {
    const pluginRel = pluginRelPath(pkg.packageDir, pkg.pluginPath);
    const voiceRootRel = resolveVoiceRootRel(pluginRel);
    const voiceFiles = dedupeVoiceFiles(discoverVoiceFiles(pkg.packageDir, pluginRel));
    for (const entry of voiceFiles) {
      if (speakerFilter && voiceSpeakerKey(entry, voiceRootRel) !== speakerFilter) continue;
      const row = lookupVoiceTranslation(translations, entry.formidLower6, entry.variant);
      if (!row || !canSynthesizeVoiceLine(row.source, row.translation, row.edid)) continue;
      if (scope === 'missing' && !isStressPending(row)) continue;
      const mapped = toStressPlaceRow(row);
      if (mapped) yield mapped;
    }
  }
}

export const countStressPlaceWork = async (
  db: Tx,
  modId: number,
  packages: readonly ImportPackageContext[],
  srcLang: string,
  tgtLang: string,
  scope: ModStressPlaceScope,
  speakerKey?: string,
): Promise<number> => {
  let total = 0;
  for await (const _row of iterateStressPlaceCandidates(
    db,
    packages,
    modId,
    srcLang,
    tgtLang,
    scope,
    speakerKey,
  )) {
    total += 1;
  }
  return total;
};

export async function* iterateStressPlaceWorkUnits(
  db: Tx,
  opts: {
    modId: number;
    packages: readonly ImportPackageContext[];
    srcLang: string;
    tgtLang: string;
    scope: ModStressPlaceScope;
    speakerKey?: string;
    batchSize?: number;
  },
): AsyncGenerator<StressPlaceRow[]> {
  const batchSize = Math.max(1, opts.batchSize ?? 20);
  let buffer: StressPlaceRow[] = [];
  for await (const row of iterateStressPlaceCandidates(
    db,
    opts.packages,
    opts.modId,
    opts.srcLang,
    opts.tgtLang,
    opts.scope,
    opts.speakerKey,
  )) {
    buffer.push(row);
    if (buffer.length >= batchSize) {
      yield buffer;
      buffer = [];
    }
  }
  if (buffer.length > 0) yield buffer;
}

export const persistStressPlacementResults = async (
  db: Tx,
  rows: ReadonlyArray<{ translationId: number; textStressed: string; srcText: string }>,
): Promise<number> => {
  let saved = 0;
  for (const row of rows) {
    if (!stressedMatchesSource(row.textStressed, row.srcText)) continue;
    await withPgRetry(
      () =>
        db.query(
          `UPDATE translations
              SET text_stressed = $2,
                  stress_src_text = $3,
                  stress_source = 'llm',
                  updated_at = NOW()
            WHERE id = $1`,
          [row.translationId, row.textStressed, row.srcText],
        ),
      { label: 'persistStressPlacement' },
    );
    saved += 1;
  }
  return saved;
};

export const resetModStressPlaceState = async (
  db: Tx,
  modId: number,
  tgtLang: string,
): Promise<number> => {
  const { rowCount } = await withPgRetry(
    () =>
      db.query(
        `UPDATE translations t
            SET text_stressed = NULL,
                stress_src_text = NULL,
                stress_source = NULL,
                updated_at = NOW()
         FROM strings s
         JOIN records r ON r.id = s.record_id
        WHERE t.src_string_id = s.id
          AND r.mod_id = $1
          AND t.target_lang = $2
          AND t.text_stressed IS NOT NULL`,
        [modId, tgtLang],
      ),
    { label: 'resetModStressPlaceState' },
  );
  return rowCount ?? 0;
};

export const saveStressedTranslation = async (
  db: Tx,
  translationId: number,
  textStressed: string,
): Promise<{ textStressed: string | null }> => {
  const trimmed = textStressed.trim();
  if (!trimmed) {
    await db.query(
      `UPDATE translations
          SET text_stressed = NULL, stress_src_text = NULL, stress_source = NULL, updated_at = NOW()
        WHERE id = $1`,
      [translationId],
    );
    return { textStressed: null };
  }
  const { rows: currentRows } = await db.query<{ text: string }>(
    `SELECT text FROM translations WHERE id = $1`,
    [translationId],
  );
  const current = currentRows[0]?.text;
  if (current == null) {
    throw new Error(`Translation ${translationId} not found`);
  }
  if (!stressedMatchesSource(trimmed, current)) {
    throw new Error('Stressed text must match translation letters (only U+0301 marks allowed)');
  }
  const { rows } = await db.query<{ text_stressed: string | null }>(
    `UPDATE translations t
        SET text_stressed = $2,
            stress_src_text = t.text,
            stress_source = 'human',
            updated_at = NOW()
      WHERE t.id = $1
      RETURNING t.text_stressed`,
    [translationId, trimmed],
  );
  return { textStressed: rows[0]?.text_stressed ?? trimmed };
};
