/**
 * Stamp `voice_synthesis_state.voice_similarity` for takes that have none.
 *
 * Synthesis stores the clone similarity the gateway returns with each take. Takes made
 * while the gateway could not score (no speechbrain in its image until 2026-10-22), or
 * copied by voice reuse from a donor without a score, have NULL there, and the voice
 * tab and the retry gate cannot tell them from bad clones. This walks a mod's takes,
 * decodes each stamped take, rebuilds the reference clips the way synthesis picks them
 * (`prepareReferenceAudio` + `pickVoiceTtsReference`, so the number is comparable
 * with what synthesis would have stored) and asks the gateway to score the pair.
 *
 * Only the similarity column is written; version stamps and synthesized_at stay.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Tx } from '../db';
import { extractXwmFromFuzFile } from '../formats/fuz';
import { gamePlugin } from '../games/registry';
import { loadModImportPaths } from '../import/mod/resolvePaths';
import { loadImportedMod } from '../modImport';
import { servicePool } from '../services/pools';
import { scoreVoiceSimilarity } from '../tts/ttsSimilarity';
import { runPoolOverAsyncIterable } from '../utils/concurrency';
import { ensureDir } from '../utils/file';
import type { VoiceFileEntry } from './discoverVoiceFiles';
import { decodeAudioToReferenceWav } from './ffmpegAudio';
import { pickVoiceTtsReference } from './pickVoiceTtsReference';
import { prepareReferenceAudio } from './prepareReferenceAudio';
import type { SpeakerRefCacheEntry } from './processVoiceLocalizeEntry';
import { normalizeVoiceSpeakerKey } from './voiceSynthesisState';
import { loadVoiceProjectSettings } from './voiceProjectSettings';

export type BackfillVoiceSimilarityResult = {
  modId: number;
  /** Takes with a stamp but no similarity. */
  candidates: number;
  scored: number;
  /** Stamp rows whose take file or source entry is gone. */
  missing: number;
  /** The gateway returned no score (clip too short, gate off) or failed. */
  unscored: number;
  skipped: boolean;
  reason?: string;
};

export type BackfillVoiceSimilarityOptions = {
  targetLang?: string;
  workers?: number;
  dryRun?: boolean;
  /** Stop after this many scored takes (smoke runs). */
  limit?: number;
  log?: (message: string) => void;
};

type PendingRow = { lineKey: string; variant: number; speakerKey: string };

const stateKey = (speakerKey: string, lineKey: string, variant: number): string =>
  `${normalizeVoiceSpeakerKey(speakerKey)}|${lineKey.toUpperCase()}|${variant}`;

/** The take as WAV: a FUZ carries xWMA behind its LIP block, a WAV take is itself. */
const decodeTakeToWav = async (takePath: string, workDir: string): Promise<Buffer> => {
  const ext = path.extname(takePath).toLowerCase();
  if (ext === '.wav') return fs.readFileSync(takePath);
  const wavPath = path.join(workDir, 'take.wav');
  if (ext === '.fuz') {
    const xwmPath = path.join(workDir, 'take.xwm');
    fs.writeFileSync(xwmPath, extractXwmFromFuzFile(takePath));
    await decodeAudioToReferenceWav(xwmPath, wavPath);
  } else {
    await decodeAudioToReferenceWav(takePath, wavPath);
  }
  return fs.readFileSync(wavPath);
};

