import fs from 'node:fs';
import type { Tx } from '../../../db';
import { log } from '../../../logger';
import { modeAge, type UkVoiceAge } from '../ageBand';
import { analyzeUkVoiceWav } from '../analyzeClip';
import { upsertUkVoiceLibraryRow } from '../db';
import { ukVoiceAudioAbsPath, ukVoiceAudioRelPath, ukVoiceSourceDir } from '../paths';
import type { UkVoiceLibraryRow } from '../types';
import { cvSpeakerVoiceId } from './clientId';
import { parseValidatedTsv, resolveCvClipPath } from './commonVoiceTsv';
import { cacheCommonVoice26Uk, findValidatedTsv, isCommonVoiceCacheReady } from './mdcDownload';
import { normalizeLocalReferenceClip } from './normalizeLocal';
import { probeAudioDurationSec } from './probeDuration';
import { selectBestClip, type ClipCandidate } from './selectBestClip';

export type ImportCommonVoiceOptions = {
  /** Max speakers to import (default: all). */
  maxVoices?: number;
};

type SpeakerBucket = {
  clientId: string;
  gender: 'male' | 'female' | 'unknown';
  clips: Array<{ path: string; sentence: string; upVotes: number; age: UkVoiceAge }>;
};

/** Import one best-reference clip per Common Voice client_id from the full local cache. */
export const importCommonVoiceVoices = async (
  db: Tx,
  options: ImportCommonVoiceOptions = {},
): Promise<number> => {
  ukVoiceSourceDir('common_voice');

  if (!isCommonVoiceCacheReady()) {
    await cacheCommonVoice26Uk();
  }
  const cacheDir = await cacheCommonVoice26Uk();
  const tsvPath = findValidatedTsv(cacheDir);
  if (!tsvPath) throw new Error(`validated.tsv not found under ${cacheDir}`);

  const rows = parseValidatedTsv(tsvPath);
  const bySpeaker = new Map<string, SpeakerBucket>();
  for (const row of rows) {
    let bucket = bySpeaker.get(row.clientId);
    if (!bucket) {
      bucket = { clientId: row.clientId, gender: row.gender, clips: [] };
      bySpeaker.set(row.clientId, bucket);
    }
    if (bucket.gender === 'unknown' && row.gender !== 'unknown') bucket.gender = row.gender;
    bucket.clips.push({
      path: row.path,
      sentence: row.sentence,
      upVotes: row.upVotes,
      age: row.age,
    });
  }

  const speakers = [...bySpeaker.values()].sort((a, b) => b.clips.length - a.clips.length);
  const limit =
    options.maxVoices != null && options.maxVoices > 0 ? options.maxVoices : speakers.length;
  let imported = 0;

  for (const speaker of speakers.slice(0, limit)) {
    const voiceId = cvSpeakerVoiceId(speaker.clientId);
    const topClips = [...speaker.clips].sort((a, b) => b.upVotes - a.upVotes).slice(0, 40);

    const candidates: ClipCandidate[] = [];
    for (const clip of topClips) {
      const abs = resolveCvClipPath(tsvPath, clip.path);
      if (!fs.existsSync(abs)) continue;
      const durationSec = await probeAudioDurationSec(abs);
      candidates.push({
        id: clip.path,
        audioPath: abs,
        durationSec,
        transcript: clip.sentence,
        upVotes: clip.upVotes,
      });
    }

    const best = await selectBestClip(candidates);
    if (!best) {
      log.warn(`common_voice: no usable clip for ${voiceId}`);
      continue;
    }

    const fileName = `${voiceId.replace('cv:', 'cv_')}.wav`;
    const rel = ukVoiceAudioRelPath('common_voice', fileName);
    const libraryAbs = ukVoiceAudioAbsPath(rel);
    await normalizeLocalReferenceClip(best.candidate.audioPath, libraryAbs);
    const analysis = analyzeUkVoiceWav(libraryAbs);

    const tsvGender = speaker.gender;
    const gender = tsvGender !== 'unknown' ? tsvGender : analysis.gender;
    const genderSource =
      tsvGender !== 'unknown'
        ? 'cv_tsv'
        : analysis.gender === 'unknown'
          ? 'detected_uncertain'
          : 'detected';
    const winnerClip = speaker.clips.find((clip) => clip.path === best.candidate.id);
    const age = modeAge([...speaker.clips.map((clip) => clip.age), winnerClip?.age ?? 'unknown']);

    const libraryRow: UkVoiceLibraryRow = {
      id: voiceId,
      source: 'common_voice',
      displayName: `CV ${voiceId.slice(3, 11)}`,
      description: 'Mozilla Common Voice Ukrainian speaker (CC0), best clip selected.',
      gender,
      age,
      audioRelPath: rel,
      transcript: best.candidate.transcript,
      license: 'CC0',
      durationSec: best.candidate.durationSec,
      qualityScore: analysis.qualityScore,
      genderSource,
      meanF0Hz: analysis.meanF0Hz,
      analyzedAt: new Date().toISOString(),
      speakerKey: speaker.clientId,
      meta: {
        clientId: speaker.clientId,
        clipPath: best.candidate.id,
        candidatesScored: best.candidatesScored,
        clipCount: speaker.clips.length,
        age,
      },
    };
    await upsertUkVoiceLibraryRow(db, libraryRow);
    imported += 1;
    if (imported % 25 === 0) {
      log.info(`common_voice: imported ${imported}/${Math.min(limit, speakers.length)}`);
    }
  }

  log.info(`common_voice: imported ${imported} speaker(s) from ${speakers.length}`);
  return imported;
};
