import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mapWithConcurrency, type Semaphore } from '../../../utils/concurrency';
import { analyzeUkVoiceWav } from '../analyzeClip';
import type { UkVoiceGender } from '../types';
import { pickAnalyzeCandidates, type ClipCandidate } from './clipCandidates';
import { createUkVoiceImportSemaphore, ukVoiceImportConcurrency } from './importConcurrency';
import { normalizeLocalReferenceClip } from './normalizeLocal';

export type { ClipCandidate } from './clipCandidates';
export {
  MAX_ANALYZE_CANDIDATES,
  pickAnalyzeCandidates,
  REF_MAX_DUR,
  REF_MIN_DUR,
  REF_TARGET_DUR,
} from './clipCandidates';

export type BestClipResult = {
  candidate: ClipCandidate;
  qualityScore: number;
  meanF0Hz: number | null;
  detectedGender: UkVoiceGender;
  genderConfidence: number;
  candidatesScored: number;
};

export type SelectBestClipOptions = {
  /** Shared pool so nested import stages stay within the CPU budget. */
  semaphore?: Semaphore;
};

/**
 * Decode + score candidates; return the highest qualityScore winner.
 * Uses a temp WAV so the corpus cache stays in original format.
 */
export const selectBestClip = async (
  candidates: ClipCandidate[],
  options: SelectBestClipOptions = {},
): Promise<BestClipResult | null> => {
  const shortlist = pickAnalyzeCandidates(candidates);
  if (shortlist.length === 0) return null;

  const concurrency = ukVoiceImportConcurrency();
  const semaphore = options.semaphore ?? createUkVoiceImportSemaphore();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uk-voice-sel-'));
  try {
    const scored = await mapWithConcurrency(shortlist, concurrency, async (candidate) => {
      if (!fs.existsSync(candidate.audioPath)) return null;
      const tmpWav = path.join(tmpDir, `${candidate.id.replace(/[^\w.-]+/g, '_')}.wav`);
      try {
        return await semaphore.run(async () => {
          await normalizeLocalReferenceClip(candidate.audioPath, tmpWav);
          const analysis = analyzeUkVoiceWav(tmpWav);
          return {
            candidate,
            qualityScore: analysis.qualityScore,
            meanF0Hz: analysis.meanF0Hz,
            detectedGender: analysis.gender,
            genderConfidence: analysis.genderConfidence,
            candidatesScored: shortlist.length,
          } satisfies BestClipResult;
        });
      } catch {
        return null;
      }
    });

    let best: BestClipResult | null = null;
    for (const row of scored) {
      if (!row) continue;
      if (!best || row.qualityScore > best.qualityScore) best = row;
    }
    return best;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
};
