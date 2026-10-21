import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Tx } from '../db';
import { log } from '../logger';
import { pluginRelPath, toDiskPath, type ImportPackageContext } from '../modImport';
import type { TtsSynthesisParams } from '../tts/ttsSynthesisParams';
import { ttsPipelineConcurrency } from '../tts/ttsRequestPool';
import { runPoolOverAsyncIterable } from '../utils/concurrency';
import type { TtsReferenceMode } from './voiceToolPaths';
import { resolveVoiceRootRel } from './discoverVoiceFiles';
import { voiceTranslationMapKey } from './loadVoiceTranslations';
import { migrateVoiceSpeakerRefsFromJsonIfNeeded } from './voiceSpeakerRefs';
import { voiceSpeakerKey } from './speakerReference';
import {
  prepareVoiceTtsText,
  voiceTtsSkipMessage,
  type PrepareVoiceTtsTextResult,
} from './prepareVoiceTtsText';
import { outputLocalizedFuzRelPath } from './voiceFilePaths';
import { loadVoiceSynthesisVersionMap, lookupVoiceSynthesisVersion } from './voiceSynthesisState';
import { voiceTtsPayloadVersionFromPrepared } from './voiceTtsPayloadVersion';
import {
  loadVoiceResynthContext,
  voiceTakeNeedsWork,
  type VoiceResynthParams,
} from './voiceResynth';
import { processVoiceLocalizeEntry, type SpeakerRefCacheEntry } from './processVoiceLocalizeEntry';
import type { ModVoiceGenerateScope } from './localizeModImportVoice';
import type { GameId } from '../types';
import { emitVoiceLive } from './voiceLiveEvents';
import { loadVoiceWorkList, type VoiceWorkSource } from './voiceWorkList';

type VoiceLocalizeWorkItem = VoiceWorkSource & {
  prepared: Extract<PrepareVoiceTtsTextResult, { action: 'synthesize' }>;
};

