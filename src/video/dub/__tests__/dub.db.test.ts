import { afterAll, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const uploads = fs.mkdtempSync(path.join(os.tmpdir(), 'video-dub-'));
process.env.VIDEO_UPLOAD_DIR = uploads;

await import('../../../games');
const { insertMod, useTestDb } = await import('../../../testing/testDb');
const { registerVideoAsset, setVideoAssetAudio, setVideoAssetProbe, getVideoAsset } =
  await import('../../db');
const { replaceVideoSegments, listVideoSegments } = await import('../../segments');
const { syncVideoRecords } = await import('../../videoRecords');
const { videoAudioRelPath, resolveVideoAudioPath } = await import('../../audioStore');
const { dubVideo } = await import('..');
const { disposeServicePools } = await import('../../../services/pools');

/** A 16-bit mono WAV of `seconds` at 22.05 kHz (silence), enough for wavDurationSec. */
const wavOf = (seconds: number): Buffer => {
  const rate = 22050;
  const samples = Math.round(seconds * rate);
  const data = Buffer.alloc(samples * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
};

describe('dubVideo', () => {
  const db = useTestDb();
  // loadVoiceProjectSettings builds the TTS pool, whose health timer would log after the run.
  afterAll(() => {
    disposeServicePools();
    fs.rmSync(uploads, { recursive: true, force: true });
  });

  let videoId: number;
  let stringIds: number[];
  beforeEach(async () => {
    const modId = await insertMod(db(), { name: 'Fallout4' });
    const asset = await registerVideoAsset(db(), modId, {
      fileName: 'Intro_ru.bk2',
      byteSize: 10,
      fingerprint: 'fp',
      agentKey: 'pc',
    });
    await setVideoAssetProbe(db(), asset.id, { durationS: 30, trackIds: [0, 1], sourceTrackId: 0 });
    videoId = asset.id;
    for (const kind of ['source', 'speech', 'background'] as const) {
      const file = resolveVideoAudioPath(videoAudioRelPath(asset, kind));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, wavOf(30));
    }
    await setVideoAssetAudio(db(), asset.id, videoAudioRelPath(asset, 'source'));
    await db().query(`UPDATE video_assets SET status = 'separated' WHERE id = $1`, [asset.id]);

    await replaceVideoSegments(
      db(),
      videoId,
      [
        { idx: 0, startS: 1, endS: 2.5, speaker: 'A', text: 'War.' },
        { idx: 1, startS: 3, endS: 6, speaker: 'A', text: 'War never changes.' },
        { idx: 2, startS: 20, endS: 22, speaker: 'A', text: 'The end.' },
      ],
      new Map(),
    );
    const sync = await syncVideoRecords(db(), asset, 'en', 'uk');
    stringIds = [0, 1, 2].map((idx) => sync.stringIds.get(idx)!);
    // Two phrases translated; the third stays English and gets no take.
    await db().query(
      `INSERT INTO translations (src_string_id, target_lang, text, status, confidence) VALUES
         ($1, 'uk', 'Війна.', 'reviewed', 1), ($2, 'uk', '*зітхає* Війна ніколи не змінюється.', 'reviewed', 1)`,
      [stringIds[0], stringIds[1]],
    );
  });

  it('synthesizes translated phrases, fits them, mixes the dub, and redoes only changes next time', async () => {
    const ffmpegCalls: string[][] = [];
    const ffmpeg = async (args: string[]) => {
      ffmpegCalls.push(args);
      const out = args[args.length - 1]!;
      if (args.includes('loudnorm=print_format=json')) {
        return { stdout: '', stderr: '{ "input_i" : "-20.5" }' };
      }
      if (out !== '-') {
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, wavOf(1));
      }
      return { stdout: '', stderr: '' };
    };
    const synthesized: string[] = [];
    const synthesize = async (
      text: string,
      refs: string | Array<{ wavPath: string; speakerText?: string | null }>,
    ) => {
      synthesized.push(
        `${text} <- ${(Array.isArray(refs) ? refs : []).map((r) => r.speakerText).join(' | ')}`,
      );
      // The second phrase's take is 4 s for a 3 s slot (up to the next phrase at 20 s it fits).
      return {
        wav: wavOf(text.startsWith('Війна ніколи') ? 4 : 1.2),
        voiceSimilarity: 0.55,
        takes: 1,
      };
    };

    const first = await dubVideo(db(), {
      videoId,
      tgtLang: 'uk',
      scope: { kind: 'changed' },
      ffmpeg,
      synthesize,
    });
    expect(first).toMatchObject({ synthesized: 2, takes: 2, overruns: 0, skipped: 1 });
    // Stage directions are stripped; the phrase's own slice is the first reference, neighbours follow.
    expect(synthesized).toEqual([
      'Війна. <- War. | War never changes. | The end.',
      'Війна ніколи не змінюється. <- War never changes. | War. | The end.',
    ]);
    const asset = (await getVideoAsset(db(), videoId))!;
    expect(asset.status).toBe('dubbed');
    expect(asset.dub_rel_path).toBe(videoAudioRelPath(asset, 'dub', 'uk'));
    expect(fs.existsSync(resolveVideoAudioPath(asset.dub_rel_path!))).toBe(true);
    const segments = await listVideoSegments(db(), videoId, 'uk');
    expect(
      segments.map((s) => [s.idx, s.take_rel_path != null, s.take_similarity, s.tempo, s.overrun]),
    ).toEqual([
      [0, true, 0.55, 1, false],
      [1, true, 0.55, 1, false],
      [2, false, null, null, false],
    ]);
    const mix = ffmpegCalls.find((args) => args.includes('-filter_complex_script'))!;
    expect(mix.filter((a) => a.endsWith('.wav')).length).toBe(3 + 1); // background + 2 takes + output

    // A retranslation of phrase 1 is the only thing a second `changed` run synthesizes.
    await db().query(
      `UPDATE translations SET text = 'Війна не міняється.' WHERE src_string_id = $1`,
      [stringIds[1]],
    );
    synthesized.length = 0;
    const second = await dubVideo(db(), {
      videoId,
      tgtLang: 'uk',
      scope: { kind: 'changed' },
      ffmpeg,
      synthesize,
    });
    expect(second).toMatchObject({ synthesized: 1, takes: 2 });
    expect(synthesized).toEqual(['Війна не міняється. <- War never changes. | War. | The end.']);
    expect(second.dubVersion).not.toBe(first.dubVersion);
  });
});
