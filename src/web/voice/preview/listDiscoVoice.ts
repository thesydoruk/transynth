/**
 * Disco voice editor lists from `disco_voice_clips` (no pack-wide remap).
 */
import path from 'node:path';
import type { Tx } from '../../../db';
import { CONFIG } from '../../../config';
import { persistDiscoSpeakers } from '../../../import/mod/discoSpeakers';
import { resolveModStoredPath } from '../../../modStorage';
import {
  canSynthesizeVoiceLine,
  resolveVoiceLineSkipReason,
} from '../../../voice/prepareVoiceTtsText';
import { loadVoiceSpeakerRefs, voiceSpeakerRefMatches } from '../../../voice/voiceSpeakerRefs';
import { normalizeVoiceText } from '../../../voice/loadVoiceTranslations';
import { resolveDiscoVoiceExtractRoot } from '../../../voice/disco/discoverDiscoVoiceFiles';
import { loadDiscoVoiceClipSummaries } from '../../../voice/disco/loadVoiceClips';
import { ensureDiscoVoiceClips } from '../../../voice/disco/persistVoiceClips';
import { aggregateDiscoClipSpeakerCounts } from '../../../voice/disco/voiceClipRows';
import { sortSpeakers, sortVoiceLines } from './buildVoiceLinePreview';
import { resolveVoicePackageContext } from './context';
import { loadDiscoSpeakerGenders, loadDiscoSpeakerNames } from './discoVoiceList';
import { buildTranslationAudioSet, hasTranslationAudio } from './translationAudioIndex';
import type { VoiceLinePreview, VoiceSpeakerLinesResult, VoiceSpeakersListResult } from './types';

type DiscoVoiceMeta =
  | { ok: false; reason: 'mod_not_found' | 'no_plugin_path' | 'plugin_missing'; message: string }
  | {
      ok: true;
      extractRoot: string;
      localizeDir: string | null;
    };

const loadDiscoVoiceMeta = async (
  db: Tx,
  modId: number,
  targetLang: string,
): Promise<DiscoVoiceMeta> => {
  const { rows } = await db.query<{ abs_path: string | null; game: string | null }>(
    `SELECT abs_path, game FROM mods WHERE id = $1`,
    [modId],
  );
  const mod = rows[0];
  if (!mod) return { ok: false, reason: 'mod_not_found', message: 'Mod not found' };
  if ((mod.game ?? '').toLowerCase() !== 'disco') {
    return { ok: false, reason: 'mod_not_found', message: 'Not a Disco mod' };
  }
  if (!mod.abs_path)
    return { ok: false, reason: 'no_plugin_path', message: 'Mod has no plugin path' };

  const pluginPath = resolveModStoredPath(mod.abs_path);
  const ctx = resolveVoicePackageContext(pluginPath, targetLang);
  if (!ctx)
    return { ok: false, reason: 'plugin_missing', message: 'Plugin file not found on disk' };

  const extractRoot = resolveDiscoVoiceExtractRoot(pluginPath);
  if (!extractRoot) {
    return { ok: false, reason: 'plugin_missing', message: 'Disco pack root not found' };
  }
  return { ok: true, extractRoot, localizeDir: ctx.localizeDir };
};

