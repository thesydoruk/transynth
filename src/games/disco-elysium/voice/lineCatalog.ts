/**
 * The editor's voice catalog for a Disco Elysium pack.
 *
 * Takes are loose `.wav` under `Audio/`, one per line, named after the lockit
 * key. The import records each clip in `voice_clips` together with the
 * record it belongs to, so the catalog is a single join rather than a tree walk.
 */
import type { Tx } from '../../../db';
import type { VoiceFileEntry } from '../../../voice/discoverVoiceFiles';
import type { VoiceLineCatalogResult } from '../../../voice/lineCatalog';
import {
  normalizeVoiceText,
  voiceTranslationMapKey,
  type VoiceSourceDetailRow,
  type VoiceTranslationRow,
} from '../../../voice/loadVoiceTranslations';
import { loadVoiceSpeakerRefs } from '../../../voice/voiceSpeakerRefs';
import { loadVoiceSimilarityMap } from '../../../voice/voiceSynthesisState';
import {
  fillVoiceLocalizeDirFromImport,
  resolveVoicePackageContext,
} from '../../../web/voice/preview/context';
import {
  buildTranslationAudioSet,
  hasTranslationAudio,
} from '../../../web/voice/preview/translationAudioIndex';
import { persistDiscoSpeakers } from '../import/speakers';
import {
  discoVoiceFileEntryFromClip,
  discoVoiceSpeakerKey,
  resolveDiscoPreferredLangFolder,
  resolveDiscoVoiceExtractRoot,
} from './discoverDiscoVoiceFiles';
import { loadDiscoVoiceClipSummaries } from './loadVoiceClips';
import { DISCO_VOICE_MARKUP } from './markup';
import { ensureDiscoVoiceClips } from './persistVoiceClips';
import { loadDiscoSpeakerGenders, loadDiscoSpeakerNames } from '../web/voiceList';
import { discoVoiceKeyFromFileName } from './takeFiles';

/** Text of every clip, joined to the record it was matched to at import. */
type ClipTextRow = {
  line_key: string;
  wav_stem: string;
  string_id: number | null;
  source: string | null;
  translation_id: number | null;
  status: string | null;
  translation: string | null;
};

/**
 * Make sure the clip rows exist. A pack imported before the voice index was
 * added, or re-extracted since, is indexed on first open of the voice tab.
 */
const ensureClipRows = async (db: Tx, modId: number, extractRoot: string): Promise<number> => {
  const clipCount = await ensureDiscoVoiceClips(db, modId, extractRoot);
  const { rows } = await db.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM dialog_speakers WHERE mod_id = $1`,
    [modId],
  );
  if (Number(rows[0]?.n ?? 0) === 0) {
    const summaries = await loadDiscoVoiceClipSummaries(db, modId);
    await persistDiscoSpeakers(
      db,
      modId,
      summaries.map((clip) => clip.wavStem),
    );
  }
  return clipCount;
};

const loadClipText = async (
  db: Tx,
  modId: number,
  srcLang: string,
  targetLang: string,
): Promise<{
  sources: Map<string, VoiceSourceDetailRow>;
  translations: Map<string, VoiceTranslationRow>;
  sourceFormids: Set<string>;
}> => {
  const { rows } = await db.query<ClipTextRow>(
    `SELECT
       c.line_key,
       c.clip_key AS wav_stem,
       s.id AS string_id,
       s.text_raw AS source,
       t.id AS translation_id,
       t.status,
       t.text AS translation
     FROM voice_clips c
     LEFT JOIN strings s ON s.record_id = c.record_id AND s.lang = $2
     LEFT JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $3
     WHERE c.mod_id = $1`,
    [modId, srcLang, targetLang],
  );

  const sources = new Map<string, VoiceSourceDetailRow>();
  const translations = new Map<string, VoiceTranslationRow>();
  const sourceFormids = new Set<string>();

  for (const row of rows) {
    const lineKey = row.line_key.toUpperCase();
    const key = voiceTranslationMapKey(lineKey, 1);
    const source = normalizeVoiceText(row.source) ?? '';
    if (row.string_id != null) {
      sourceFormids.add(lineKey);
      sources.set(key, {
        source,
        infoFormidHex: lineKey.padStart(8, '0'),
        stringId: row.string_id,
        // Disco has no EDID; the wav stem is the closest stable identifier.
        edid: row.wav_stem,
      });
    }
    if (row.string_id != null) {
      translations.set(key, {
        lineKey,
        infoFormidHex: lineKey.padStart(8, '0'),
        voiceVariant: 1,
        stringId: row.string_id,
        translationId: row.translation_id,
        status: row.status,
        translation: normalizeVoiceText(row.translation) ?? '',
        source,
        edid: row.wav_stem,
      });
    }
  }

  return { sources, translations, sourceFormids };
};

export const loadDiscoVoiceCatalog = async (
  db: Tx,
  request: { modId: number; pluginPath: string; srcLang: string; targetLang: string },
): Promise<VoiceLineCatalogResult> => {
  const { modId, pluginPath, srcLang, targetLang } = request;

  const ctx = resolveVoicePackageContext(pluginPath, targetLang);
  if (!ctx)
    return { ok: false, reason: 'plugin_missing', message: 'Plugin file not found on disk' };
  await fillVoiceLocalizeDirFromImport(db, modId, ctx);

  const extractRoot = resolveDiscoVoiceExtractRoot(pluginPath);
  if (!extractRoot) {
    return { ok: false, reason: 'no_voice_files', message: 'No voice files found for this mod' };
  }

  const clipCount = await ensureClipRows(db, modId, extractRoot);
  const langFolder = resolveDiscoPreferredLangFolder(extractRoot);
  if (clipCount === 0 || !langFolder) {
    return { ok: false, reason: 'no_voice_files', message: 'No voice files found for this mod' };
  }

  const [clips, text, dbSpeakerNames, speakerRefs, folderGenders, voiceSimilarities] =
    await Promise.all([
      loadDiscoVoiceClipSummaries(db, modId),
      loadClipText(db, modId, srcLang, targetLang),
      loadDiscoSpeakerNames(db, modId),
      loadVoiceSpeakerRefs(db, modId),
      loadDiscoSpeakerGenders(db, modId),
      loadVoiceSimilarityMap(db, modId, targetLang),
    ]);

  const voiceFiles: VoiceFileEntry[] = clips.map((clip) =>
    discoVoiceFileEntryFromClip(langFolder, clip),
  );
  const translationAudio = buildTranslationAudioSet(ctx.localizeDir, {
    voiceKeyFromFileName: discoVoiceKeyFromFileName,
  });

  return {
    ok: true,
    modId,
    ctx,
    voiceRootRel: 'Audio',
    voiceFiles,
    sources: text.sources,
    translations: text.translations,
    inheritedLookup: null,
    sourceFormids: text.sourceFormids,
    speakerRefs,
    folderGenders,
    voiceSimilarities,
    markupStyle: DISCO_VOICE_MARKUP,
    speakerKeyOf: discoVoiceSpeakerKey,
    speakerDisplayName: (speakerKey) => dbSpeakerNames.get(speakerKey) || speakerKey,
    hasLocalizedTake: (entry) =>
      hasTranslationAudio(translationAudio, entry.lineKey, entry.variant),
  };
};
