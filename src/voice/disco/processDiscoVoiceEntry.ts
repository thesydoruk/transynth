/**
 * Synthesize one Disco Final Cut line to localized `.wav` (no FUZ / FaceFX).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../../db';
import { log } from '../../logger';
import { toDiskPath, writeIfChanged } from '../../modImport';
import { isDependencyUnavailableError } from '../../pipeline/errors';
import { synthesizeWav, type TtsSynthesisParams } from '../../tts/ttsClient';
import type { GameType } from '../../types';
import { ensureDir } from '../../utils/file';
import type { VoiceFileEntry } from '../discoverVoiceFiles';
import type { VoiceSourceRow, VoiceTranslationRow } from '../loadVoiceTranslations';
import { voiceTranslationMapKey } from '../loadVoiceTranslations';
import { pickVoiceTtsReference, type SpeakerRefCacheEntry } from '../pickVoiceTtsReference';
import { prepareReferenceAudio } from '../prepareReferenceAudio';
import { stripVoiceNonSpeechBlocks, type PrepareVoiceTtsTextResult } from '../prepareVoiceTtsText';
import { upsertVoiceSynthesisState } from '../voiceSynthesisState';
import {
  isVoiceSynthesisCurrent,
  voiceTtsPayloadVersionFromPrepared,
} from '../voiceTtsPayloadVersion';
import { resolveTtsLanguage, type TtsReferenceMode } from '../voiceToolPaths';
import { discoVoiceSpeakerKey } from './discoverDiscoVoiceFiles';
import { outputLocalizedWavRelPath } from './voicePaths';

export type ProcessDiscoVoiceEntryOptions = {
  db: Tx;
  modId: number;
  extractDir: string;
  localizeDir: string;
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

export type ProcessDiscoVoiceEntryResult =
  | { kind: 'written'; relPath: string }
  | { kind: 'skipped'; relPath: string }
  | { kind: 'warning'; message: string };

export const processDiscoVoiceEntry = async (
  entry: VoiceFileEntry,
  row: VoiceTranslationRow,
  prepared: Extract<PrepareVoiceTtsTextResult, { action: 'synthesize' }>,
  options: ProcessDiscoVoiceEntryOptions,
): Promise<ProcessDiscoVoiceEntryResult> => {
  const {
    db,
    modId,
    extractDir,
    localizeDir,
    tempRoot,
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

  const wavRel = outputLocalizedWavRelPath(entry);
  const wavDest = toDiskPath(localizeDir, wavRel);
  let workDir: string | undefined;

  try {
    const versionKey = voiceTranslationMapKey(entry.formidLower6, entry.variant);
    const payloadVersion = voiceTtsPayloadVersionFromPrepared(prepared, tgtLang);
    const storedVersion = storedVersions.get(versionKey);
    if (!force && isVoiceSynthesisCurrent(storedVersion, payloadVersion, fs.existsSync(wavDest))) {
      return { kind: 'skipped', relPath: wavRel };
    }

    workDir = path.join(tempRoot, `${entry.formidLower6}_${entry.variant}`);
    ensureDir(workDir);

    const lineEnglishWav = await prepareReferenceAudio(entry, workDir);
    const speakerKey = discoVoiceSpeakerKey(entry);
    const picked = await pickVoiceTtsReference({
      db,
      modId,
      packageDir: extractDir,
      pluginRelPath: 'disco.po',
      speakerKey,
      entry,
      lineEnglishWav,
      lineSource: row.source,
      referenceMode,
      voiceSources,
      getSiblingEntries: (key) => getSiblingEntries(key, entry),
      speakerRefCache,
    });
    const speakerText =
      stripVoiceNonSpeechBlocks(picked.referenceText ?? row.source, 'disco') || undefined;

    const ttsWav = await synthesizeWav(prepared.text, picked.wavPath, {
      baseUrl: ttsBaseUrl,
      language: resolveTtsLanguage(tgtLang),
      speakerText,
      synthesis,
    });

    const baselinePath = fs.existsSync(wavDest) ? wavDest : null;
    if (!force && writeIfChanged(wavDest, ttsWav, baselinePath)) {
      await upsertVoiceSynthesisState(db, {
        modId,
        formidLower6: entry.formidLower6,
        variant: entry.variant,
        targetLang: tgtLang,
        ttsTextVersion: payloadVersion,
      });
      storedVersions.set(versionKey, payloadVersion);
      log.info(`Disco voice ${wavRel}`);
      return { kind: 'written', relPath: wavRel };
    }
    if (force) {
      ensureDir(path.dirname(wavDest));
      fs.writeFileSync(wavDest, ttsWav);
      await upsertVoiceSynthesisState(db, {
        modId,
        formidLower6: entry.formidLower6,
        variant: entry.variant,
        targetLang: tgtLang,
        ttsTextVersion: payloadVersion,
      });
      storedVersions.set(versionKey, payloadVersion);
      log.info(`Disco voice ${wavRel}`);
      return { kind: 'written', relPath: wavRel };
    }
    return { kind: 'skipped', relPath: wavRel };
  } catch (err) {
    if (isDependencyUnavailableError(err)) throw err;
    const message = `${entry.relPath}: ${err instanceof Error ? err.message : String(err)}`;
    log.warn(`Disco voice synthesis failed ${message}`);
    return { kind: 'warning', message };
  } finally {
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
  }
};
