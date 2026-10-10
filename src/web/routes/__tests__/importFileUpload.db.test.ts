import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, jest } from '@jest/globals';
import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';

// Nothing is queued; an upload only registers a job.
jest.unstable_mockModule('../../../../worker/src/api/importJobs', () => ({
  isImportQueued: async () => false,
  listQueuedImportIds: async () => new Set<number>(),
  cancelQueuedImport: async () => false,
  pauseQueuedImport: async () => false,
}));

// Uploads land in a scratch directory, never in the repo's data/. The setup
// file has already loaded PATHS, so the env vars would come too late; the
// routes read these fields when they load, below.
const { PATHS } = await import('../../../paths');
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'transynth-upload-'));
PATHS.eetUploads = path.join(uploadDir, 'eet');
PATHS.csvUploads = path.join(uploadDir, 'csv');

const { csvRoutes } = await import('../csv');
const { eetRoutes } = await import('../eet');
const { useTestDb } = await import('../../../testing/testDb');
const { useTestApp } = await import('../../../testing/testApp');
const { buildEet } = await import('../../../testing/eetFixture');

const withMultipart = async (app: FastifyInstance) => {
  await app.register(multipart);
};

/** A multipart body with one `file` field, as the browser's FormData sends it. */
const filePart = (fileName: string, content: Buffer | string) => {
  const boundary = '----transynth-test-boundary';
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
        'Content-Type: application/octet-stream\r\n\r\n',
    ),
    Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
};

afterAll(() => {
  fs.rmSync(uploadDir, { recursive: true, force: true });
});

const CSV = [
  'FormID,Signature,EDID,Path,Source,Target,Status',
  '02,NPC_,Sturges,FULL,Sturges,Стерджес,',
].join('\n');

const EET_RECORDS = [
  {
    signature: 'NPC_',
    formId: '0001F00A',
    edid: 'Sturges',
    field: 'FULL',
    source: 'Sturges',
    target: 'Стерджес',
  },
];

describe('POST /api/csv/upload and /api/eet/upload', () => {
  const db = useTestDb();
  const app = useTestApp(db, withMultipart, csvRoutes, eetRoutes);

  const upload = (kind: 'csv' | 'eet', fileName: string, content: Buffer | string, query = '') =>
    app().inject({
      method: 'POST',
      url: `/api/${kind}/upload${query}`,
      ...filePart(fileName, content),
    });

  const modOf = async (modId: number) =>
    (
      await db().query<{ name: string; game: string }>(
        `SELECT name, game FROM mods WHERE id = $1`,
        [modId],
      )
    ).rows[0];

  it.each([
    ['csv', 'Settlers.csv', CSV],
    ['eet', 'Settlers.eet', buildEet(EET_RECORDS, { gameName: 'Skyrim' })],
  ] as const)(
    'files a %s upload under the page game with the page languages',
    async (kind, name, body) => {
      const res = await upload(kind, name, body, '?game=sse&srcLang=en&tgtLang=pl');

      expect(res.statusCode).toBe(201);
      const job = res.json<{ mod_id: number; src_lang: string; tgt_lang: string }>();
      expect(job).toMatchObject({ src_lang: 'en', tgt_lang: 'pl' });
      expect(await modOf(job.mod_id)).toEqual({ name: 'Settlers', game: 'sse' });
    },
  );

  it.each([
    ['csv', 'Old.csv', CSV],
    ['eet', 'Old.eet', buildEet(EET_RECORDS)],
  ] as const)(
    'falls back to the default game for a %s upload without one',
    async (kind, name, body) => {
      const res = await upload(kind, name, body, '?game=nonsense');

      expect(res.statusCode).toBe(201);
      expect((await modOf(res.json<{ mod_id: number }>().mod_id))?.game).toBe('fo4');
    },
  );

  it('refuses an EET file whose header names another game, keeping no file', async () => {
    const res = await upload(
      'eet',
      'Skyrim.eet',
      buildEet(EET_RECORDS, { gameName: 'Skyrim' }),
      '?game=fo4',
    );

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'eet-game-mismatch', fileGame: 'Skyrim' });
    const leftovers = fs
      .readdirSync(PATHS.eetUploads)
      .filter((f) => f === 'Skyrim.eet' || f.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
    expect((await db().query(`SELECT 1 FROM mods`)).rowCount).toBe(0);
  });

  it('leaves an earlier upload of the same name alone when refusing a new one', async () => {
    const original = buildEet(EET_RECORDS);
    expect((await upload('eet', 'Mod.eet', original, '?game=fo4')).statusCode).toBe(201);

    const refused = await upload(
      'eet',
      'Mod.eet',
      buildEet(EET_RECORDS, { gameName: 'Oblivion' }),
      '?game=fo4',
    );

    expect(refused.statusCode).toBe(400);
    expect(fs.readFileSync(path.join(PATHS.eetUploads, 'Mod.eet'))).toEqual(original);
  });

  it('accepts an EET file for another edition of the page game', async () => {
    const res = await upload(
      'eet',
      'Se.eet',
      buildEet(EET_RECORDS, { gameName: 'SkyrimSE' }),
      '?game=sle',
    );

    expect(res.statusCode).toBe(201);
  });
});
