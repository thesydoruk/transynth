import fs from 'node:fs';
import type { Tx } from '../../../db';
import { log } from '../../../logger';
import { mapWithConcurrency } from '../../../utils/concurrency';
import { modeAge, type UkVoiceAge } from '../ageBand';
import { analyzeUkVoiceWav } from '../analyzeClip';
import { upsertUkVoiceLibraryRow } from '../db';
import { ukVoiceAudioAbsPath, ukVoiceAudioRelPath, ukVoiceSourceDir } from '../paths';
import type { UkVoiceLibraryRow } from '../types';
import { cvSpeakerVoiceId, modeCvGender } from './clientId';
import { parseValidatedTsv, resolveCvClipPath } from './commonVoiceTsv';
import { createUkVoiceImportSemaphore, ukVoiceImportConcurrency } from './importConcurrency';
import { cacheCommonVoice26Uk, findValidatedTsv, isCommonVoiceCacheReady } from './mdcDownload';
import { normalizeLocalReferenceClip } from './normalizeLocal';
import { probeAudioDurationSec } from './probeDuration';
import { selectBestClip, type ClipCandidate } from './selectBestClip';
import { isUsableTranscript } from './transcriptQuality';

export type ImportCommonVoiceOptions = {
  /** Max speakers to import (default: all). */
  maxVoices?: number;
};

export type ImportCommonVoiceResult = { count: number; ids: string[] };

type SpeakerBucket = {
  clientId: string;
  clips: Array<{
    path: string;
    sentence: string;
    upVotes: number;
    age: UkVoiceAge;
    gender: 'male' | 'female' | 'unknown';
  }>;
};

/** Import one best-reference clip per Common Voice client_id from the full local cache. */
export const importCommonVoiceVoices = async (
  db: Tx,
  options: ImportCommonVoiceOptions = {},
): Promise<ImportCommonVoiceResult> => {
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
      bucket = { clientId: row.clientId, clips: [] };
      bySpeaker.set(row.clientId, bucket);
    }
    bucket.clips.push({
      path: row.path,
      sentence: row.sentence,
      upVotes: row.upVotes,
      age: row.age,
      gender: row.gender,
    });
  }

  const speakers = [...bySpeaker.values()].sort((a, b) => b.clips.length - a.clips.length);
  const limit =
    options.maxVoices != null && options.maxVoices > 0 ? options.maxVoices : speakers.length;
  const concurrency = ukVoiceImportConcurrency();
  const semaphore = createUkVoiceImportSemaphore();
  log.info(
    `common_voice: importing ${Math.min(limit, speakers.length)} speaker(s) concurrency=${concurrency}`,
  );

  let imported = 0;
  const results = await mapWithConcurrency(
    speakers.slice(0, limit),
    concurrency,
    async (speaker) => {
      const voiceId = cvSpeakerVoiceId(speaker.clientId);
      const topClips = [...speaker.clips]
        .filter((clip) => isUsableTranscript(clip.sentence))
        .sort((a, b) => b.upVotes - a.upVotes || b.sentence.length - a.sentence.length)
        .slice(0, 40);

      const probed = await mapWithConcurrency(topClips, concurrency, async (clip) => {
        const abs = resolveCvClipPath(tsvPath, clip.path);
        if (!fs.existsSync(abs)) return null;
        const durationSec = await semaphore.run(() => probeAudioDurationSec(abs));
        const candidate: ClipCandidate = {
          id: clip.path,
          audioPath: abs,
          durationSec,
          transcript: clip.sentence,
          upVotes: clip.upVotes,
        };
        return candidate;
      });
      const candidates = probed.filter((c): c is ClipCandidate => c != null);

      const best = await selectBestClip(candidates, { semaphore });
      if (!best) {
        log.warn(`common_voice: no usable clip for ${voiceId}`);
        return null;
      }

      const fileName = `${voiceId.replace('cv:', 'cv_')}.wav`;
      const rel = ukVoiceAudioRelPath('common_voice', fileName);
      const libraryAbs = ukVoiceAudioAbsPath(rel);
      await semaphore.run(async () => {
        await normalizeLocalReferenceClip(best.candidate.audioPath, libraryAbs);
      });
      const analysis = analyzeUkVoiceWav(libraryAbs);

      // Gender/age come only from CV validated.tsv metadata — never from F0 detection.
      const gender = modeCvGender(speaker.clips.map((clip) => clip.gender));
      const age = modeAge(speaker.clips.map((clip) => clip.age));

      const libraryRow: UkVoiceLibraryRow = {
        id: voiceId,
        source: 'common_voice',
        displayName: `CV ${voiceId.slice(3, 11)}`,
        description: null,
        gender,
        age,
        audioRelPath: rel,
        transcript: best.candidate.transcript,
        license: 'CC0',
        durationSec: best.candidate.durationSec,
        qualityScore: analysis.qualityScore,
        genderSource: gender === 'unknown' ? null : 'cv_tsv',
        meanF0Hz: analysis.meanF0Hz,
        analyzedAt: new Date().toISOString(),
        speakerKey: speaker.clientId,
        meta: {
          clientId: speaker.clientId,
          clipPath: best.candidate.id,
          candidatesScored: best.candidatesScored,
          clipCount: speaker.clips.length,
          age,
          gender,
        },
      };
      await upsertUkVoiceLibraryRow(db, libraryRow);
      imported += 1;
      if (imported % 25 === 0) {
        log.info(`common_voice: imported ${imported}/${Math.min(limit, speakers.length)}`);
      }
      return voiceId;
    },
  );

  const ids = results.filter((id): id is string => id != null);
  log.info(`common_voice: imported ${ids.length} speaker(s) from ${speakers.length}`);
  return { count: ids.length, ids };
};
