import { afterAll, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const uploads = fs.mkdtempSync(path.join(os.tmpdir(), 'video-schema-'));
process.env.VIDEO_UPLOAD_DIR = uploads;

await import('../../games');
const { insertMod, useTestDb } = await import('../../testing/testDb');
const { ensureVideoSchema } = await import('../schema');
const { registerVideoAsset } = await import('../db');

/** The first shape of the tables: keyed by game, the phrases in a synthetic `Video` mod. */
const createLegacyTables = async (db: { query: (sql: string) => Promise<unknown> }) => {
  await db.query(`DROP TABLE IF EXISTS video_segments`);
  await db.query(`DROP TABLE IF EXISTS video_assets`);
  await db.query(`
    CREATE TABLE video_assets (
      id SERIAL PRIMARY KEY,
      game TEXT NOT NULL,
      agent_key TEXT,
      file_name TEXT NOT NULL,
      byte_size BIGINT NOT NULL DEFAULT 0,
      fingerprint TEXT NOT NULL,
      duration_s DOUBLE PRECISION,
      track_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      source_track_id INTEGER,
      audio_rel_path TEXT,
      status TEXT NOT NULL DEFAULT 'registered',
      mod_id INTEGER REFERENCES mods(id) ON DELETE SET NULL,
      dub_rel_path TEXT,
      dub_version TEXT,
      packed_version TEXT,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (game, file_name)
    )`);
  await db.query(`
    CREATE TABLE video_segments (
      id SERIAL PRIMARY KEY,
      video_id INTEGER NOT NULL REFERENCES video_assets(id) ON DELETE CASCADE,
      idx INTEGER NOT NULL,
      start_s DOUBLE PRECISION NOT NULL,
      end_s DOUBLE PRECISION NOT NULL,
      speaker TEXT,
      source_text TEXT NOT NULL DEFAULT '',
      string_id INTEGER REFERENCES strings(id) ON DELETE SET NULL,
      take_rel_path TEXT,
      take_similarity DOUBLE PRECISION,
      take_version TEXT,
      tempo DOUBLE PRECISION,
      overrun BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (video_id, idx)
    )`);
};

describe('ensureVideoSchema', () => {
  const db = useTestDb();
  afterAll(() => fs.rmSync(uploads, { recursive: true, force: true }));

  it('brings a game-keyed database over: phrases into the master, assets dropped, column gone', async () => {
    await createLegacyTables(db());
    const master = await insertMod(db(), { name: 'Fallout4' });
    const { rows: videoMod } = await db().query<{ id: number }>(
      `INSERT INTO mods (name, abs_path, version_hash, game, origin)
       VALUES ('Video', 'video/fo4', 'video:fo4', 'fo4', 'video') RETURNING id`,
    );
    const { rows: asset } = await db().query<{ id: number }>(
      `INSERT INTO video_assets (game, file_name, fingerprint, status, mod_id, audio_rel_path)
       VALUES ('fo4', 'Intro_ru.bk2', 'old', 'dubbed', $1, 'fo4/1/source.wav') RETURNING id`,
      [videoMod[0]!.id],
    );
    await db().query(
      `INSERT INTO video_assets (game, file_name, fingerprint) VALUES ('fo4', 'LUCK.bk2', 'old2')`,
    );
    const stringIds: number[] = [];
    for (const [i, text] of ['War.', 'The end.'].entries()) {
      const { rows: rec } = await db().query<{ id: number }>(
        `INSERT INTO records (mod_id, signature, path, path_simplified, edid, formid_hex)
         VALUES ($1, 'INFO', 'INFO\\NAM1', 'INFO\\NAM1', $2, $3) RETURNING id`,
        [videoMod[0]!.id, `Intro_ru#00${i}`, `V000A000${i}`],
      );
      const { rows: str } = await db().query<{ id: number }>(
        `INSERT INTO strings (record_id, lang, text_raw, text_norm) VALUES ($1, 'en', $2, $2) RETURNING id`,
        [rec[0]!.id, text],
      );
      stringIds.push(str[0]!.id);
      await db().query(
        `INSERT INTO video_segments (video_id, idx, start_s, end_s, source_text, string_id)
         VALUES ($1, $2, 0, 1, $3, $4)`,
        [asset[0]!.id, i, text, str[0]!.id],
      );
    }
    await db().query(
      `INSERT INTO translations (src_string_id, target_lang, text, status) VALUES ($1, 'uk', 'Війна.', 'reviewed')`,
      [stringIds[0]],
    );
    fs.mkdirSync(path.join(uploads, 'fo4', '1'), { recursive: true });
    fs.writeFileSync(path.join(uploads, 'fo4', '1', 'source.wav'), 'x');

    await ensureVideoSchema(db());

    const { rows: records } = await db().query<{
      mod_id: number;
      signature: string;
      path: string;
      formid_hex: string;
      edid: string;
      text: string | null;
    }>(
      `SELECT r.mod_id, r.signature, r.path, r.formid_hex, r.edid, t.text
         FROM records r JOIN strings s ON s.record_id = r.id
         LEFT JOIN translations t ON t.src_string_id = s.id
        ORDER BY r.path`,
    );
    expect(records).toEqual([
      {
        mod_id: master,
        signature: 'VIDEO',
        path: 'VIDEO\\Intro_ru.bk2\\000',
        formid_hex: '',
        edid: 'Intro_ru#000',
        text: 'Війна.',
      },
      {
        mod_id: master,
        signature: 'VIDEO',
        path: 'VIDEO\\Intro_ru.bk2\\001',
        formid_hex: '',
        edid: 'Intro_ru#001',
        text: null,
      },
    ]);
    expect((await db().query(`SELECT 1 FROM video_assets`)).rows).toEqual([]);
    expect((await db().query(`SELECT 1 FROM mods WHERE origin = 'video'`)).rows).toEqual([]);
    expect(
      (
        await db().query(
          `SELECT column_name FROM information_schema.columns WHERE table_name = 'video_assets' AND column_name = 'game'`,
        )
      ).rows,
    ).toEqual([]);
    expect(fs.existsSync(path.join(uploads, 'fo4'))).toBe(false);

    // The new shape works: one row per mod and file, gone with the mod.
    const reg = {
      fileName: 'Intro_ru.bk2',
      byteSize: 1,
      fingerprint: 'new',
      durationS: null,
      trackIds: [0],
      sourceTrackId: 0,
      agentKey: null,
    };
    const first = await registerVideoAsset(db(), master, reg);
    const again = await registerVideoAsset(db(), master, reg);
    expect(again.id).toBe(first.id);
    await db().query(`DELETE FROM mods WHERE id = $1`, [master]);
    expect((await db().query(`SELECT 1 FROM video_assets`)).rows).toEqual([]);
    // Running it again on the new shape is a no-op.
    await ensureVideoSchema(db());
  });
});
