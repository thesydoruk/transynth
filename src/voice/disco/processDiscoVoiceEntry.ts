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
import { pickVoiceTtsReference, type SpeakerRefCacheEntry } from '../pickVoiceTtsReference';
import { prepareReferenceAudio } from '../prepareReferenceAudio';
import { stripVoiceNonSpeechBlocks, type PrepareVoiceTtsTextResult } from '../prepareVoiceTtsText';
import {
  lookupVoiceSynthesisVersion,
  upsertVoiceSynthesisState,
  voiceSynthesisStateKey,
} from '../voiceSynthesisState';
import {
  isVoiceSynthesisCurrent,
  voiceTtsPayloadVersionFromPrepared,
} from '../voiceTtsPayloadVersion';
import { resolveTtsLanguage, type TtsReferenceMode } from '../voiceToolPaths';
import { discoVoiceSpeakerKey } from './discoverDiscoVoiceFiles';
import { decideDiscoSpokenText, readWavDurationSecLight } from './discoSpokenText';
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
  signal?: AbortSignal;
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
    signal,
  } = options;

  const wavRel = outputLocalizedWavRelPath(entry);
  const wavDest = toDiskPath(localizeDir, wavRel);
  let workDir: string | undefined;

  try {
    const speakerKey = discoVoiceSpeakerKey(entry);
    const versionKey = voiceSynthesisStateKey(speakerKey, entry.formidLower6, entry.variant);
    const payloadVersion = voiceTtsPayloadVersionFromPrepared(prepared, tgtLang);
    const storedVersion = lookupVoiceSynthesisVersion(
      storedVersions,
      speakerKey,
      entry.formidLower6,
      entry.variant,
    );
    if (!force && isVoiceSynthesisCurrent(storedVersion, payloadVersion, fs.existsSync(wavDest))) {
      return { kind: 'skipped', relPath: wavRel };
    }

    workDir = path.join(tempRoot, `${speakerKey}_${entry.formidLower6}_${entry.variant}`);
    ensureDir(workDir);

    const lineEnglishWav = await prepareReferenceAudio(entry, workDir);
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
      markup: 'disco',
    });
    // The first clip is the line take; extras are speaker identity only.
    const ttsWav = await synthesizeWav(
      prepared.text,
      picked.clips.map((clip, index) => {
        const raw = clip.speakerText ?? row.source;
        const spoken =
          index === 0 ? decideDiscoSpokenText(raw, readWavDurationSecLight(clip.wavPath)) : raw;
        return {
          wavPath: clip.wavPath,
          speakerText: stripVoiceNonSpeechBlocks(spoken, 'disco') || undefined,
        };
      }),
      {
        baseUrl: ttsBaseUrl,
        language: resolveTtsLanguage(tgtLang),
        synthesis,
        signal,
      },
    );

    const baselinePath = fs.existsSync(wavDest) ? wavDest : null;
    if (!force && writeIfChanged(wavDest, ttsWav, baselinePath)) {
      await upsertVoiceSynthesisState(db, {
        modId,
        formidLower6: entry.formidLower6,
        variant: entry.variant,
        speakerKey,
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
        speakerKey,
        targetLang: tgtLang,
        ttsTextVersion: payloadVersion,
      });
      storedVersions.set(versionKey, payloadVersion);
      log.info(`Disco voice ${wavRel}`);
      return { kind: 'written', relPath: wavRel };
    }
    return { kind: 'skipped', relPath: wavRel };
  } catch (err) {
    if (signal?.aborted) return { kind: 'skipped', relPath: wavRel };
    if (isDependencyUnavailableError(err)) throw err;
    const message = `${entry.relPath}: ${err instanceof Error ? err.message : String(err)}`;
    log.warn(`Disco voice synthesis failed ${message}`);
    return { kind: 'warning', message };
  } finally {
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
  }
};
