/**
 * Voice line listing and lazy FUZ/XWM → WAV preview for the mod editor.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Tx } from '../../db';
import { extractXwmFromFuzFile } from '../../formats/fuz';
import { log } from '../../logger';
import { CONFIG } from '../../config';
import {
  dedupeVoiceFiles,
  discoverVoiceFiles,
  resolveVoiceRootRel,
  type VoiceFileEntry,
} from '../../modWorkspace/discoverVoiceFiles';
import {
  INFO_NAM1_RECORD_PATHS,
  loadVoiceTranslations,
  voiceTranslationMapKey,
} from '../../modWorkspace/loadVoiceTranslations';
import { sanitizeDirName } from '../../modWorkspace/prepareModWorkspace';
import { voiceSpeakerKey } from '../../modWorkspace/speakerReferencePool';
import { PATHS } from '../../paths';
import { sha1Hex, sha1HexFile } from '../../utils/hash';
import { ensureDir } from '../../utils/file';
import { convertToFo4Wav } from '../../voice/ffmpegAudio';

export type VoiceLinePreview = {
  formidLower6: string;
  infoFormidHex: string | null;
  variant: number;
  fileName: string;
  source: string | null;
  translation: string | null;
};

export type VoiceSpeakerGroup = {
  key: string;
  displayName: string;
  lines: VoiceLinePreview[];
};

export type VoiceLinesListResult =
  | { ok: true; speakers: VoiceSpeakerGroup[]; totalLines: number }
  | {
      ok: false;
      reason: 'mod_not_found' | 'no_plugin_path' | 'plugin_missing' | 'no_voice_files';
      message: string;
    };

export type VoiceAudioResult =
  | { ok: true; wavPath: string }
  | {
      ok: false;
      reason:
        | 'mod_not_found'
        | 'no_plugin_path'
        | 'plugin_missing'
        | 'line_not_found'
        | 'source_missing'
        | 'convert_failed';
      message: string;
    };

/** Clean a voice directory name into a human-readable speaker label. */
const formatVoiceSpeakerLabel = (folderName: string): string => {
  let cleaned = folderName.replace(/Voice$/i, '');
  cleaned = cleaned.replace(/^NPC[FM]/i, '');
  if (cleaned.includes('_')) {
    cleaned = cleaned.substring(cleaned.lastIndexOf('_') + 1);
  }
  cleaned = cleaned.replace(/([a-z])([A-Z])/g, '$1 $2');
  cleaned = cleaned.replace(/([a-zA-Z])(\d)/g, '$1 $2');
  if (/^Player Voice (Female|Male) \d+$/i.test(cleaned.trim())) {
    return 'Player';
  }
  return cleaned.trim() || folderName;
};

type VoicePackageContext = {
  packageDir: string;
  pluginRel: string;
  pluginPath: string;
  localizeDir: string | null;
};

const normalizeRelPath = (relPath: string): string => relPath.replace(/\\/g, '/');

const resolveWorkspaceLocalizeDir = (modName: string): string | null => {
  const workingDir = process.env.MOD_WORKING_DIR?.trim();
  if (!workingDir) return null;
  const localizeDir = path.join(workingDir, sanitizeDirName(modName), 'localize');
  return fs.existsSync(localizeDir) ? localizeDir : null;
};

const resolveVoicePackageContext = (
  pluginPath: string,
  modName: string,
): VoicePackageContext | null => {
  if (!pluginPath || !fs.existsSync(pluginPath)) return null;

  const pluginDir = path.dirname(pluginPath);
  const pluginName = path.basename(pluginPath);
  const candidates: Array<{ packageDir: string; pluginRel: string }> = [
    { packageDir: pluginDir, pluginRel: pluginName },
  ];

  const pluginDirNorm = pluginDir.replace(/\\/g, '/');
  if (pluginDirNorm.endsWith('/Data')) {
    candidates.push({
      packageDir: path.dirname(pluginDir),
      pluginRel: normalizeRelPath(path.join('Data', pluginName)),
    });
  }

  for (const candidate of candidates) {
    const voiceRoot = path.join(
      candidate.packageDir,
      ...resolveVoiceRootRel(candidate.pluginRel).split('/'),
    );
    if (fs.existsSync(voiceRoot)) {
      return {
        ...candidate,
        pluginPath,
        localizeDir: resolveWorkspaceLocalizeDir(modName),
      };
    }
  }

  return {
    packageDir: pluginDir,
    pluginRel: pluginName,
    pluginPath,
    localizeDir: resolveWorkspaceLocalizeDir(modName),
  };
};

