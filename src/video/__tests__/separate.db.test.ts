import { afterAll, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The audio lands under PATHS.videoUploads, which is fixed at import: point it at a temp dir first.
const uploads = fs.mkdtempSync(path.join(os.tmpdir(), 'video-uploads-'));
process.env.VIDEO_UPLOAD_DIR = uploads;

await import('../../games');
const { insertMod, useTestDb } = await import('../../testing/testDb');
const { registerVideoAsset, setVideoAssetAudio, setVideoAssetProbe, getVideoAsset } =
  await import('../db');
const { separateVideo } = await import('../separate');
const { listVideoSegments } = await import('../segments');
const { videoAudioRelPath, resolveVideoAudioPath } = await import('../audioStore');

type Deps = Parameters<typeof separateVideo>[2];

const result = (
  segments: Array<{ start: number; end: number; text: string; speaker?: string }>,
) => ({
  text: segments.map((s) => s.text).join(' '),
  confidence: 0.9,
  duration: 20,
  language: 'en',
  segments: segments.map((s) => ({ confidence: 0.9, ...s })),
  speakers: [{ id: 'SPEAKER_00', speech_seconds: 10, segment_count: segments.length }],
  tracks: {
    speakers: { SPEAKER_00: 'spk.wav' },
    background: 'background.wav',
    speech: 'speech.wav',
    master: null,
    rttm: null,
    metadata: null,
  },
  overlaps: [],
  elapsed_s: 3,
});

const fakeDeps = (
  segments: Array<{ start: number; end: number; text: string; speaker?: string }>,
  calls: string[],
): NonNullable<Deps> => ({
  submit: async (mediaPath) => {
    calls.push(`submit ${path.basename(mediaPath)}`);
    return { id: 'j1', status: 'queued', stage: '', progress: 0, error: null, host: 'h' };
  },
  wait: async (job, opts) => {
    opts?.onProgress?.({ ...job, stage: 'separating' });
    return result(segments);
  },
  download: async (_job, name, dest) => {
    calls.push(`download ${name} -> ${path.basename(dest)}`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, `wav:${name}`);
    return dest;
  },
  remove: async () => {
    calls.push('remove');
    return true;
  },
});

describe('separateVideo', () => {
  const db = useTestDb();
  afterAll(() => fs.rmSync(uploads, { recursive: true, force: true }));

  let modId: number;
  let videoId: number;
  beforeEach(async () => {
    modId = await insertMod(db(), { name: 'Fallout4' });
    const asset = await registerVideoAsset(db(), modId, {
      fileName: 'Intro_ru.bk2',
      byteSize: 10,
      fingerprint: 'fp',
      agentKey: 'pc',
    });
    await setVideoAssetProbe(db(), asset.id, { durationS: 20, trackIds: [0, 1], sourceTrackId: 0 });
    videoId = asset.id;
    const rel = videoAudioRelPath(asset, 'source');
    const file = resolveVideoAudioPath(rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'RIFF');
    await setVideoAssetAudio(db(), asset.id, rel);
  });

  it('keeps the tracks, writes VIDEO records into the mod and keeps a translation across re-runs', async () => {
    const calls: string[] = [];
    const stages: string[] = [];
    const first = await separateVideo(
      db(),
      { videoId, srcLang: 'en', tgtLang: 'uk', onStage: (s) => stages.push(s) },
      fakeDeps(
        [
          { start: 0.5, end: 2, text: 'War.', speaker: 'SPEAKER_00' },
          { start: 2.1, end: 4, text: 'War never changes.', speaker: 'SPEAKER_00' },
          { start: 9, end: 12, text: 'The end.', speaker: 'SPEAKER_00' },
        ],
        calls,
      ),
    );
    expect(first).toEqual({ modId, phrases: 2, speakers: 1 });
    expect(stages).toEqual(['submitting', 'separating', 'downloading', 'writing']);
    expect(calls).toEqual([
      'submit source.wav',
      'download speech.wav -> speech.wav',
      'download background.wav -> background.wav',
      'remove',
    ]);

    const asset = (await getVideoAsset(db(), videoId))!;
    expect(asset.status).toBe('separated');
    // The derived audio sits in the folder shared by every asset of this file.
    expect(videoAudioRelPath(asset, 'speech')).toBe(path.join('src', 'fp', 'speech.wav'));
    expect(fs.existsSync(resolveVideoAudioPath(videoAudioRelPath(asset, 'speech')))).toBe(true);

    const segments = await listVideoSegments(db(), videoId, 'uk');
    expect(segments.map((s) => [s.idx, s.source_text, s.start_s, s.end_s])).toEqual([
      [0, 'War. War never changes.', 0.5, 4],
      [1, 'The end.', 9, 12],
    ]);
    const { rows: records } = await db().query(
      `SELECT r.edid, r.path, r.formid_hex, r.signature FROM records r WHERE r.mod_id = $1 ORDER BY r.path`,
      [modId],
    );
    // The MCM shape: the key in the path, no FormID, the EDID naming video and phrase.
    expect(records).toEqual([
      {
        edid: 'Intro_ru#000',
        path: 'VIDEO\\Intro_ru.bk2\\000',
        formid_hex: '',
        signature: 'VIDEO',
      },
      {
        edid: 'Intro_ru#001',
        path: 'VIDEO\\Intro_ru.bk2\\001',
        formid_hex: '',
        signature: 'VIDEO',
      },
    ]);

    // A translation of the first phrase survives a second run whose first phrase reads the same.
    await db().query(
      `INSERT INTO translations (src_string_id, target_lang, text, status, confidence)
       VALUES ($1, 'uk', 'Війна. Війна ніколи не змінюється.', 'reviewed', 1)`,
      [segments[0]!.string_id],
    );
    const second = await separateVideo(
      db(),
      { videoId, srcLang: 'en', tgtLang: 'uk' },
      fakeDeps(
        [
          { start: 0.6, end: 4.2, text: 'War. War never changes.', speaker: 'SPEAKER_00' },
          { start: 9, end: 12, text: 'The very end.', speaker: 'SPEAKER_00' },
        ],
        [],
      ),
    );
    expect(second.modId).toBe(modId);
    const again = await listVideoSegments(db(), videoId, 'uk');
    expect(again.map((s) => [s.source_text, s.translation])).toEqual([
      ['War. War never changes.', 'Війна. Війна ніколи не змінюється.'],
      ['The very end.', null],
    ]);
    expect(again[0]!.string_id).toBe(segments[0]!.string_id);
    expect(again[1]!.string_id).not.toBe(segments[1]!.string_id);
  });

  it('with keepPhrases replaces the tracks and leaves the phrases, takes and status alone', async () => {
    await separateVideo(
      db(),
      { videoId, srcLang: 'en', tgtLang: 'uk' },
      fakeDeps([{ start: 0.5, end: 2, text: 'War.', speaker: 'SPEAKER_00' }], []),
    );
    const before = await listVideoSegments(db(), videoId, 'uk');
    await db().query(
      `UPDATE video_segments SET take_rel_path = 'assets/1/takes/0000.wav', take_version = 'tv' WHERE video_id = $1`,
      [videoId],
    );
    await db().query(`UPDATE video_assets SET status = 'packed' WHERE id = $1`, [videoId]);
    const speech = resolveVideoAudioPath(
      videoAudioRelPath((await getVideoAsset(db(), videoId))!, 'speech'),
    );
    const stamp = fs.statSync(speech).mtimeMs;
    fs.writeFileSync(speech, 'old');

    const calls: string[] = [];
    const outcome = await separateVideo(
      db(),
      { videoId, srcLang: 'en', tgtLang: 'uk', keepPhrases: true },
      // A transcript that differs: it must not reach the phrases.
      fakeDeps([{ start: 0.6, end: 4, text: 'War never changes.', speaker: 'SPEAKER_00' }], calls),
    );
    expect(outcome).toEqual({ modId, phrases: 1, speakers: 1 });
    expect(calls).toContain('download speech.wav -> speech.wav');
    expect(fs.readFileSync(speech, 'utf8')).toBe('wav:speech.wav');
    expect(fs.statSync(speech).mtimeMs).toBeGreaterThanOrEqual(stamp);
    const after = await listVideoSegments(db(), videoId, 'uk');
    expect(after.map((s) => [s.id, s.source_text, s.take_rel_path, s.string_id])).toEqual(
      before.map((s) => [s.id, s.source_text, 'assets/1/takes/0000.wav', s.string_id]),
    );
    expect((await getVideoAsset(db(), videoId))!.status).toBe('packed');
  });

  it('marks the asset as failed when the lane fails, and still removes the job', async () => {
    const calls: string[] = [];
    const deps = fakeDeps([], calls);
    deps.wait = async () => {
      throw new Error('audio-intel job j1 failed: OOM');
    };
    await expect(
      separateVideo(db(), { videoId, srcLang: 'en', tgtLang: 'uk' }, deps),
    ).rejects.toThrow(/OOM/);
    const asset = (await getVideoAsset(db(), videoId))!;
    expect(asset.status).toBe('error');
    expect(asset.error).toMatch(/OOM/);
    expect(calls).toContain('remove');
  });
});