export const backfillVoiceSimilarity = async (
  db: Tx,
  modId: number,
  options: BackfillVoiceSimilarityOptions = {},
): Promise<BackfillVoiceSimilarityResult> => {
  const log = options.log ?? (() => {});
  const workers = Math.max(1, options.workers ?? 4);
  const base = { modId, candidates: 0, scored: 0, missing: 0, unscored: 0, skipped: false };

  let paths;
  try {
    paths = await loadModImportPaths(db, { modId });
  } catch (err) {
    return { ...base, skipped: true, reason: err instanceof Error ? err.message : String(err) };
  }
  const mod = await loadImportedMod(db, modId);
  const voice = gamePlugin(mod.game).voice;
  if (!voice) return { ...base, skipped: true, reason: 'game has no voice support' };
  const targetLang = (options.targetLang ?? paths.targetLang).trim().toLowerCase();

  const { rows: pending } = await db.query<{
    line_key: string;
    variant: number;
    speaker_key: string;
  }>(
    `SELECT line_key, variant, speaker_key
       FROM voice_synthesis_state
      WHERE mod_id = $1 AND target_lang = $2 AND voice_similarity IS NULL`,
    [modId, targetLang],
  );
  base.candidates = pending.length;
  if (pending.length === 0) return base;

  const catalog = await voice.loadLineCatalog(db, {
    modId,
    pluginPath: paths.pluginPath,
    srcLang: mod.srcLang,
    targetLang,
  });
  if (!catalog.ok) return { ...base, skipped: true, reason: catalog.message };
  const takes = await voice.listTakes(db, {
    modId,
    extractDir: paths.extractDir,
    pluginPath: paths.pluginPath,
    srcLang: mod.srcLang,
    targetLang,
  });
  const takeByKey = new Map<string, (typeof takes)[number]>();
  const entriesBySpeaker = new Map<string, VoiceFileEntry[]>();
  for (const take of takes) {
    takeByKey.set(stateKey(take.speakerKey, take.entry.lineKey, take.entry.variant), take);
    const list = entriesBySpeaker.get(take.speakerKey) ?? [];
    list.push(take.entry);
    entriesBySpeaker.set(take.speakerKey, list);
  }

  const { referenceMode } = await loadVoiceProjectSettings(db, mod.game);
  const speakerRefCache = new Map<string, SpeakerRefCacheEntry>();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-similarity-'));
  const tts = servicePool('tts');
  let stop = false;

  const scoreOne = async (row: PendingRow): Promise<void> => {
    if (stop) return;
    const take = takeByKey.get(stateKey(row.speakerKey, row.lineKey, row.variant));
    const takePath = take ? path.join(paths.localizeDir, take.destRelPath) : null;
    if (!take || !takePath || !fs.existsSync(takePath)) {
      base.missing += 1;
      return;
    }
    const workDir = path.join(tempRoot, `${row.speakerKey}_${row.lineKey}_${row.variant}`);
    ensureDir(workDir);
    try {
      const lineEnglishWav = await prepareReferenceAudio(take.entry, workDir);
      const picked = await pickVoiceTtsReference({
        db,
        modId,
        packageDir: catalog.ctx.packageDir,
        pluginRelPath: catalog.ctx.pluginRel,
        speakerKey: take.speakerKey || null,
        entry: take.entry,
        lineEnglishWav,
        lineSource: take.source,
        referenceMode,
        voiceSources: catalog.sources,
        getSiblingEntries: (key) =>
          (entriesBySpeaker.get(key) ?? []).filter(
            (candidate) =>
              candidate.lineKey !== take.entry.lineKey || candidate.variant !== take.entry.variant,
          ),
        speakerRefCache,
        markup: catalog.markupStyle,
      });
      const takeWav = await decodeTakeToWav(takePath, workDir);
      const references = picked.clips.map((clip) => ({ wav: fs.readFileSync(clip.wavPath) }));
      if (options.dryRun) {
        base.scored += 1;
        return;
      }
      const similarity = await tts.run((host) => scoreVoiceSimilarity(host, takeWav, references));
      if (similarity == null) {
        base.unscored += 1;
        return;
      }
      await db.query(
        `UPDATE voice_synthesis_state
            SET voice_similarity = $5
          WHERE mod_id = $1 AND target_lang = $2 AND line_key = $3 AND variant = $4
            AND speaker_key = $6 AND voice_similarity IS NULL`,
        [modId, targetLang, row.lineKey.toUpperCase(), row.variant, similarity, row.speakerKey],
      );
      base.scored += 1;
      if (options.limit && base.scored >= options.limit) stop = true;
      if (base.scored % 200 === 0) {
        log(`Voice similarity #${modId}: ${base.scored}/${pending.length} scored`);
      }
    } catch (err) {
      base.unscored += 1;
      log(
        `Voice similarity #${modId}: ${row.speakerKey}/${row.lineKey}_${row.variant} failed (${err instanceof Error ? err.message : String(err)})`,
      );
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  };

  try {
    async function* rows(): AsyncGenerator<PendingRow> {
      for (const row of pending) {
        if (stop) return;
        yield { lineKey: row.line_key, variant: row.variant, speakerKey: row.speaker_key };
      }
    }
    await runPoolOverAsyncIterable(rows(), workers, scoreOne);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  return base;
};