const loadVoiceSources = async (
  db: Tx,
  modId: number,
  srcLang: string,
): Promise<Map<string, { source: string; infoFormidHex: string }>> => {
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
         AND r.signature = 'INFO'
         AND r.path = ANY($3::text[])
     )
     SELECT formid_lower6, info_formid_hex, voice_variant, source
     FROM voiced
     ORDER BY formid_lower6, voice_variant`,
    [modId, srcLang, [...INFO_NAM1_RECORD_PATHS]],
  );

  const map = new Map<string, { source: string; infoFormidHex: string }>();
  for (const row of rows) {
    map.set(voiceTranslationMapKey(row.formid_lower6, row.voice_variant), {
      source: row.source,
      infoFormidHex: row.info_formid_hex,
    });
  }
  return map;
};

const loadSpeakerNamesFromDb = async (db: Tx, modId: number): Promise<Map<string, string>> => {
  const { rows } = await db.query<{ formid_lower6: string; speaker_name: string }>(
    `SELECT DISTINCT ON (UPPER(SUBSTRING(dn.info_formid_hex FROM 3)))
        UPPER(SUBSTRING(dn.info_formid_hex FROM 3)) AS formid_lower6,
        dn.speaker_name
     FROM dialog_nodes dn
     JOIN dialog_topics dt ON dt.id = dn.topic_id
     WHERE dt.mod_id = $1
       AND dn.speaker_name IS NOT NULL
       AND BTRIM(dn.speaker_name) <> ''
     ORDER BY UPPER(SUBSTRING(dn.info_formid_hex FROM 3)), dn.updated_at DESC`,
    [modId],
  );

  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(row.formid_lower6.toUpperCase(), row.speaker_name);
  }
  return map;
};

const discoverVoiceEntries = (ctx: VoicePackageContext): VoiceFileEntry[] =>
  dedupeVoiceFiles(discoverVoiceFiles(ctx.packageDir, ctx.pluginRel));

const findVoiceEntry = (
  entries: VoiceFileEntry[],
  formidLower6: string,
  variant: number,
): VoiceFileEntry | undefined =>
  entries.find(
    (entry) =>
      entry.formidLower6.toUpperCase() === formidLower6.toUpperCase() && entry.variant === variant,
  );

const cacheKeyForSource = async (sourcePath: string): Promise<string> => {
  const stat = fs.statSync(sourcePath);
  return sha1Hex(`${sourcePath}|${stat.mtimeMs}|${stat.size}`);
};

const convertAudioToPreviewWav = async (sourcePath: string, destWav: string): Promise<void> => {
  const ext = path.extname(sourcePath).toLowerCase();
  if (ext === '.wav') {
    await convertToFo4Wav(sourcePath, destWav);
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-preview-'));
  try {
    let ffmpegInput = sourcePath;
    if (ext === '.fuz') {
      const xwmPath = path.join(tempDir, 'audio.xwm');
      fs.writeFileSync(xwmPath, extractXwmFromFuzFile(sourcePath));
      ffmpegInput = xwmPath;
    }
    await convertToFo4Wav(ffmpegInput, destWav);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

/** List all voice lines for a mod, grouped by NPC speaker folder. */
export const listVoiceLinesForMod = async (
  db: Tx,
  modId: number,
  srcLang: string,
  targetLang: string,
): Promise<VoiceLinesListResult> => {
  const { rows } = await db.query<{ name: string; abs_path: string | null }>(
    `SELECT name, abs_path FROM mods WHERE id = $1`,
    [modId],
  );
  const mod = rows[0];
  if (!mod) {
    return { ok: false, reason: 'mod_not_found', message: 'Mod not found' };
  }
  if (!mod.abs_path) {
    return { ok: false, reason: 'no_plugin_path', message: 'Mod has no plugin path' };
  }

  const ctx = resolveVoicePackageContext(mod.abs_path, mod.name);
  if (!ctx) {
    return { ok: false, reason: 'plugin_missing', message: 'Plugin file not found on disk' };
  }

  const voiceFiles = discoverVoiceEntries(ctx);
  if (voiceFiles.length === 0) {
    return { ok: false, reason: 'no_voice_files', message: 'No voice files found for this mod' };
  }

  const voiceRootRel = resolveVoiceRootRel(ctx.pluginRel);
  const sources = await loadVoiceSources(db, modId, srcLang);
  const translations = await loadVoiceTranslations(
    db,
    modId,
    srcLang,
    targetLang || CONFIG.defaultTgtLang,
  );
  const dbSpeakerNames = await loadSpeakerNamesFromDb(db, modId);

  const groups = new Map<string, VoiceSpeakerGroup>();

  for (const entry of voiceFiles) {
    const mapKey = voiceTranslationMapKey(entry.formidLower6, entry.variant);
    const sourceRow = sources.get(mapKey);
    const translationRow = translations.get(mapKey);
    const speakerKey = voiceSpeakerKey(entry, voiceRootRel) || 'Unknown';
    const dbSpeaker = dbSpeakerNames.get(entry.formidLower6.toUpperCase());
    const displayName = dbSpeaker || formatVoiceSpeakerLabel(speakerKey);

    let group = groups.get(speakerKey);
    if (!group) {
      group = { key: speakerKey, displayName, lines: [] };
      groups.set(speakerKey, group);
    }

    group.lines.push({
      formidLower6: entry.formidLower6,
      infoFormidHex: sourceRow?.infoFormidHex ?? translationRow?.infoFormidHex ?? null,
      variant: entry.variant,
      fileName: entry.fileName,
      source: sourceRow?.source ?? translationRow?.source ?? null,
      translation: translationRow?.translation ?? null,
    });
  }

  const speakers = [...groups.values()]
    .map((group) => ({
      ...group,
      lines: group.lines.sort((a, b) => {
        const formidCmp = a.formidLower6.localeCompare(b.formidLower6);
        return formidCmp !== 0 ? formidCmp : a.variant - b.variant;
      }),
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }));

  const totalLines = speakers.reduce((sum, group) => sum + group.lines.length, 0);
  log.debug(`Voice list mod=${modId}: ${totalLines} lines in ${speakers.length} speaker groups`);
  return { ok: true, speakers, totalLines };
};

/** Resolve or create a cached browser-playable WAV for one voice line. */
export const getVoicePreviewWav = async (
  db: Tx,
  modId: number,
  formidLower6: string,
  variant: number,
): Promise<VoiceAudioResult> => {
  const { rows } = await db.query<{ name: string; abs_path: string | null }>(
    `SELECT name, abs_path FROM mods WHERE id = $1`,
    [modId],
  );
  const mod = rows[0];
  if (!mod) {
    return { ok: false, reason: 'mod_not_found', message: 'Mod not found' };
  }
  if (!mod.abs_path) {
    return { ok: false, reason: 'no_plugin_path', message: 'Mod has no plugin path' };
  }

  const ctx = resolveVoicePackageContext(mod.abs_path, mod.name);
  if (!ctx) {
    return { ok: false, reason: 'plugin_missing', message: 'Plugin file not found on disk' };
  }

  const entry = findVoiceEntry(discoverVoiceEntries(ctx), formidLower6, variant);
  if (!entry) {
    return { ok: false, reason: 'line_not_found', message: 'Voice line not found' };
  }
  if (!fs.existsSync(entry.absolutePath)) {
    return { ok: false, reason: 'source_missing', message: 'Voice source file is missing' };
  }

  const digest = await cacheKeyForSource(entry.absolutePath);
  const cacheDir = path.join(PATHS.voicePreview, String(modId));
  const cachedWav = path.join(cacheDir, `${digest}.wav`);

  if (fs.existsSync(cachedWav)) {
    const sourceDigest = await sha1HexFile(entry.absolutePath);
    const markerPath = path.join(cacheDir, `${digest}.source`);
    const marker = fs.existsSync(markerPath) ? fs.readFileSync(markerPath, 'utf8').trim() : '';
    if (marker === sourceDigest) {
      return { ok: true, wavPath: cachedWav };
    }
  }

  ensureDir(cacheDir);
  try {
    await convertAudioToPreviewWav(entry.absolutePath, cachedWav);
    const sourceDigest = await sha1HexFile(entry.absolutePath);
    fs.writeFileSync(path.join(cacheDir, `${digest}.source`), sourceDigest);
    return { ok: true, wavPath: cachedWav };
  } catch (err) {
    log.warn(
      `Voice preview convert failed mod=${modId} ${formidLower6}_${variant}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return {
      ok: false,
      reason: 'convert_failed',
      message: err instanceof Error ? err.message : String(err),
    };
  }
};
