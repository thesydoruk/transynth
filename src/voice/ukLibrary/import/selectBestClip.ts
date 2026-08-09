import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyzeUkVoiceWav } from '../analyzeClip';
import type { UkVoiceGender } from '../types';
import { pickAnalyzeCandidates, type ClipCandidate } from './clipCandidates';
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

/**
 * Decode + score candidates; return the highest qualityScore winner.
 * Uses a temp WAV so the corpus cache stays in original format.
 */
export const selectBestClip = async (
  candidates: ClipCandidate[],
): Promise<BestClipResult | null> => {
  const shortlist = pickAnalyzeCandidates(candidates);
  if (shortlist.length === 0) return null;

  let best: BestClipResult | null = null;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uk-voice-sel-'));
  try {
    for (const candidate of shortlist) {
      if (!fs.existsSync(candidate.audioPath)) continue;
      const tmpWav = path.join(tmpDir, `${candidate.id.replace(/[^\w.-]+/g, '_')}.wav`);
      try {
        await normalizeLocalReferenceClip(candidate.audioPath, tmpWav);
        const analysis = analyzeUkVoiceWav(tmpWav);
        if (!best || analysis.qualityScore > best.qualityScore) {
          best = {
            candidate,
            qualityScore: analysis.qualityScore,
            meanF0Hz: analysis.meanF0Hz,
            detectedGender: analysis.gender,
            genderConfidence: analysis.genderConfidence,
            candidatesScored: shortlist.length,
          };
        }
      } catch {
        // Skip unreadable clips.
      }
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  return best;
};
