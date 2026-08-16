import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../db';
import { log } from '../logger';
import { toDiskPath, writeIfChanged } from '../modImport';
import { isDependencyUnavailableError } from '../pipeline/errors';
import { synthesizeWav, type TtsSynthesisParams } from '../tts/ttsClient';
import { ensureDir } from '../utils/file';
import type { VoiceFileEntry } from './discoverVoiceFiles';
import type { VoiceSourceRow, VoiceTranslationRow } from './loadVoiceTranslations';
import { voiceTranslationMapKey } from './loadVoiceTranslations';
import { voiceSpeakerKey } from './speakerReference';
import { pickVoiceTtsReference, type SpeakerRefCacheEntry } from './pickVoiceTtsReference';
import { prepareReferenceAudio } from './prepareReferenceAudio';
import { stripVoiceNonSpeechBlocks, type PrepareVoiceTtsTextResult } from './prepareVoiceTtsText';
import { buildVoicedFuzFromTtsWav } from './synthesizeVoicedFuz';
import { outputLocalizedFuzRelPath } from './voiceFilePaths';
import { upsertVoiceSynthesisState } from './voiceSynthesisState';
import {
  isVoiceSynthesisCurrent,
  voiceTtsPayloadVersionFromPrepared,
} from './voiceTtsPayloadVersion';
import { resolveTtsLanguage, type TtsReferenceMode } from './voiceToolPaths';
import type { GameType } from '../types';

export type { SpeakerRefCacheEntry } from './pickVoiceTtsReference';

export type ProcessVoiceLocalizeEntryOptions = {
  db: Tx;
  modId: number;
  packageDir: string;
  pluginRel: string;
  voiceRootRel: string;
  localizeDir: string;
  prefix: string;
  tempRoot: string;
  game: GameType;
  ttsBaseUrl: string;
  referenceMode: TtsReferenceMode;
  synthesis: TtsSynthesisParams;
  tgtLang: string;
  force: boolean;
  voiceSources: Map<string, VoiceSourceRow>;
  speakerRefCache: Map<string, SpeakerRefCacheEntry>;
  getSiblingEntries: (speakerKey: string, current: VoiceFileEntry) => VoiceFileEntry[];
  storedVersions: Map<string, string>;
};

export type ProcessVoiceLocalizeEntryResult =
  | { kind: 'written'; relPath: string }
  | { kind: 'skipped'; relPath: string }
  | { kind: 'warning'; message: string };

/** Synthesize one voice file entry into a localized `.fuz` under the mod tree. */
export const processVoiceLocalizeEntry = async (
  entry: VoiceFileEntry,
  row: VoiceTranslationRow,
  prepared: Extract<PrepareVoiceTtsTextResult, { action: 'synthesize' }>,
  options: ProcessVoiceLocalizeEntryOptions,
): Promise<ProcessVoiceLocalizeEntryResult> => {
  const {
    db,
    modId,
    packageDir,
    pluginRel,
    voiceRootRel,
    localizeDir,
    prefix,
    tempRoot,
    game,
    ttsBaseUrl,
    referenceMode,
    synthesis,
    tgtLang,
    force,
    voiceSources,
    speakerRefCache,
    getSiblingEntries,
    storedVersions,
  } = options;

  const fuzRel = outputLocalizedFuzRelPath(entry);
  const fuzDest = toDiskPath(localizeDir, fuzRel);
  let workDir: string | undefined;

  try {
    const versionKey = voiceTranslationMapKey(entry.formidLower6, entry.variant);
    const payloadVersion = voiceTtsPayloadVersionFromPrepared(prepared, tgtLang);
    const storedVersion = storedVersions.get(versionKey);
    if (!force && isVoiceSynthesisCurrent(storedVersion, payloadVersion, fs.existsSync(fuzDest))) {
      return { kind: 'skipped', relPath: prefix + fuzRel };
    }

    workDir = path.join(tempRoot, `${entry.formidLower6}_${entry.variant}`);
    ensureDir(workDir);

    const speakerKey = voiceSpeakerKey(entry, voiceRootRel);
    const lineEnglishWav = await prepareReferenceAudio(entry, workDir);
    const picked = await pickVoiceTtsReference({
      db,
      modId,
      packageDir,
      pluginRelPath: pluginRel,
      speakerKey: speakerKey || null,
      entry,
      lineEnglishWav,
      lineSource: row.source,
      referenceMode,
      voiceSources,
      getSiblingEntries: (key) => getSiblingEntries(key, entry),
      speakerRefCache,
    });

    // TTS may use a different reference transcript than the line source; version
    // stamp stays on prepared text so it matches count/availability/rebuild.
    const speakerText = stripVoiceNonSpeechBlocks(picked.referenceText ?? row.source) || undefined;

    const ttsWav = await synthesizeWav(prepared.text, picked.wavPath, {
      baseUrl: ttsBaseUrl,
      language: resolveTtsLanguage(tgtLang),
      speakerText,
      synthesis,
    });

    const { fuzData } = await buildVoicedFuzFromTtsWav(
      game,
      ttsWav,
      workDir,
      entry.fileName,
      prepared.text,
    );

    const baselinePath = fs.existsSync(fuzDest) ? fuzDest : null;
    if (!force && writeIfChanged(fuzDest, fuzData, baselinePath)) {
      await upsertVoiceSynthesisState(db, {
        modId,
        formidLower6: entry.formidLower6,
        variant: entry.variant,
        targetLang: tgtLang,
        ttsTextVersion: payloadVersion,
      });
      storedVersions.set(versionKey, payloadVersion);
      log.info(`Voice ${prefix}${fuzRel}`);
      return { kind: 'written', relPath: prefix + fuzRel };
    }
    if (force) {
      ensureDir(path.dirname(fuzDest));
      fs.writeFileSync(fuzDest, fuzData);
      await upsertVoiceSynthesisState(db, {
        modId,
        formidLower6: entry.formidLower6,
        variant: entry.variant,
        targetLang: tgtLang,
        ttsTextVersion: payloadVersion,
      });
      storedVersions.set(versionKey, payloadVersion);
      log.info(`Voice ${prefix}${fuzRel}`);
      return { kind: 'written', relPath: prefix + fuzRel };
    }
    return { kind: 'skipped', relPath: prefix + fuzRel };
  } catch (err) {
    if (isDependencyUnavailableError(err)) throw err;
    const message = `${prefix}${entry.relPath}: ${err instanceof Error ? err.message : String(err)}`;
    log.warn(`Voice synthesis failed ${message}`);
    return { kind: 'warning', message };
  } finally {
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
  }
};
