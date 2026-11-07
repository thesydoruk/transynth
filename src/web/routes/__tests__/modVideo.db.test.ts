import { afterAll, beforeEach, describe, expect, it } from '@jest/globals';
import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../games';
import { PATHS } from '../../../paths';
import { registerModVideoRoutes } from '../mods/video';
import { insertMod, useTestDb } from '../../../testing/testDb';
import { useTestApp } from '../../../testing/testApp';
import { resolveVideoAudioPath, videoFile, videoFileRelPath } from '../../../video/audioStore';
import { registerVideoAsset, setVideoAssetPacked, setVideoAssetProbe } from '../../../video/db';
import { replaceVideoSegments } from '../../../video/segments';
import { syncVideoRecords } from '../../../video/videoRecords';

const uploads = fs.mkdtempSync(path.join(os.tmpdir(), 'video-routes-'));
PATHS.videoUploads = uploads;

const withMultipart = async (app: FastifyInstance) => {
  await app.register(multipart);
};

/** A multipart body with one `file` field, as the agent's upload sends it. */
const filePart = (fileName: string, content: string) => {
  const boundary = '----transynth-test-boundary';
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
        'Content-Type: application/octet-stream\r\n\r\n',
    ),
    Buffer.from(content, 'utf8'),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
};

const intro = {
  fileName: 'Intro_ru.bk2',
  byteSize: 366088784,
  fingerprint: 'abc123',
  agentKey: 'gaming-pc',
};

describe('mod video API', () => {
  const db = useTestDb();
  const app = useTestApp(db, withMultipart, registerModVideoRoutes);
  let modId: number;
  beforeEach(async () => {
    modId = await insertMod(db(), { name: 'Fallout4' });
  });
  afterAll(() => fs.rmSync(uploads, { recursive: true, force: true }));

  it('lists a mod video and serves it by id, under its mod only', async () => {
    const asset = await registerVideoAsset(db(), modId, intro);
    await setVideoAssetProbe(db(), asset.id, {
      durationS: 164.5,
      trackIds: [0, 1],
      sourceTrackId: 0,
    });
    const list = await app().inject({ method: 'GET', url: `/api/mods/${modId}/video` });
    expect(list.statusCode).toBe(200);
    expect(list.json().assets).toHaveLength(1);
    expect(list.json().assets[0]).toMatchObject({
      mod_id: modId,
      file_name: 'Intro_ru.bk2',
      byte_size: 366088784,
      track_ids: [0, 1],
      status: 'registered',
      audio_rel_path: null,
    });
    expect(list.json().services).toBeDefined();

    const one = await app().inject({ method: 'GET', url: `/api/mods/${modId}/video/${asset.id}` });
    expect(one.json().asset.id).toBe(asset.id);
    const other = await insertMod(db(), { name: 'Other' });
    expect(
      (await app().inject({ method: 'GET', url: `/api/mods/${other}/video/${asset.id}` }))
        .statusCode,
    ).toBe(404);

    const audio = await app().inject({
      method: 'GET',
      url: `/api/mods/${modId}/video/${asset.id}/audio/source`,
    });
    expect(audio.statusCode).toBe(404);
    expect(audio.json().error).toMatch(/No source audio/);
  });

  it('refuses an uploaded file that is not the registered video and keeps nothing of it', async () => {
    const asset = await registerVideoAsset(db(), modId, intro);
    const res = await app().inject({
      method: 'PUT',
      url: `/api/mods/${modId}/video/${asset.id}/file`,
      ...filePart('Intro_ru.bk2', 'not the intro'),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/hashes to .* the registered video is abc123/);
    expect(videoFile(asset)).toBeNull();
    expect(fs.existsSync(`${resolveVideoAudioPath(videoFileRelPath(asset))}.part`)).toBe(false);
  });

  it("tracks which dub the asset's copy of the video carries", async () => {
    const asset = await registerVideoAsset(db(), modId, intro);
    await db().query(
      `UPDATE video_assets SET dub_rel_path = 'assets/1/dub_uk.wav', dub_version = 'v2', status = 'dubbed' WHERE id = $1`,
      [asset.id],
    );
    const url = `/api/mods/${modId}/video/${asset.id}`;
    await setVideoAssetPacked(db(), asset.id, 'v1');
    expect((await app().inject({ method: 'GET', url })).json().asset).toMatchObject({
      status: 'dubbed',
      packed_version: 'v1',
    });
    await setVideoAssetPacked(db(), asset.id, 'v2');
    expect((await app().inject({ method: 'GET', url })).json().asset).toMatchObject({
      status: 'packed',
      packed_version: 'v2',
    });
    // The copy is gone (the file arrived anew): back to a dub waiting to be written.
    await setVideoAssetPacked(db(), asset.id, null);
    expect((await app().inject({ method: 'GET', url })).json().asset).toMatchObject({
      status: 'dubbed',
      packed_version: null,
    });
  });

  it('tells the editor which video and timing stand behind a VIDEO string', async () => {
    const asset = await registerVideoAsset(db(), modId, intro);
    await setVideoAssetProbe(db(), asset.id, {
      durationS: 164.5,
      trackIds: [0, 1],
      sourceTrackId: 0,
    });
    await replaceVideoSegments(
      db(),
      asset.id,
      [
        { idx: 0, startS: 1, endS: 2.5, speaker: 'A', text: 'War.' },
        { idx: 1, startS: 4, endS: 6, speaker: 'A', text: 'The end.' },
      ],
      new Map(),
    );
    const sync = await syncVideoRecords(db(), asset, 'en', 'uk');
    const first = await app().inject({
      method: 'GET',
      url: `/api/mods/${modId}/video/phrase/${sync.stringIds.get(0)}`,
    });
    expect(first.json()).toEqual({
      videoId: asset.id,
      idx: 0,
      startS: 1,
      endS: 2.5,
      nextStartS: 4,
      durationS: 164.5,
      hasSpeech: false,
      hasDub: false,
      takeSimilarity: null,
      tempo: null,
      overrun: false,
    });
    const last = await app().inject({
      method: 'GET',
      url: `/api/mods/${modId}/video/phrase/${sync.stringIds.get(1)}`,
    });
    expect(last.json().nextStartS).toBeNull();
    expect(
      (await app().inject({ method: 'GET', url: `/api/mods/${modId}/video/phrase/999999` }))
        .statusCode,
    ).toBe(404);
  });

  it('refuses bad input', async () => {
    expect((await app().inject({ method: 'GET', url: '/api/mods/abc/video' })).statusCode).toBe(
      400,
    );
    expect(
      (await app().inject({ method: 'GET', url: `/api/mods/${modId}/video/999` })).statusCode,
    ).toBe(404);
    expect(
      (await app().inject({ method: 'GET', url: `/api/mods/${modId}/video/1/audio/mix` }))
        .statusCode,
    ).toBe(400);
  });
});
