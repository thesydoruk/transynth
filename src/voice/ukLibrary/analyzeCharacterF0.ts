import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Tx } from '../../db';
import { loadModImportPaths } from '../../import/mod/resolvePaths';
import { log } from '../../logger';
import { pluginRelPath, resolveImportPackages } from '../../modImport';
import { mapWithConcurrency } from '../../utils/concurrency';
import { ensureDir } from '../../utils/file';
import {
  dedupeVoiceFiles,
  discoverVoiceFiles,
  resolveVoiceRootRel,
  type VoiceFileEntry,
} from '../discoverVoiceFiles';
import { prepareReferenceAudio } from '../prepareReferenceAudio';
import { groupVoiceFilesBySpeaker } from '../speakerReference';
import { analyzeUkVoiceWav } from './analyzeClip';
import { upsertCharacterVoiceProfile } from './characterProfiles';
import { listUkVoiceCharacters } from './characters';
import { isRobotVoiceFolder } from './robotFolders';

const TARGET_SAMPLES = 5;
const MAX_ATTEMPTS = 12;
const MAX_CANDIDATES_INDEXED = 40;
const DEFAULT_CONCURRENCY = Math.max(2, Math.min(6, Math.floor(os.cpus().length / 2) || 2));

export type AnalyzeCharacterF0Result = {
  analyzed: number;
  withF0: number;
  failed: number;
  skipped: number;
};

type IndexedCandidate = {
  entry: VoiceFileEntry;
  modId: number;
  fileBytes: number;
};

const listModIdsWithSpeakers = async (db: Tx): Promise<number[]> => {
  const { rows } = await db.query<{ mod_id: number }>(
    `SELECT DISTINCT mod_id FROM dialog_speakers ORDER BY mod_id`,
  );
  return rows.map((row) => row.mod_id);
};

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
};

/** Prefer mid-sized voice assets (more likely to be spoken lines, not tiny barks). */
const rankCandidates = (candidates: IndexedCandidate[]): IndexedCandidate[] =>
  [...candidates].sort((a, b) => {
    const ideal = 80_000;
    return Math.abs(a.fileBytes - ideal) - Math.abs(b.fileBytes - ideal);
  });

const indexVoiceCandidates = async (
  db: Tx,
  characterKeys: Set<string>,
): Promise<Map<string, IndexedCandidate[]>> => {
  const byCharacter = new Map<string, IndexedCandidate[]>();
  const modIds = await listModIdsWithSpeakers(db);

  for (const modId of modIds) {
    let paths;
    try {
      paths = await loadModImportPaths(db, { modId });
    } catch {
      continue;
    }
    if (!paths.extractDir || !fs.existsSync(paths.extractDir)) continue;

    try {
      for (const pkg of resolveImportPackages(
        paths.extractDir,
        paths.targetLang,
        paths.pluginPath,
      )) {
        const pluginRel = pluginRelPath(pkg.packageDir, pkg.pluginPath);
        const voiceRootRel = resolveVoiceRootRel(pluginRel);
        const grouped = groupVoiceFilesBySpeaker(
          dedupeVoiceFiles(discoverVoiceFiles(pkg.packageDir, pluginRel)),
          voiceRootRel,
        );
        for (const [speaker, entries] of grouped) {
          if (!characterKeys.has(speaker)) continue;
          const list = byCharacter.get(speaker) ?? [];
          if (list.length >= MAX_CANDIDATES_INDEXED) continue;
          for (const entry of entries) {
            if (list.length >= MAX_CANDIDATES_INDEXED) break;
            let fileBytes = 0;
            try {
              fileBytes = fs.statSync(entry.absolutePath).size;
            } catch {
              continue;
            }
            list.push({ entry, modId, fileBytes });
          }
          byCharacter.set(speaker, list);
        }
      }
    } catch (err) {
      log.warn(
        `Character F0 index skipped mod ${modId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return byCharacter;
};

const analyzeOneCharacter = async (
  characterKey: string,
  candidates: IndexedCandidate[],
  tempRoot: string,
): Promise<{ meanF0Hz: number | null; sampleCount: number; attempts: number }> => {
  const workDir = path.join(tempRoot, characterKey.replace(/[^\w.-]+/g, '_'));
  ensureDir(workDir);
  const f0s: number[] = [];
  let attempts = 0;

  for (const candidate of rankCandidates(candidates)) {
    if (f0s.length >= TARGET_SAMPLES || attempts >= MAX_ATTEMPTS) break;
    attempts += 1;
    try {
      const wavPath = await prepareReferenceAudio(candidate.entry, workDir);
      const analysis = analyzeUkVoiceWav(wavPath);
      if (analysis.meanF0Hz != null) f0s.push(analysis.meanF0Hz);
    } catch {
      // Skip undecodable / missing assets.
    }
  }

  const mean = median(f0s);
  return {
    meanF0Hz: mean == null ? null : Math.round(mean * 10) / 10,
    sampleCount: f0s.length,
    attempts,
  };
};

/**
 * Estimate mean F0 for game voice-folder characters from EN dialogue clips
 * and store results in `character_voice_profiles`.
 */
export const analyzeCharacterVoiceF0 = async (
  db: Tx,
  options: { concurrency?: number; includeRobots?: boolean } = {},
): Promise<AnalyzeCharacterF0Result> => {
  const characters = (await listUkVoiceCharacters(db)).filter(
    (c) => options.includeRobots || !isRobotVoiceFolder(c.characterKey),
  );
  const keys = new Set(characters.map((c) => c.characterKey));
  log.info(`Character F0: indexing voice clips for ${keys.size} character(s)…`);
  const indexed = await indexVoiceCandidates(db, keys);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'char-f0-'));
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  let analyzed = 0;
  let withF0 = 0;
  let failed = 0;
  let skipped = 0;

  try {
    await mapWithConcurrency(characters, concurrency, async (character) => {
      const candidates = indexed.get(character.characterKey) ?? [];
      if (candidates.length === 0) {
        skipped += 1;
        await upsertCharacterVoiceProfile(db, {
          characterKey: character.characterKey,
          meanF0Hz: null,
          sampleCount: 0,
          meta: { analysis: 'f0_autocorr_v1', reason: 'no_voice_clips' },
        });
        return;
      }

      try {
        const result = await analyzeOneCharacter(character.characterKey, candidates, tempRoot);
        analyzed += 1;
        if (result.meanF0Hz != null) withF0 += 1;
        await upsertCharacterVoiceProfile(db, {
          characterKey: character.characterKey,
          meanF0Hz: result.meanF0Hz,
          sampleCount: result.sampleCount,
          meta: {
            analysis: 'f0_autocorr_v1',
            attempts: result.attempts,
            candidates: candidates.length,
          },
        });
        if (analyzed % 25 === 0) {
          log.info(`Character F0 progress: ${analyzed}/${characters.length} (withF0=${withF0})`);
        }
      } catch (err) {
        failed += 1;
        log.warn(
          `Character F0 failed ${character.characterKey}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  return { analyzed, withF0, failed, skipped };
};
