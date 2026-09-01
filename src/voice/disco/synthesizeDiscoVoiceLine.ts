/**
 * Synthesize one Disco Final Cut voice line into localize Audio/.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Tx } from '../../db';
import { toDiskPath } from '../../modImport';
import { loadImportedMod } from '../../modImport/importedMod';
import { getJobRuntime } from '../../pipeline/jobRuntime';
import { ensureDependencyHealthy } from '../../pipeline/waitForHealthy';
import { checkTtsHealth } from '../../tts/ttsClient';
import { ensureDir } from '../../utils/file';
import { lookupVoiceTranslation } from '../loadVoiceTranslations';
import { canSynthesizeVoiceLine, prepareVoiceTtsText } from '../prepareVoiceTtsText';
import type { SpeakerRefCacheEntry } from '../pickVoiceTtsReference';
import type { SynthesizeModVoiceLineResult } from '../synthesizeModVoiceLine';
import { loadVoiceProjectSettings } from '../voiceProjectSettings';
import { loadVoiceSynthesisVersionMap } from '../voiceSynthesisState';
import { voiceTtsPayloadVersionFromPrepared } from '../voiceTtsPayloadVersion';
import { resolveTtsBaseUrl, type TtsReferenceMode } from '../voiceToolPaths';
import { discoVoiceSpeakerKey, resolveDiscoVoiceExtractRoot } from './discoverDiscoVoiceFiles';
import { loadDiscoVoiceSources } from './loadDiscoVoiceSources';
import { loadDiscoVoiceTranslations } from './loadDiscoVoiceTranslations';
import { processDiscoVoiceEntry } from './processDiscoVoiceEntry';
import {
  resolveDiscoClipEntriesForSpeaker,
  resolveDiscoClipEntryByFormid,
} from './resolveClipEntry';
import { resolveDiscoSpokenRowText } from './resolveDiscoSpokenRow';

export type SynthesizeDiscoVoiceLineOptions = {
  modId: number;
  pluginPath: string;
  localizeDir: string;
  formidLower6: string;
  variant: number;
  srcLang: string;
  tgtLang: string;
  force?: boolean;
  referenceMode?: TtsReferenceMode;
};

export type SynthesizeDiscoVoiceLineBuffersResult =
  | { ok: true; ttsWav: Buffer; wavRel: string; payloadVersion: string; speakerKey: string }
  | { ok: false; reason: string; message: string };

const prepareDiscoLine = async (
  db: Tx,
  opts: Omit<SynthesizeDiscoVoiceLineOptions, 'localizeDir' | 'force'>,
) => {
  const extractRoot = resolveDiscoVoiceExtractRoot(opts.pluginPath);
  if (!extractRoot) {
    return {
      ok: false as const,
      reason: 'line_not_found' as const,
      message: 'Disco pack root not found',
    };
  }

  const found = await resolveDiscoClipEntryByFormid(db, opts.modId, extractRoot, opts.formidLower6);
  if (!found || found.entry.variant !== opts.variant) {
    return {
      ok: false as const,
      reason: 'line_not_found' as const,
      message: 'Voice line not found',
    };
  }
  const { clip, entry } = found;

  const translations = await loadDiscoVoiceTranslations(
    db,
    opts.modId,
    opts.srcLang,
    opts.tgtLang,
    extractRoot,
    { formidLower12: clip.formidLower12 },
  );
  const row = lookupVoiceTranslation(translations, entry.formidLower6, entry.variant);
  if (!row?.translation?.trim()) {
    return {
      ok: false as const,
      reason: 'no_translation' as const,
      message: 'No translation for this voice line',
    };
  }
  if (!canSynthesizeVoiceLine(row.source, row.translation, row.edid, 'disco')) {
    return {
      ok: false as const,
      reason: 'non_speech' as const,
      message: 'Line is not synthesizable',
    };
  }

  const spoken = await resolveDiscoSpokenRowText(row, entry.absolutePath);
  const prepared = prepareVoiceTtsText({
    lineSource: spoken.source,
    translation: spoken.translation,
    speakerSource: spoken.source,
    edid: row.edid,
    markup: 'disco',
  });
  if (prepared.action !== 'synthesize') {
    return {
      ok: false as const,
      reason: 'non_speech' as const,
      message: 'Line is not synthesizable',
    };
  }

  const ttsBaseUrl = resolveTtsBaseUrl();
  const mod = await loadImportedMod(db, opts.modId);
  const voiceConfig = await loadVoiceProjectSettings(db, mod.game);
  const voiceSources = await loadDiscoVoiceSources(db, opts.modId, opts.srcLang, extractRoot, {
    speakerKey: clip.speakerKey,
  });
  const speakerEntries = await resolveDiscoClipEntriesForSpeaker(
    db,
    opts.modId,
    extractRoot,
    clip.speakerKey,
  );
  if (getJobRuntime()) await ensureDependencyHealthy('tts');
  else await checkTtsHealth(ttsBaseUrl);

  return {
    ok: true as const,
    extractRoot,
    entry,
    row,
    prepared,
    ttsBaseUrl,
    mod,
    voiceConfig,
    voiceSources,
    speakerEntries,
    payloadVersion: voiceTtsPayloadVersionFromPrepared(prepared, opts.tgtLang),
    speakerKey: discoVoiceSpeakerKey(entry),
  };
};

/** One-line Disco TTS for the voice editor. */
export const synthesizeDiscoVoiceLine = async (
  db: Tx,
  opts: SynthesizeDiscoVoiceLineOptions,
): Promise<SynthesizeModVoiceLineResult> => {
  const loaded = await prepareDiscoLine(db, opts);
  if (!loaded.ok) return loaded;

  ensureDir(opts.localizeDir);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'disco-voice-line-'));
  const storedVersions = await loadVoiceSynthesisVersionMap(db, opts.modId, opts.tgtLang);
  const speakerRefCache = new Map<string, SpeakerRefCacheEntry>();

  try {
    const result = await processDiscoVoiceEntry(loaded.entry, loaded.row, loaded.prepared, {
      db,
      modId: opts.modId,
      extractDir: loaded.extractRoot,
      localizeDir: opts.localizeDir,
      tempRoot,
      game: loaded.mod.game,
      ttsBaseUrl: loaded.ttsBaseUrl,
      referenceMode: opts.referenceMode ?? loaded.voiceConfig.referenceMode,
      synthesis: loaded.voiceConfig.synthesis,
      tgtLang: opts.tgtLang,
      force: opts.force ?? true,
      voiceSources: loaded.voiceSources,
      speakerRefCache,
      getSiblingEntries: (_key, current) =>
        loaded.speakerEntries.filter(
          (candidate) =>
            candidate.formidLower6 !== current.formidLower6 ||
            candidate.variant !== current.variant,
        ),
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

/** Disco TTS WAV for regenerate preview — does not write localize/ or stamp state. */
export const synthesizeDiscoVoiceLineBuffers = async (
  db: Tx,
  opts: Omit<SynthesizeDiscoVoiceLineOptions, 'localizeDir'> & { referenceMode?: TtsReferenceMode },
): Promise<SynthesizeDiscoVoiceLineBuffersResult> => {
  const loaded = await prepareDiscoLine(db, opts);
  if (!loaded.ok) return loaded;

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'disco-voice-preview-'));
  const localizeDir = path.join(tempRoot, 'localize');
  const storedVersions = new Map<string, string>();
  const speakerRefCache = new Map<string, SpeakerRefCacheEntry>();

  try {
    const result = await processDiscoVoiceEntry(loaded.entry, loaded.row, loaded.prepared, {
      db,
      modId: opts.modId,
      extractDir: loaded.extractRoot,
      localizeDir,
      tempRoot,
      game: loaded.mod.game,
      ttsBaseUrl: loaded.ttsBaseUrl,
      referenceMode: opts.referenceMode ?? loaded.voiceConfig.referenceMode,
      synthesis: loaded.voiceConfig.synthesis,
      tgtLang: opts.tgtLang,
      force: true,
      persistState: false,
      voiceSources: loaded.voiceSources,
      speakerRefCache,
      getSiblingEntries: (_key, current) =>
        loaded.speakerEntries.filter(
          (candidate) =>
            candidate.formidLower6 !== current.formidLower6 ||
            candidate.variant !== current.variant,
        ),
      storedVersions,
    });

    if (result.kind === 'warning') {
      return { ok: false, reason: 'tts_failed', message: result.message };
    }
    const wavPath = toDiskPath(localizeDir, result.relPath);
    if (!fs.existsSync(wavPath)) {
      return { ok: false, reason: 'tts_failed', message: 'Disco preview WAV was not written' };
    }
    return {
      ok: true,
      ttsWav: fs.readFileSync(wavPath),
      wavRel: result.relPath,
      payloadVersion: loaded.payloadVersion,
      speakerKey: loaded.speakerKey,
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
};
