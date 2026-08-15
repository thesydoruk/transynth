/**
 * Synthesize one Disco Final Cut voice line into localize Audio/.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Tx } from '../../db';
import { loadImportedMod } from '../../modImport/importedMod';
import { getJobRuntime } from '../../pipeline/jobRuntime';
import { ensureDependencyHealthy } from '../../pipeline/waitForHealthy';
import { checkTtsHealth } from '../../tts/ttsClient';
import { ensureDir } from '../../utils/file';
import { lookupVoiceTranslation } from '../loadVoiceTranslations';
import { canSynthesizeVoiceLine, prepareVoiceTtsText } from '../prepareVoiceTtsText';
import type { SynthesizeModVoiceLineResult } from '../synthesizeModVoiceLine';
import { loadVoiceProjectSettings } from '../voiceProjectSettings';
import { loadVoiceSynthesisVersionMap } from '../voiceSynthesisState';
import { resolveTtsBaseUrl } from '../voiceToolPaths';
import { discoverDiscoVoiceFiles, resolveDiscoVoiceExtractRoot } from './discoverDiscoVoiceFiles';
import { loadDiscoVoiceTranslations } from './loadDiscoVoiceTranslations';
import { processDiscoVoiceEntry } from './processDiscoVoiceEntry';

export type SynthesizeDiscoVoiceLineOptions = {
  modId: number;
  pluginPath: string;
  localizeDir: string;
  formidLower6: string;
  variant: number;
  srcLang: string;
  tgtLang: string;
  force?: boolean;
};

/** One-line Disco TTS for the voice editor. */
export const synthesizeDiscoVoiceLine = async (
  db: Tx,
  opts: SynthesizeDiscoVoiceLineOptions,
): Promise<SynthesizeModVoiceLineResult> => {
  const extractRoot = resolveDiscoVoiceExtractRoot(opts.pluginPath);
  if (!extractRoot) {
    return { ok: false, reason: 'line_not_found', message: 'Disco pack root not found' };
  }

  const entry = discoverDiscoVoiceFiles(extractRoot).find(
    (e) =>
      e.formidLower6.toUpperCase() === opts.formidLower6.toUpperCase() &&
      e.variant === opts.variant,
  );
  if (!entry) {
    return { ok: false, reason: 'line_not_found', message: 'Voice line not found' };
  }

  const translations = await loadDiscoVoiceTranslations(db, opts.modId, opts.srcLang, opts.tgtLang);
  const row = lookupVoiceTranslation(translations, entry.formidLower6, entry.variant);
  if (!row?.translation?.trim()) {
    return { ok: false, reason: 'no_translation', message: 'No translation for this voice line' };
  }
  if (!canSynthesizeVoiceLine(row.source, row.translation, row.edid)) {
    return { ok: false, reason: 'non_speech', message: 'Line is not synthesizable' };
  }

  const prepared = prepareVoiceTtsText({
    lineSource: row.source,
    translation: row.translation,
    speakerSource: row.source,
    edid: row.edid,
  });
  if (prepared.action !== 'synthesize') {
    return { ok: false, reason: 'non_speech', message: 'Line is not synthesizable' };
  }

  const voiceConfig = await loadVoiceProjectSettings(db);
  const ttsBaseUrl = resolveTtsBaseUrl();
  const mod = await loadImportedMod(db, opts.modId);
  if (getJobRuntime()) await ensureDependencyHealthy('tts');
  else await checkTtsHealth(ttsBaseUrl);

  ensureDir(opts.localizeDir);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'disco-voice-line-'));
  const storedVersions = await loadVoiceSynthesisVersionMap(db, opts.modId, opts.tgtLang);

  try {
    const result = await processDiscoVoiceEntry(entry, row, prepared, {
      db,
      modId: opts.modId,
      localizeDir: opts.localizeDir,
      tempRoot,
      game: mod.game,
      ttsBaseUrl,
      synthesis: voiceConfig.synthesis,
      tgtLang: opts.tgtLang,
      force: opts.force ?? true,
      storedVersions,
    });

    if (result.kind === 'warning') {
      return { ok: false, reason: 'tts_failed', message: result.message };
    }
    return { ok: true, relPath: result.relPath, skipped: result.kind === 'skipped' };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
};
