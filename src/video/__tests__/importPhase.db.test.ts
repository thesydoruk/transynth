import { afterAll, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const uploads = fs.mkdtempSync(path.join(os.tmpdir(), 'video-import-'));
process.env.VIDEO_UPLOAD_DIR = uploads;

await import('../../games');
const { insertMod, insertTranslation, useTestDb } = await import('../../testing/testDb');
const { getVideoAsset, listVideoAssets, registerVideoAsset, setVideoAssetAudio } =
  await import('../db');
const { resolveVideoAudioPath, videoAudioRelPath, videoAssetRelDir } =
  await import('../audioStore');
const { importVideoManifests, videoModDir } = await import('../importPhase');
const { listVideoSegments, replaceVideoSegments } = await import('../segments');
const { syncVideoRecords } = await import('../videoRecords');
type ModImportRunContext = import('../../games/contract').ModImportRunContext;

const sha1 = 'b'.repeat(40);

const writeWav = (rel: string): void => {
  const file = resolveVideoAudioPath(rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `wav:${rel}`);
};

const contextFor = (
  db: ReturnType<ReturnType<typeof useTestDb>>,
  modId: number,
  anchorPath: string,
): ModImportRunContext =>
  ({
    db,
    job: { id: 1, tgt_lang: 'uk', src_lang: 'en' },
    state: { cancel: false, pause: false },
    anchorPath,
    game: 'fo4',
    importModId: modId,
    imported: { value: 0 },
    progressTotal: { value: 0 },
    pluginStringLang: 'en',
    importSingleLocaleMode: { value: false },
    selectedLocale: { value: null },
    pruneStaleImportData: true,
    keptImportRecordKeys: new Set<string>(),
    keptImportStringIds: new Set<number>(),
    startTime: Date.now(),
  }) as unknown as ModImportRunContext;

describe('importVideoManifests', () => {
  const db = useTestDb();
  afterAll(() => fs.rmSync(uploads, { recursive: true, force: true }));

  let modDir: string;
  beforeEach(() => {
    modDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-mod-'));
    fs.mkdirSync(path.join(modDir, 'Video'));
    fs.writeFileSync(
      path.join(modDir, 'Video', 'Intro_ru.bk2.video.json'),
      JSON.stringify({
        fileName: 'Intro_ru.bk2',
        byteSize: 42,
        sha1,
        durationS: 164.5,
        trackIds: [0, 1],
        sourceTrackId: 0,
        agentKey: 'pc',
      }),
    );
  });

  it('finds the video folder beside a plugin anchor and above a manifest anchor', () => {
    expect(videoModDir(path.join(modDir, 'Fallout4.esm'), modDir)).toBe(modDir);
    expect(videoModDir(path.join(modDir, 'Video', 'Intro_ru.bk2.video.json'), 'x')).toBe(modDir);
  });

  it('registers a new video from its manifest and tracks nothing to keep yet', async () => {
    const modId = await insertMod(db(), { name: 'Fallout4' });
    const ctx = contextFor(db(), modId, path.join(modDir, 'Fallout4.esm'));
    expect(await importVideoManifests(ctx, modDir)).toBe(1);
    const [asset] = await listVideoAssets(db(), modId);
    expect(asset).toMatchObject({
      file_name: 'Intro_ru.bk2',
      byte_size: 42,
      fingerprint: sha1,
      duration_s: 164.5,
      track_ids: [0, 1],
      source_track_id: 0,
      agent_key: 'pc',
      status: 'registered',
      audio_rel_path: null,
    });
    expect(ctx.keptImportRecordKeys.size).toBe(0);
    // Running the import again for the same mod version changes nothing.
    expect(await importVideoManifests(ctx, modDir)).toBe(1);
    expect((await listVideoAssets(db(), modId)).map((a) => a.id)).toEqual([asset!.id]);
  });

  it('carries the separation, the takes and the dub over from the previous version of the mod', async () => {
    // The previous version: separated, two phrases, one take, a dub already packed.
    const oldMod = await insertMod(db(), { name: 'Fallout4', versionHash: 'v1' });
    const old = await registerVideoAsset(db(), oldMod, {
      fileName: 'Intro_ru.bk2',
      byteSize: 42,
      fingerprint: sha1,
      durationS: 164.5,
      trackIds: [0, 1],
      sourceTrackId: 0,
      agentKey: 'pc',
    });
    for (const kind of ['source', 'speech', 'background'] as const) {
      writeWav(videoAudioRelPath(old, kind));
    }
    await setVideoAssetAudio(db(), old.id, videoAudioRelPath(old, 'source'));
    await replaceVideoSegments(
      db(),
      old.id,
      [
        { idx: 0, startS: 1, endS: 2, speaker: 'A', text: 'War.' },
        { idx: 1, startS: 3, endS: 5, speaker: 'A', text: 'The end.' },
      ],
      new Map(),
    );
    const oldSync = await syncVideoRecords(db(), old, 'en', 'uk');
    await insertTranslation(db(), { stringId: oldSync.stringIds.get(0)!, text: 'Війна.' });
    const takeRel = path.join(videoAssetRelDir(old), 'takes', '0000.wav');
    writeWav(takeRel);
    await db().query(
      `UPDATE video_segments SET take_rel_path = $2, take_similarity = 0.5, take_version = 'tv', tempo = 1
        WHERE video_id = $1 AND idx = 0`,
      [old.id, takeRel],
    );
    const dubRel = videoAudioRelPath(old, 'dub', 'uk');
    writeWav(dubRel);
    await db().query(
      `UPDATE video_assets SET status = 'packed', dub_rel_path = $2, dub_version = 'dv', packed_version = 'dv'
        WHERE id = $1`,
      [old.id, dubRel],
    );

    // The new version imports the same manifest.
    const newMod = await insertMod(db(), { name: 'Fallout4', versionHash: 'v2' });
    const ctx = contextFor(db(), newMod, path.join(modDir, 'Fallout4.esm'));
    await importVideoManifests(ctx, modDir);
    const [asset] = await listVideoAssets(db(), newMod);
    expect(asset).toMatchObject({
      status: 'packed',
      audio_rel_path: videoAudioRelPath(old, 'source'),
      dub_version: 'dv',
      packed_version: 'dv',
    });
    expect(asset!.dub_rel_path).toBe(videoAudioRelPath(asset!, 'dub', 'uk'));
    expect(fs.existsSync(resolveVideoAudioPath(asset!.dub_rel_path!))).toBe(true);

    const segments = await listVideoSegments(db(), asset!.id, 'uk');
    expect(segments.map((s) => [s.idx, s.source_text, s.take_version, s.take_similarity])).toEqual([
      [0, 'War.', 'tv', 0.5],
      [1, 'The end.', null, null],
    ]);
    // The take now lives in the new asset's own folder; the old one is still there.
    expect(segments[0]!.take_rel_path).toBe(
      path.join(videoAssetRelDir(asset!), 'takes', '0000.wav'),
    );
    expect(fs.existsSync(resolveVideoAudioPath(segments[0]!.take_rel_path!))).toBe(true);
    expect(fs.existsSync(resolveVideoAudioPath(takeRel))).toBe(true);

    // The phrases are records of the new mod, keyed like the old ones, and the import keeps them.
    const { rows } = await db().query<{ path: string; string_id: number }>(
      `SELECT r.path, s.id AS string_id FROM records r JOIN strings s ON s.record_id = r.id
        WHERE r.mod_id = $1 ORDER BY r.path`,
      [newMod],
    );
    expect(rows.map((r) => r.path)).toEqual([
      'VIDEO\\Intro_ru.bk2\\000',
      'VIDEO\\Intro_ru.bk2\\001',
    ]);
    expect(segments.map((s) => s.string_id)).toEqual(rows.map((r) => r.string_id));
    expect([...ctx.keptImportRecordKeys]).toEqual([
      'VIDEO\0VIDEO\\Intro_ru.bk2\\000\0',
      'VIDEO\0VIDEO\\Intro_ru.bk2\\001\0',
    ]);
    expect([...ctx.keptImportStringIds].sort()).toEqual(rows.map((r) => r.string_id).sort());
    // The old version is as it was.
    expect((await getVideoAsset(db(), old.id))!.status).toBe('packed');
  });

  it('ignores a manifest that is not one', async () => {
    fs.writeFileSync(path.join(modDir, 'Video', 'Broken.bk2.video.json'), '{"fileName":"x/y"}');
    const modId = await insertMod(db(), { name: 'Fallout4' });
    const ctx = contextFor(db(), modId, path.join(modDir, 'Fallout4.esm'));
    expect(await importVideoManifests(ctx, modDir)).toBe(1);
    expect((await listVideoAssets(db(), modId)).map((a) => a.file_name)).toEqual(['Intro_ru.bk2']);
  });
});
