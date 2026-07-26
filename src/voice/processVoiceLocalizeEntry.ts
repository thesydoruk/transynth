import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../db';
import { log } from '../logger';
import { toDiskPath, writeIfChanged } from '../modImport';
import { synthesizeWav } from '../tts/ttsClient';
import { ensureDir } from '../utils/file';
import type { VoiceFileEntry } from './discoverVoiceFiles';
import type { VoiceSourceRow, VoiceTranslationRow } from './loadVoiceTranslations';
import { lookupVoiceSource, voiceTranslationMapKey } from './loadVoiceTranslations';
import {
  resolveSpeakerReferenceForSpeaker,
  voiceSpeakerKey,
  type ResolvedSpeakerReference,
} from './speakerReference';
import { prepareReferenceAudio } from './prepareReferenceAudio';
import { stripVoiceAsteriskBlocks, type PrepareVoiceTtsTextResult } from './prepareVoiceTtsText';
import { buildVoicedFuzFromTtsWav } from './synthesizeVoicedFuz';
import { outputLocalizedFuzRelPath } from './voiceFilePaths';
import { upsertVoiceSynthesisState } from './voiceSynthesisState';
import {
  isVoiceSynthesisCurrent,
  voiceTtsPayloadVersionFromPrepared,
} from './voiceTtsPayloadVersion';
import { resolveTtsLanguage, type TtsReferenceMode } from './voiceToolPaths';
import type { GameType } from '../types';

export type SpeakerRefCacheEntry = {
  wavPath: string;
  referenceText: string | null;
};

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

const referenceTextForPick = (
  sources: Map<string, VoiceSourceRow>,
  pick: ResolvedSpeakerReference['pick'],
): string | null => {
  if (pick.formidLower6.toUpperCase() === 'MANUAL') return null;
  return lookupVoiceSource(sources, pick.formidLower6, pick.variant);
};

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
    tgtLang,
    force,
    voiceSources,
    speakerRefCache,
    getSiblingEntries,
    storedVersions,
  } = options;

  const fuzRel = outputLocalizedFuzRelPath(entry);
  const fuzDest = toDiskPath(localizeDir, fuzRel);

  try {
    const workDir = path.join(tempRoot, `${entry.formidLower6}_${entry.variant}`);
    ensureDir(workDir);

    const speakerKey = voiceSpeakerKey(entry, voiceRootRel);
    let referenceWav: string | undefined;
    let referenceText: string | null =
      referenceMode === 'line'
        ? row.source
        : lookupVoiceSource(voiceSources, entry.formidLower6, entry.variant);

    if (referenceMode === 'speaker' && speakerKey) {
      const cached = speakerRefCache.get(speakerKey);
      if (cached) {
        referenceWav = cached.wavPath;
        referenceText = cached.referenceText;
      } else {
        const resolved = await resolveSpeakerReferenceForSpeaker(
          db,
          modId,
          speakerKey,
          entry,
          () => getSiblingEntries(speakerKey, entry),
          packageDir,
          pluginRel,
        );
        if (resolved) {
          referenceWav = resolved.wavPath;
          referenceText = referenceTextForPick(voiceSources, resolved.pick);
          speakerRefCache.set(speakerKey, {
            wavPath: resolved.wavPath,
            referenceText,
          });
        }
      }
    }

    const finalReferenceWav =
      referenceMode === 'line'
        ? await prepareReferenceAudio(entry, workDir)
        : (referenceWav ?? (await prepareReferenceAudio(entry, workDir)));
    if (!referenceText) {
      referenceText = lookupVoiceSource(voiceSources, entry.formidLower6, entry.variant);
    }

    const speakerText = stripVoiceAsteriskBlocks(referenceText ?? row.source) || undefined;
    const payloadVersion = voiceTtsPayloadVersionFromPrepared(prepared, tgtLang, speakerText);
    const versionKey = voiceTranslationMapKey(entry.formidLower6, entry.variant);
    const storedVersion = storedVersions.get(versionKey);

    if (!force && isVoiceSynthesisCurrent(storedVersion, payloadVersion, fs.existsSync(fuzDest))) {
      return { kind: 'skipped', relPath: prefix + fuzRel };
    }

    const ttsWav = await synthesizeWav(prepared.text, finalReferenceWav, {
      baseUrl: ttsBaseUrl,
      language: resolveTtsLanguage(tgtLang),
      speakerText,
    });

    const fuzData = await buildVoicedFuzFromTtsWav(
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
    return {
      kind: 'warning',
      message: `${prefix}${entry.relPath}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
};
