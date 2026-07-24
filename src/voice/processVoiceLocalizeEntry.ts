import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../db';
import { log } from '../logger';
import { toDiskPath, writeIfChanged } from '../modImport';
import { synthesizeXttsWav, type TtsBackend } from '../tts/xttsClient';
import type { XttsSynthesisParams } from '../tts/xttsSynthesisParams';
import { ensureDir } from '../utils/file';
import type { VoiceFileEntry } from './discoverVoiceFiles';
import type { VoiceSourceRow, VoiceTranslationRow } from './loadVoiceTranslations';
import { lookupVoiceSource } from './loadVoiceTranslations';
import {
  resolveSpeakerReferenceForSpeaker,
  voiceSpeakerKey,
  type ResolvedSpeakerReference,
} from './speakerReference';
import { prepareReferenceAudio } from './prepareReferenceAudio';
import { stripVoiceAsteriskBlocks, type PrepareVoiceTtsTextResult } from './prepareVoiceTtsText';
import { buildVoicedFuzFromTtsWav } from './synthesizeVoicedFuz';
import { outputLocalizedFuzRelPath } from './voiceFilePaths';
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
  xttsBaseUrl: string;
  backend: TtsBackend;
  referenceMode: TtsReferenceMode;
  synthesis: XttsSynthesisParams;
  tgtLang: string;
  force: boolean;
  voiceSources: Map<string, VoiceSourceRow>;
  speakerRefCache: Map<string, SpeakerRefCacheEntry>;
  getSiblingEntries: (speakerKey: string, current: VoiceFileEntry) => VoiceFileEntry[];
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
    xttsBaseUrl,
    backend,
    referenceMode,
    synthesis,
    tgtLang,
    force,
    voiceSources,
    speakerRefCache,
    getSiblingEntries,
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

    const ttsWav = await synthesizeXttsWav(prepared.text, finalReferenceWav, {
      baseUrl: xttsBaseUrl,
      backend,
      language: resolveTtsLanguage(tgtLang),
      speakerText,
      synthesis,
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
      log.info(`Voice ${prefix}${fuzRel}`);
      return { kind: 'written', relPath: prefix + fuzRel };
    }
    if (force) {
      ensureDir(path.dirname(fuzDest));
      fs.writeFileSync(fuzDest, fuzData);
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
