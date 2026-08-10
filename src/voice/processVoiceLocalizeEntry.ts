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
  isManualVoiceReferencePick,
  isUkLibraryVoiceReferencePick,
  resolveSpeakerReferenceForSpeaker,
  voiceReferenceEligibilityFromSources,
  voiceSpeakerKey,
  type ResolvedSpeakerReference,
} from './speakerReference';
import { resolveUkLibraryReference } from './ukLibrary';
import { decideVoiceReferenceSource, isLineReferenceSuitable } from './decideVoiceReferenceSource';
import { prepareReferenceAudio } from './prepareReferenceAudio';
import type { PrepareVoiceTtsTextResult } from './prepareVoiceTtsText';
import {
  mergeTtsReferenceClips,
  speakerTextsFromClips,
  type TtsReferenceClip,
} from './mergeTtsReferenceClips';
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
  /** `null` means looked up with no link; omitted means not resolved yet. */
  ukLibrary?: TtsReferenceClip | null;
  speaker?: TtsReferenceClip;
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
  /** When false, skip the global voice reference (open UA library). */
  useUkLibrary: boolean;
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
  resolved: ResolvedSpeakerReference,
): string | null => {
  if (isUkLibraryVoiceReferencePick(resolved.pick)) return resolved.speakerText ?? null;
  if (isManualVoiceReferencePick(resolved.pick)) return null;
  return lookupVoiceSource(sources, resolved.pick.formidLower6, resolved.pick.variant);
};

const resolveUkClip = async (
  db: Tx,
  speakerKey: string,
  cache: SpeakerRefCacheEntry,
): Promise<TtsReferenceClip | null> => {
  if (cache.ukLibrary !== undefined) return cache.ukLibrary;
  const ukLibrary = await resolveUkLibraryReference(db, speakerKey);
  cache.ukLibrary = ukLibrary
    ? { wavPath: ukLibrary.wavPath, speakerText: ukLibrary.transcript }
    : null;
  return cache.ukLibrary;
};

const resolveSpeakerClip = async (
  entry: VoiceFileEntry,
  speakerKey: string,
  options: ProcessVoiceLocalizeEntryOptions,
  cache: SpeakerRefCacheEntry,
): Promise<TtsReferenceClip | undefined> => {
  if (cache.speaker) return cache.speaker;
  const resolved = await resolveSpeakerReferenceForSpeaker({
    db: options.db,
    modId: options.modId,
    speakerKey,
    preferredEntry: entry,
    getFallbackEntries: () => options.getSiblingEntries(speakerKey, entry),
    packageDir: options.packageDir,
    pluginRelPath: options.pluginRel,
    isEligible: voiceReferenceEligibilityFromSources(options.voiceSources),
  });
  if (!resolved) return undefined;
  cache.speaker = {
    wavPath: resolved.wavPath,
    speakerText: referenceTextForPick(options.voiceSources, resolved) ?? undefined,
  };
  return cache.speaker;
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
    voiceRootRel,
    localizeDir,
    prefix,
    tempRoot,
    game,
    ttsBaseUrl,
    referenceMode,
    useUkLibrary,
    tgtLang,
    force,
    voiceSources,
    speakerRefCache,
    storedVersions,
  } = options;

  const fuzRel = outputLocalizedFuzRelPath(entry);
  const fuzDest = toDiskPath(localizeDir, fuzRel);

  try {
    const workDir = path.join(tempRoot, `${entry.formidLower6}_${entry.variant}`);
    ensureDir(workDir);

    const speakerKey = voiceSpeakerKey(entry, voiceRootRel);
    const lineEnglishWav = await prepareReferenceAudio(entry, workDir);
    const referenceDecision = decideVoiceReferenceSource(
      referenceMode,
      isLineReferenceSuitable(lineEnglishWav),
    );

    const cache = speakerKey
      ? (speakerRefCache.get(speakerKey) ?? {})
      : ({} as SpeakerRefCacheEntry);
    if (speakerKey) speakerRefCache.set(speakerKey, cache);

    const ukClip = useUkLibrary && speakerKey ? await resolveUkClip(db, speakerKey, cache) : null;

    let localClip: TtsReferenceClip = {
      wavPath: lineEnglishWav,
      speakerText: row.source,
    };
    if (referenceDecision.kind === 'speaker' && speakerKey) {
      const speakerClip = await resolveSpeakerClip(entry, speakerKey, options, cache);
      if (speakerClip) {
        localClip = speakerClip;
      } else {
        localClip = {
          wavPath: lineEnglishWav,
          speakerText:
            lookupVoiceSource(voiceSources, entry.formidLower6, entry.variant) ?? row.source,
        };
      }
    }

    const clips = mergeTtsReferenceClips(ukClip, localClip);
    const speakerTexts = speakerTextsFromClips(clips);
    const versionKey = voiceTranslationMapKey(entry.formidLower6, entry.variant);
    const payloadVersion = voiceTtsPayloadVersionFromPrepared(prepared, tgtLang, speakerTexts);
    const storedVersion = storedVersions.get(versionKey);
    if (!force && isVoiceSynthesisCurrent(storedVersion, payloadVersion, fs.existsSync(fuzDest))) {
      return { kind: 'skipped', relPath: prefix + fuzRel };
    }

    const ttsWav = await synthesizeWav(prepared.text, clips, {
      baseUrl: ttsBaseUrl,
      language: resolveTtsLanguage(tgtLang),
    });

    const { fuzData } = await buildVoicedFuzFromTtsWav(
      game,
      ttsWav,
      workDir,
      entry.fileName,
      prepared.text,
      lineEnglishWav,
    );

    const baselinePath = fs.existsSync(fuzDest) ? fuzDest : null;
    if (!force && writeIfChanged(fuzDest, fuzData, baselinePath)) {
      await upsertVoiceSynthesisState(db, {
        modId: options.modId,
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
        modId: options.modId,
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
    const message = `${prefix}${entry.relPath}: ${err instanceof Error ? err.message : String(err)}`;
    log.warn(`Voice synthesis failed ${message}`);
    return { kind: 'warning', message };
  }
};
