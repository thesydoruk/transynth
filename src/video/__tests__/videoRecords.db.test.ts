import { beforeEach, describe, expect, it } from '@jest/globals';
import '../../games';
import { insertMod, insertTranslation, useTestDb } from '../../testing/testDb';
import { registerVideoAsset } from '../db';
import { listVideoSegments, replaceVideoSegments } from '../segments';
import {
  parseVideoPhrasePath,
  syncVideoRecords,
  videoPhraseEdid,
  videoPhrasePath,
  writeVideoPhrases,
} from '../videoRecords';

describe('video records', () => {
  const db = useTestDb();
  let modId: number;
  beforeEach(async () => {
    modId = await insertMod(db(), { name: 'Fallout4' });
  });

  it('names a phrase the way MCM text is named, and reads the name back', () => {
    expect(videoPhrasePath('Intro_ru.bk2', 7)).toBe('VIDEO\\Intro_ru.bk2\\007');
    expect(videoPhraseEdid('Intro_ru.bk2', 7)).toBe('Intro_ru#007');
    expect(parseVideoPhrasePath('VIDEO\\Intro_ru.bk2\\007')).toEqual({
      fileName: 'Intro_ru.bk2',
      idx: 7,
    });
    expect(parseVideoPhrasePath('INFO\\NAM1')).toBeNull();
    expect(parseVideoPhrasePath(null)).toBeNull();
  });

  it('keeps the string of an unchanged phrase, replaces a changed one, drops a gone one', async () => {
    const opts = { modId, fileName: 'Intro_ru.bk2', srcLang: 'en', tgtLang: 'uk' };
    const first = await writeVideoPhrases(db(), opts, [
      { idx: 0, startS: 0, endS: 1, speaker: null, text: 'War.' },
      { idx: 1, startS: 1, endS: 2, speaker: null, text: 'War never changes.' },
      { idx: 2, startS: 2, endS: 3, speaker: null, text: 'The end.' },
    ]);
    expect(first.inserted).toBe(3);
    expect(first.dropped).toBe(0);
    expect([...first.keptRecordKeys]).toEqual([
      'VIDEO\0VIDEO\\Intro_ru.bk2\\000\0',
      'VIDEO\0VIDEO\\Intro_ru.bk2\\001\0',
      'VIDEO\0VIDEO\\Intro_ru.bk2\\002\0',
    ]);
    await insertTranslation(db(), { stringId: first.stringIds.get(0)!, text: 'Війна.' });

    const second = await writeVideoPhrases(db(), opts, [
      { idx: 0, startS: 0, endS: 1, speaker: null, text: 'War.' },
      { idx: 1, startS: 1, endS: 2, speaker: null, text: 'War never, ever changes.' },
    ]);
    expect(second.inserted).toBe(1);
    expect(second.dropped).toBe(2);
    expect(second.stringIds.get(0)).toBe(first.stringIds.get(0));
    expect(second.stringIds.get(1)).not.toBe(first.stringIds.get(1));
    const { rows } = await db().query<{ path: string; text_raw: string }>(
      `SELECT r.path, s.text_raw FROM records r JOIN strings s ON s.record_id = r.id
        WHERE r.mod_id = $1 ORDER BY r.path`,
      [modId],
    );
    expect(rows).toEqual([
      { path: 'VIDEO\\Intro_ru.bk2\\000', text_raw: 'War.' },
      { path: 'VIDEO\\Intro_ru.bk2\\001', text_raw: 'War never, ever changes.' },
    ]);
    // Another video of the same mod is untouched by this one's rewrite.
    await writeVideoPhrases(db(), { ...opts, fileName: 'LUCK.bk2' }, [
      { idx: 0, startS: 0, endS: 1, speaker: null, text: 'Luck.' },
    ]);
    const third = await writeVideoPhrases(db(), opts, [
      { idx: 0, startS: 0, endS: 1, speaker: null, text: 'War.' },
    ]);
    expect(third.dropped).toBe(1);
    const { rows: left } = await db().query(`SELECT path FROM records WHERE mod_id = $1`, [modId]);
    expect(left.map((r: { path: string }) => r.path).sort()).toEqual([
      'VIDEO\\Intro_ru.bk2\\000',
      'VIDEO\\LUCK.bk2\\000',
    ]);
  });

  it('points every segment of an asset at its string', async () => {
    const asset = await registerVideoAsset(db(), modId, {
      fileName: 'Intro_ru.bk2',
      byteSize: 1,
      fingerprint: 'fp',
      durationS: 10,
      trackIds: [0],
      sourceTrackId: 0,
      agentKey: null,
    });
    await replaceVideoSegments(
      db(),
      asset.id,
      [
        { idx: 0, startS: 0, endS: 1, speaker: 'A', text: 'War.' },
        { idx: 1, startS: 1, endS: 2, speaker: 'A', text: 'The end.' },
      ],
      new Map(),
    );
    const sync = await syncVideoRecords(db(), asset, 'en', 'uk');
    const segments = await listVideoSegments(db(), asset.id, 'uk');
    expect(segments.map((s) => s.string_id)).toEqual([
      sync.stringIds.get(0),
      sync.stringIds.get(1),
    ]);
    expect([...sync.keptStringIds].sort()).toEqual([...sync.stringIds.values()].sort());
  });
});
