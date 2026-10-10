/**
 * The mod-wide Witcher 3 voice job: every translated voiced line that has no
 * current synthesized take gets one.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Tx } from '../../../db';
import { log } from '../../../logger';
import { modImportLocalizeDir } from '../../../modStorage';
import { ttsPipelineConcurrency } from '../../../tts/ttsRequestPool';
import { runPoolOverAsyncIterable } from '../../../utils/concurrency';
import { ensureDir } from '../../../utils/file';
import { emitVoiceLive } from '../../../voice/voiceLiveEvents';
import {
  loadVoiceSynthesisVersionMap,
  lookupVoiceSynthesisVersion,
} from '../../../voice/voiceSynthesisState';
import {
  isVoiceSynthesisCurrent,
  voiceTtsPayloadVersionFromPrepared,
} from '../../../voice/voiceTtsPayloadVersion';
import type { VoiceLocalizeRequest, VoiceLocalizeSink } from '../../contract';
import { readW3SpeechBlock, readW3SpeechIndex, type W3SpeechRow } from '../w3speech';
import { loadW3VoiceLines, type W3VoiceLine } from './lines';
import { loadW3MimicModel, w3MimicModelPath } from './mimicModel';
import { prepareW3VoiceText, synthesizeW3VoiceLine } from './synthesizeLine';
import { W3_VOICE_VARIANT, w3LocalizedTakePaths, w3SourceCacheDir } from './takes';
import { buildW3ReferenceContext } from './references';

type DueCheck = {
  localizeDir: string;
  tgtLang: string;
  storedVersions: Map<string, string>;
  /** Re-synthesize even lines whose take is current. */
  all: boolean;
};

/** Would the job synthesize this line? */
const isLineDue = (line: W3VoiceLine, check: DueCheck): boolean => {
  const prepared = prepareW3VoiceText(line);
  if (prepared.action !== 'synthesize') return false;
  if (check.all) return true;
  const stored = lookupVoiceSynthesisVersion(
    check.storedVersions,
    line.speakerKey,
    String(line.id),
    W3_VOICE_VARIANT,
  );
  // The `.wav` is the take; its game blocks are derived from it (see `takes.ts`).
  const wav = w3LocalizedTakePaths(line.container, line.id).wav;
  return !isVoiceSynthesisCurrent(
    stored,
    voiceTtsPayloadVersionFromPrepared(prepared, check.tgtLang),
    fs.existsSync(path.join(check.localizeDir, wav)),
  );
};

const loadDueLines = async (
  db: Tx,
  request: Pick<
    VoiceLocalizeRequest,
    'modId' | 'extractDir' | 'srcLang' | 'tgtLang' | 'onlyKeys' | 'speakerKey'
  >,
  all: boolean,
): Promise<{ lines: W3VoiceLine[]; localizeDir: string; storedVersions: Map<string, string> }> => {
  const localizeDir = modImportLocalizeDir(request.extractDir, request.tgtLang);
  const storedVersions = await loadVoiceSynthesisVersionMap(db, request.modId, request.tgtLang);
  const lines = (
    await loadW3VoiceLines(db, request.modId, request.srcLang, request.tgtLang, {
      translatedOnly: true,
      ...(request.onlyKeys ? { onlyKeys: request.onlyKeys } : {}),
    })
  ).filter((line) => !request.speakerKey || line.speakerKey === request.speakerKey);
  const check = { localizeDir, tgtLang: request.tgtLang, storedVersions, all };
  return { lines: lines.filter((line) => isLineDue(line, check)), localizeDir, storedVersions };
};

export const countW3VoiceWork = async (db: Tx, request: VoiceLocalizeRequest): Promise<number> =>
  (await loadDueLines(db, request, request.scope === 'all')).lines.length;

