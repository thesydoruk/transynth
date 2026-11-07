import { beforeEach, describe, expect, it } from '@jest/globals';
import '../../../games';
import { registerModVideoRoutes } from '../mods/video';
import { insertMod, useTestDb } from '../../../testing/testDb';
import { useTestApp } from '../../../testing/testApp';
import { registerVideoAsset } from '../../../video/db';
import { replaceVideoSegments } from '../../../video/segments';
import { syncVideoRecords } from '../../../video/videoRecords';

const intro = {
  fileName: 'Intro_ru.bk2',
  byteSize: 366088784,
  fingerprint: 'abc123',
  durationS: 164.5,
  trackIds: [0, 1],
  sourceTrackId: 0,
  agentKey: 'gaming-pc',
};

describe('mod video API', () => {
  const db = useTestDb();
  const app = useTestApp(db, registerModVideoRoutes);
  let modId: number;
  beforeEach(async () => {
    modId = await insertMod(db(), { name: 'Fallout4' });
  });

  it('lists a mod video and serves it by id, under its mod only', async () => {
    const asset = await registerVideoAsset(db(), modId, intro);
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

  it('records the dub version the agent wrote into the video', async () => {
    const asset = await registerVideoAsset(db(), modId, intro);
    await db().query(
      `UPDATE video_assets SET dub_rel_path = 'assets/1/dub_uk.wav', dub_version = 'v2', status = 'dubbed' WHERE id = $1`,
      [asset.id],
    );
    const url = `/api/mods/${modId}/video/${asset.id}`;
    const stale = await app().inject({
      method: 'POST',
      url: `${url}/packed`,
      payload: { dubVersion: 'v1' },
    });
    expect(stale.json()).toEqual({ ok: true, current: false });
    expect((await app().inject({ method: 'GET', url })).json().asset).toMatchObject({
      status: 'dubbed',
      packed_version: 'v1',
    });
    const current = await app().inject({
      method: 'POST',
      url: `${url}/packed`,
      payload: { dubVersion: 'v2' },
    });
    expect(current.json()).toEqual({ ok: true, current: true });
    expect((await app().inject({ method: 'GET', url })).json().asset).toMatchObject({
      status: 'packed',
      packed_version: 'v2',
    });
    expect(
      (await app().inject({ method: 'POST', url: `${url}/packed`, payload: {} })).statusCode,
    ).toBe(400);
  });

  it('tells the editor which video and timing stand behind a VIDEO string', async () => {
    const asset = await registerVideoAsset(db(), modId, intro);
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