const ensureDiscoVoiceRows = async (
  db: Tx,
  modId: number,
  extractRoot: string,
): Promise<number> => {
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

export const isDiscoMod = async (db: Tx, modId: number): Promise<boolean> => {
  const { rows } = await db.query<{ game: string | null }>(`SELECT game FROM mods WHERE id = $1`, [
    modId,
  ]);
  return (rows[0]?.game ?? '').toLowerCase() === 'disco';
};

export const listDiscoVoiceSpeakersForMod = async (
  db: Tx,
  modId: number,
  targetLang: string,
): Promise<VoiceSpeakersListResult> => {
  const resolvedTargetLang = targetLang || CONFIG.defaultTgtLang;
  const meta = await loadDiscoVoiceMeta(db, modId, resolvedTargetLang);
  if (!meta.ok) return meta;

  const clipCount = await ensureDiscoVoiceRows(db, modId, meta.extractRoot);
  if (clipCount === 0) {
    return { ok: false, reason: 'no_voice_files', message: 'No voice files found for this mod' };
  }

  const [clips, dbSpeakerNames, speakerRefs, folderGenders] = await Promise.all([
    loadDiscoVoiceClipSummaries(db, modId),
    loadDiscoSpeakerNames(db, modId),
    loadVoiceSpeakerRefs(db, modId),
    loadDiscoSpeakerGenders(db, modId),
  ]);
  const translationAudio = buildTranslationAudioSet(meta.localizeDir, { disco: true });
  const counts = aggregateDiscoClipSpeakerCounts(clips, translationAudio);

  const speakers = sortSpeakers(
    [...counts.entries()].map(([key, group]) => {
      const folderGender = folderGenders.get(key);
      return {
        key,
        displayName: dbSpeakerNames.get(key) || key,
        referencePick: speakerRefs[key] ?? null,
        gender: folderGender?.gender ?? 'unknown',
        genderMismatch: folderGender?.mismatch ?? false,
        lineCount: group.lineCount,
        dubbedCount: group.dubbedCount,
        orphanCount: group.orphanCount,
      };
    }),
  );

  const totalLines = speakers.reduce((sum, speaker) => sum + speaker.lineCount, 0);
  return { ok: true, speakers, totalLines };
};

type DiscoLineSqlRow = {
  wav_stem: string;
  formid_lower12: string;
  rel_path: string;
  record_id: number | null;
  string_id: number | null;
  source: string | null;
  translation_id: number | null;
  status: string | null;
  translation: string | null;
};

export const listDiscoVoiceLinesForSpeaker = async (
  db: Tx,
  modId: number,
  speakerKey: string,
  srcLang: string,
  targetLang: string,
): Promise<VoiceSpeakerLinesResult> => {
  const normalizedKey = speakerKey.trim();
  if (!normalizedKey) {
    return { ok: false, reason: 'speaker_not_found', message: 'Speaker not found' };
  }

  const resolvedTargetLang = targetLang || CONFIG.defaultTgtLang;
  const meta = await loadDiscoVoiceMeta(db, modId, resolvedTargetLang);
  if (!meta.ok) return meta;

  const clipCount = await ensureDiscoVoiceRows(db, modId, meta.extractRoot);
  if (clipCount === 0) {
    return { ok: false, reason: 'no_voice_files', message: 'No voice files found for this mod' };
  }

  const { rows } = await db.query<DiscoLineSqlRow>(
    `SELECT
       c.wav_stem,
       c.formid_lower12,
       c.rel_path,
       c.record_id,
       s.id AS string_id,
       s.text_raw AS source,
       t.id AS translation_id,
       t.status,
       t.text AS translation
     FROM disco_voice_clips c
     LEFT JOIN strings s ON s.record_id = c.record_id AND s.lang = $3
     LEFT JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $4
     WHERE c.mod_id = $1
       AND c.speaker_key = $2
     ORDER BY c.wav_stem`,
    [modId, normalizedKey, srcLang, resolvedTargetLang],
  );
  if (rows.length === 0) {
    return { ok: false, reason: 'speaker_not_found', message: 'Speaker not found' };
  }

  const speakerRefs = await loadVoiceSpeakerRefs(db, modId);
  const translationAudio = buildTranslationAudioSet(meta.localizeDir, { disco: true });
  const referencePick = speakerRefs[normalizedKey] ?? null;

  const lines: VoiceLinePreview[] = rows.map((row) => {
    const formidLower6 = row.formid_lower12.toUpperCase();
    const source = normalizeVoiceText(row.source);
    const translation = normalizeVoiceText(row.translation);
    const isOrphanAudio = row.record_id == null;
    const hasAudio = hasTranslationAudio(translationAudio, formidLower6, 1);
    const ttsSkipReason = resolveVoiceLineSkipReason(
      source,
      translation ?? '',
      row.wav_stem,
      'disco',
    );
    const synthesizable = canSynthesizeVoiceLine(source, translation ?? '', row.wav_stem, 'disco');
    return {
      formidLower6,
      infoFormidHex: formidLower6.padStart(8, '0'),
      variant: 1,
      fileName: path.basename(row.rel_path) || `${row.wav_stem}.wav`,
      speakerKey: normalizedKey,
      stringId: isOrphanAudio ? null : row.string_id,
      translationId: row.translation_id,
      status: row.status,
      source,
      translation,
      isReference: referencePick ? voiceSpeakerRefMatches(referencePick, formidLower6, 1) : false,
      isInheritedAudio: false,
      inheritedFrom: null,
      isOrphanAudio,
      hasTranslationAudio: hasAudio,
      canGenerateVoice: synthesizable && !hasAudio,
      ttsSkipReason,
    };
  });

  return { ok: true, speakerKey: normalizedKey, lines: sortVoiceLines(lines) };
};