/** Open each container once and look rows up by string id. */
const containerReader = (extractDir: string) => {
  const open = new Map<string, { fd: number; rows: Map<number, W3SpeechRow> }>();
  return {
    read: (line: W3VoiceLine): { audio: Buffer; lip: Buffer } | null => {
      let container = open.get(line.container);
      if (!container) {
        const file = path.join(extractDir, ...line.container.split('/'));
        if (!fs.existsSync(file)) return null;
        const fd = fs.openSync(file, 'r');
        container = { fd, rows: new Map(readW3SpeechIndex(fd).rows.map((row) => [row.id, row])) };
        open.set(line.container, container);
      }
      const row = container.rows.get(line.id);
      if (!row) return null;
      return {
        audio: readW3SpeechBlock(container.fd, row.audioOffset, row.audioSize),
        lip: readW3SpeechBlock(container.fd, row.lipOffset, row.lipSize),
      };
    },
    close: () => {
      for (const { fd } of open.values()) fs.closeSync(fd);
    },
  };
};

export const localizeW3Voice = async (
  db: Tx,
  request: VoiceLocalizeRequest,
  sink: VoiceLocalizeSink,
): Promise<void> => {
  const { lines, localizeDir, storedVersions } = await loadDueLines(db, request, request.force);
  ensureDir(localizeDir);
  const model = loadW3MimicModel();
  // Every voiced line of the mod, not just the due ones: a speaker's other
  // takes are what a short line borrows a reference from.
  const reference = buildW3ReferenceContext({
    mode: request.referenceMode,
    extractRoot: request.extractDir,
    cacheDir: w3SourceCacheDir(request.modId),
    lines: await loadW3VoiceLines(db, request.modId, request.srcLang, request.tgtLang),
  });
  log.info(
    `Witcher 3 voice: ${lines.length} line(s) to synthesize for mod ${request.modId}; ` +
      `lips ${model ? 'from the mimic model' : 'stretched from the original'}`,
  );
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `w3-voice-${request.modId}-`));
  const reader = containerReader(request.extractDir);
  // Lines are handed out one at a time, so cancel and the limit stop the job
  // between lines; as many run at once as the TTS pool allows, plus one being
  // prepared (`ttsPipelineConcurrency`), like every other game's voice job.
  async function* dueLines(): AsyncGenerator<W3VoiceLine> {
    let handedOut = 0;
    for (const line of lines) {
      if (request.shouldCancel?.()) return;
      if (request.limit != null && handedOut >= request.limit) return;
      handedOut++;
      request.onEligibleStep?.();
      yield line;
    }
  }

  const synthesizeOne = async (line: W3VoiceLine): Promise<void> => {
    const relPath = w3LocalizedTakePaths(line.container, line.id).wav;
    if (request.dryRun) {
      sink.skipped.push(relPath);
      return;
    }
    const original = reader.read(line);
    if (!original) {
      sink.warnings.push(`${line.relPath}: take not found in its container`);
      return;
    }
    const live = {
      modId: request.modId,
      speakerKey: line.speakerKey,
      lineKey: String(line.id),
      variant: W3_VOICE_VARIANT,
    };
    emitVoiceLive({ type: 'line_started', ...live });
    try {
      const result = await synthesizeW3VoiceLine(line, original, {
        db,
        modId: request.modId,
        localizeDir,
        tempRoot,
        ttsBaseUrl: request.ttsBaseUrl,
        synthesis: request.synthesis,
        tgtLang: request.tgtLang,
        model,
        modelPath: model ? w3MimicModelPath() : null,
        reference,
        force: request.force,
        storedVersions,
        ...(request.signal ? { signal: request.signal } : {}),
      });
      if (result.kind === 'written') {
        sink.written.push(result.relPath);
        emitVoiceLive({ type: 'line_done', ...live, voiceSimilarity: result.voiceSimilarity });
      } else {
        if (result.kind === 'skipped') sink.skipped.push(result.relPath);
        else sink.warnings.push(result.message);
        emitVoiceLive({ type: 'line_failed', ...live });
      }
    } catch (err) {
      emitVoiceLive({ type: 'line_failed', ...live });
      throw err;
    }
  };

  try {
    await runPoolOverAsyncIterable(dueLines(), ttsPipelineConcurrency(), synthesizeOne, {
      shouldAbort: () => request.shouldCancel?.() ?? false,
    });
  } finally {
    reader.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
};
