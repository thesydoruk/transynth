import { describe, expect, it } from '@jest/globals';
import { registerCsvFile } from '../csv';
import { registerEetFile } from '../eet';
import { useTestDb } from '../../testing/testDb';
import { buildEet, type EetFixtureRecord } from '../../testing/eetFixture';

const FO4 = { game: 'fo4' } as const;

const gameOf = async (db: () => import('pg').Pool, modId: number | null) =>
  (await db().query<{ game: string }>(`SELECT game FROM mods WHERE id = $1`, [modId])).rows[0]
    ?.game;

const count = async (db: () => import('pg').Pool, table: string) =>
  (await db().query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]!.n;

describe('registering a CSV upload', () => {
  const db = useTestDb();

  const CSV = [
    'FormID,Signature,EDID,Path,Source,Target,Status',
    '01,BOOK,Journal,DESC,"Day one.\nThe raiders came.","День перший.\nПрийшли рейдери.",confirmed',
    '02,NPC_,Sturges,FULL,Sturges,Стерджес,',
  ].join('\n');

  it('sizes the job by records, not lines, and names the mod after the file', async () => {
    const job = await registerCsvFile(db(), 'Settlers.csv', CSV, FO4);

    expect(job).toMatchObject({
      file_name: 'Settlers.csv',
      total_records: 2,
      status: 'pending',
      src_lang: 'en',
      tgt_lang: 'uk',
    });
    const { rows } = await db().query(`SELECT name FROM mods WHERE id = $1`, [job.mod_id]);
    expect(rows).toEqual([{ name: 'Settlers' }]);
  });

  it('returns the same job and mod for the same file uploaded again', async () => {
    const first = await registerCsvFile(db(), 'Settlers.csv', CSV, FO4);
    const again = await registerCsvFile(db(), 'Settlers.csv', CSV, FO4);

    expect(again.id).toBe(first.id);
    expect(await count(db, 'csv_imports')).toBe(1);
    expect(await count(db, 'mods')).toBe(1);
  });

  it('files the mod under the game and languages it was uploaded with', async () => {
    const job = await registerCsvFile(db(), 'Settlers.csv', CSV, {
      game: 'sse',
      srcLang: 'en',
      tgtLang: 'pl',
    });

    expect(job).toMatchObject({ src_lang: 'en', tgt_lang: 'pl' });
    expect(await gameOf(db, job.mod_id)).toBe('sse');
  });

  it('keeps that game when the same file is uploaded again', async () => {
    const first = await registerCsvFile(db(), 'Settlers.csv', CSV, { game: 'sse' });
    await registerCsvFile(db(), 'Settlers.csv', CSV, { game: 'sse' });

    expect(await gameOf(db, first.mod_id)).toBe('sse');
    expect(await count(db, 'mods')).toBe(1);
  });

  it('moves the mod when the same file is uploaded from another game', async () => {
    const first = await registerCsvFile(db(), 'Settlers.csv', CSV, FO4);
    const again = await registerCsvFile(db(), 'Settlers.csv', CSV, { game: 'fo76' });

    expect(again.mod_id).toBe(first.mod_id);
    expect(await gameOf(db, first.mod_id)).toBe('fo76');
  });
});

describe('registering an EET upload', () => {
  const db = useTestDb();

  const RECORDS: EetFixtureRecord[] = [
    {
      signature: 'NPC_',
      formId: '0001F00A',
      edid: 'Sturges',
      field: 'FULL',
      source: 'Sturges',
      target: 'Стерджес',
      status: 0x63,
    },
    {
      signature: 'WEAP',
      formId: '01000FAA',
      edid: 'Pipe',
      field: 'FULL',
      source: 'Pipe Pistol',
      target: '',
    },
    {
      signature: 'MISC',
      formId: '01000FAB',
      edid: 'Can',
      field: 'FULL',
      source: 'Tin Can',
      target: 'Бляшанка',
    },
  ];

  it('counts the records itself when a v1 header does not say how many', async () => {
    const job = await registerEetFile(db(), 'Old.eet', buildEet(RECORDS, { version: 1 }), FO4);

    expect(job).toMatchObject({ file_name: 'Old.eet', total_records: 3, status: 'pending' });
  });

  it('takes the count a v2 header declares', async () => {
    const job = await registerEetFile(db(), 'New.eet', buildEet(RECORDS, { version: 2 }), FO4);

    expect(job.total_records).toBe(3);
  });

  it('returns the same job for the same file uploaded again', async () => {
    const buf = buildEet(RECORDS);
    const first = await registerEetFile(db(), 'Mod.eet', buf, FO4);
    const again = await registerEetFile(db(), 'Mod.eet', buf, FO4);

    expect(again.id).toBe(first.id);
    expect(await count(db, 'eet_imports')).toBe(1);
  });

  it('files the mod under the game and languages it was uploaded with', async () => {
    const job = await registerEetFile(db(), 'Mod.eet', buildEet(RECORDS, { gameName: 'Skyrim' }), {
      game: 'sse',
      srcLang: 'en',
      tgtLang: 'pl',
    });

    expect(job).toMatchObject({ src_lang: 'en', tgt_lang: 'pl' });
    expect(await gameOf(db, job.mod_id)).toBe('sse');
  });

  it('keeps that game when the same file is uploaded again', async () => {
    const buf = buildEet(RECORDS, { gameName: 'Skyrim' });
    const first = await registerEetFile(db(), 'Mod.eet', buf, { game: 'sse' });
    await registerEetFile(db(), 'Mod.eet', buf, { game: 'sse' });

    expect(await gameOf(db, first.mod_id)).toBe('sse');
    expect(await count(db, 'mods')).toBe(1);
  });
});