/** Synthesize voice lines for one plugin package inside an import extract tree. */
export const localizeVoicePackage = async (
  db: Tx,
  modId: number,
  pkg: ImportPackageContext,
  srcLang: string,
  tgtLang: string,
  options: {
    game: GameId;
    ttsBaseUrl: string;
    dryRun: boolean;
    force: boolean;
    scope: ModVoiceGenerateScope;
    referenceMode: TtsReferenceMode;
    synthesis: TtsSynthesisParams;
    /** Set for a `low-similarity` job. */
    resynth?: VoiceResynthParams;
    /** When set, only these `<origin>/FORMID6:variant` keys are synthesized. */
    onlyKeys?: ReadonlySet<string>;
    /** When set, only voice files under this NPC folder are synthesized. */
    speakerKey?: string;
    limit?: number;
    shouldCancel?: () => boolean;
    signal?: AbortSignal;
    onEligibleStep?: () => void;
  },
  written: string[],
  skipped: string[],
  warnings: string[],
): Promise<void> => {
  const prefix = pkg.folder ? `${pkg.folder}/` : '';
  const pluginRel = pluginRelPath(pkg.packageDir, pkg.pluginPath);
  const work = await loadVoiceWorkList(db, {
    modId,
    packageDir: pkg.packageDir,
    pluginPath: pkg.pluginPath,
    srcLang,
    tgtLang,
    prefix,
  });
  skipped.push(...work.skipped);
  const storedVersions = options.dryRun
    ? new Map<string, string>()
    : await loadVoiceSynthesisVersionMap(db, modId, tgtLang);
  const resynth = options.resynth
    ? await loadVoiceResynthContext(db, modId, tgtLang, options.resynth)
    : undefined;

  if (work.items.length === 0) {
    log.info(`No voice lines to synthesize under ${prefix}${resolveVoiceRootRel(pluginRel)}`);
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mod-voice-'));
  let eligibleSeen = 0;

  const voiceRootRel = work.voiceRootRel;
  const speakerFilter = options.speakerKey?.trim() || '';
  const speakerRefCache = new Map<string, SpeakerRefCacheEntry>();

  // Short lines keep the original clip first and may append a speaker default.
  if (!options.dryRun) {
    await migrateVoiceSpeakerRefsFromJsonIfNeeded(db, modId);
  }

  const finishEligibleStep = () => {
    options.onEligibleStep?.();
  };

  const takeNextWorkItem = (source: VoiceWorkSource): VoiceLocalizeWorkItem | 'stop' | null => {
    if (options.limit != null && eligibleSeen >= options.limit) return 'stop';
    const { entry, row } = source;

    const entryKey = voiceTranslationMapKey(entry.lineKey, entry.variant, entry.originPlugin);
    if (options.onlyKeys && !options.onlyKeys.has(entryKey)) return null;
    if (speakerFilter && voiceSpeakerKey(entry, voiceRootRel) !== speakerFilter) return null;

    const fuzRel = outputLocalizedFuzRelPath(entry);
    const fuzDest = toDiskPath(pkg.localizeDir, fuzRel);
    const prepared = prepareVoiceTtsText({
      lineSource: row.source,
      translation: row.translation,
      speakerSource: source.referenceSource ?? row.source,
      edid: row.edid,
    });
    if (prepared.action === 'skip') {
      skipped.push(`${prefix}${entry.relPath} (${voiceTtsSkipMessage(prepared.reason)})`);
      return null;
    }

    const speakerKey = voiceSpeakerKey(entry, voiceRootRel);
    const due = voiceTakeNeedsWork({
      force: options.force,
      resynth,
      speakerKey,
      lineKey: entry.lineKey,
      variant: entry.variant,
      origin: entry.originPlugin,
      storedVersion: lookupVoiceSynthesisVersion(
        storedVersions,
        speakerKey,
        entry.lineKey,
        entry.variant,
        entry.originPlugin,
      ),
      payloadVersion: voiceTtsPayloadVersionFromPrepared(prepared, tgtLang),
      fileExists: fs.existsSync(fuzDest),
    });
    if (!due) return null;

    if (options.dryRun) {
      const via = source.masterBacked ? ` [ref: ${source.masterBacked.master.pluginName}]` : '';
      log.info(`[dry-run] ${prefix}${fuzRel}${via} ← "${prepared.text.slice(0, 80)}..."`);
      eligibleSeen += 1;
      finishEligibleStep();
      return null;
    }

    eligibleSeen += 1;
    return { ...source, prepared };
  };

  async function* workItems(): AsyncGenerator<VoiceLocalizeWorkItem> {
    for (const source of work.items) {
      if (options.shouldCancel?.()) return;
      const next = takeNextWorkItem(source);
      if (next === 'stop') return;
      if (next) yield next;
    }
  }

  try {
    const entryOptions = {
      db,
      modId,
      packageDir: pkg.packageDir,
      pluginRel,
      voiceRootRel,
      localizeDir: pkg.localizeDir,
      prefix,
      tempRoot,
      game: options.game,
      ttsBaseUrl: options.ttsBaseUrl,
      referenceMode: options.referenceMode,
      synthesis: options.synthesis,
      tgtLang,
      force: options.force,
      resynth,
      voiceSources: work.voiceSources,
      speakerRefCache,
      getSiblingEntries: work.siblingsOf,
      storedVersions,
      signal: options.signal,
    };

    await runPoolOverAsyncIterable(
      workItems(),
      ttsPipelineConcurrency(),
      async ({ entry, row, prepared, referenceSource }) => {
        const speakerKey = voiceSpeakerKey(entry, voiceRootRel);
        const live = {
          modId,
          speakerKey,
          lineKey: entry.lineKey,
          variant: entry.variant,
          originPlugin: entry.originPlugin ?? null,
        };
        emitVoiceLive({ type: 'line_started', ...live });
        try {
          const result = await processVoiceLocalizeEntry(entry, row, prepared, {
            ...entryOptions,
            referenceSource,
          });
          finishEligibleStep();
          if (result.kind === 'written') {
            written.push(result.relPath);
            emitVoiceLive({
              type: 'line_done',
              ...live,
              voiceSimilarity: result.voiceSimilarity,
            });
          } else if (result.kind === 'kept') {
            // The old take stays; the voice tab still sees the line settle.
            skipped.push(`${result.relPath} (${result.reason})`);
            emitVoiceLive({
              type: 'line_done',
              ...live,
              voiceSimilarity: result.voiceSimilarity,
            });
          } else if (result.kind === 'skipped') {
            skipped.push(result.relPath);
            emitVoiceLive({ type: 'line_failed', ...live });
          } else {
            warnings.push(result.message);
            emitVoiceLive({ type: 'line_failed', ...live });
          }
        } catch (err) {
          emitVoiceLive({ type: 'line_failed', ...live });
          throw err;
        }
      },
      { shouldAbort: options.shouldCancel },
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
};
