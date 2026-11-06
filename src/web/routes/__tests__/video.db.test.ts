import { describe, expect, it } from '@jest/globals';
import '../../../games';
import { videoRoutes } from '../video';
import { useTestDb } from '../../../testing/testDb';
import { useTestApp } from '../../../testing/testApp';

const intro = {
  fileName: 'Intro_ru.bk2',
  byteSize: 366088784,
  fingerprint: 'abc123',
  durationS: 164.5,
  trackIds: [0, 1],
  sourceTrackId: 0,
  agentKey: 'gaming-pc',
};

describe('video API', () => {
  const db = useTestDb();
  const app = useTestApp(db, videoRoutes);

  it('registers a video, lists it and serves it by id', async () => {
    const created = await app().inject({
      method: 'POST',
      url: '/api/video/fo4/assets',
      payload: intro,
    });
    expect(created.statusCode).toBe(201);
    const { asset } = created.json();
    expect(asset).toMatchObject({
      game: 'fo4',
      file_name: 'Intro_ru.bk2',
      byte_size: 366088784,
      track_ids: [0, 1],
      source_track_id: 0,
      status: 'registered',
      audio_rel_path: null,
    });

    const list = await app().inject({ method: 'GET', url: '/api/video/fo4' });
    expect(list.json().assets.map((a: { file_name: string }) => a.file_name)).toEqual([
      'Intro_ru.bk2',
    ]);

    const one = await app().inject({ method: 'GET', url: `/api/video/fo4/${asset.id}` });
    expect(one.json().asset.id).toBe(asset.id);

    const audio = await app().inject({
      method: 'GET',
      url: `/api/video/fo4/${asset.id}/audio/source`,
    });
    expect(audio.statusCode).toBe(404);
    expect(audio.json().error).toMatch(/No source audio/);
  });

  it('keeps the upload when the file is unchanged and drops it when the fingerprint moves', async () => {
    const first = (
      await app().inject({ method: 'POST', url: '/api/video/fo4/assets', payload: intro })
    ).json();
    await db().query(
      `UPDATE video_assets SET audio_rel_path = 'fo4/1/source.wav', status = 'uploaded' WHERE id = $1`,
      [first.asset.id],
    );

    const same = (
      await app().inject({ method: 'POST', url: '/api/video/fo4/assets', payload: intro })
    ).json();
    expect(same.asset.id).toBe(first.asset.id);
    expect(same.asset).toMatchObject({ status: 'uploaded', audio_rel_path: 'fo4/1/source.wav' });

    const swapped = (
      await app().inject({
        method: 'POST',
        url: '/api/video/fo4/assets',
        payload: { ...intro, fingerprint: 'def456' },
      })
    ).json();
    expect(swapped.asset.id).toBe(first.asset.id);
    expect(swapped.asset).toMatchObject({ status: 'registered', audio_rel_path: null });
  });

  it('records the dub version the agent wrote into the video', async () => {
    const { asset } = (
      await app().inject({ method: 'POST', url: '/api/video/fo4/assets', payload: intro })
    ).json();
    await db().query(
      `UPDATE video_assets SET dub_rel_path = 'fo4/1/dub_uk.wav', dub_version = 'v2', status = 'dubbed' WHERE id = $1`,
      [asset.id],
    );
    const stale = await app().inject({
      method: 'POST',
      url: `/api/video/fo4/${asset.id}/packed`,
      payload: { dubVersion: 'v1' },
    });
    expect(stale.json()).toEqual({ ok: true, current: false });
    let row = (await app().inject({ method: 'GET', url: `/api/video/fo4/${asset.id}` })).json()
      .asset;
    expect(row).toMatchObject({ status: 'dubbed', packed_version: 'v1' });

    const current = await app().inject({
      method: 'POST',
      url: `/api/video/fo4/${asset.id}/packed`,
      payload: { dubVersion: 'v2' },
    });
    expect(current.json()).toEqual({ ok: true, current: true });
    row = (await app().inject({ method: 'GET', url: `/api/video/fo4/${asset.id}` })).json().asset;
    expect(row).toMatchObject({ status: 'packed', packed_version: 'v2' });

    const bad = await app().inject({
      method: 'POST',
      url: `/api/video/fo4/${asset.id}/packed`,
      payload: {},
    });
    expect(bad.statusCode).toBe(400);
  });

  it('refuses bad input', async () => {
    const bad = await app().inject({
      method: 'POST',
      url: '/api/video/fo4/assets',
      payload: { ...intro, fileName: 'Video/Intro.bk2' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatch(/bare file name/);

    expect((await app().inject({ method: 'GET', url: '/api/video/disco' })).statusCode).toBe(404);
    expect((await app().inject({ method: 'GET', url: '/api/video/fo4/abc' })).statusCode).toBe(400);
    expect((await app().inject({ method: 'GET', url: '/api/video/fo4/999' })).statusCode).toBe(404);
    expect(
      (await app().inject({ method: 'GET', url: '/api/video/fo4/1/audio/mix' })).statusCode,
    ).toBe(400);
  });
});
