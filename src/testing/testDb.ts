/**
 * Helpers for tests that run SQL against a real Postgres (`*.db.test.ts`).
 *
 * A test file calls {@link useTestDb} once; every test then starts on empty
 * tables and builds the rows it needs with the small fixture builders below.
 * They insert exactly what an import would — no more — so a query under test
 * sees realistic rows without a whole plugin being parsed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach } from '@jest/globals';
import type pg from 'pg';
import { closeDb, openDb, runSchema } from '../db';
import { normalizeForHash, normalizeNoPunct } from '../utils/textNorm';

const SCHEMA_SQL = fs.readFileSync(path.resolve('sql/schema.sql'), 'utf8');

/**
 * Apply the schema before the file's tests, empty every table before each
 * test, close the pool after. Returns a getter for the pool.
 */
export const useTestDb = (): (() => pg.Pool) => {
  let tables: string[] = [];

  beforeAll(async () => {
    const db = openDb();
    // Every file applies it; all but the first find it in place, which is
    // exactly what a second `npm run db:init` does.
    await runSchema(db, SCHEMA_SQL);
    const { rows } = await db.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    );
    tables = rows.map((r) => `"${r.tablename}"`);
  }, 60_000);

  beforeEach(async () => {
    await openDb().query(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
  });

  afterAll(async () => {
    await closeDb();
  });

  return () => openDb();
};

type ModFixture = {
  name?: string;
  game?: string;
  versionHash?: string;
  absPath?: string | null;
};

let modCounter = 0;

export const insertMod = async (db: pg.Pool, fixture: ModFixture = {}): Promise<number> => {
  // Name + version is unique (idx_mods_name_version_manual), so the default is too.
  modCounter++;
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO mods(name, game, version_hash, abs_path) VALUES ($1, $2, $3, $4) RETURNING id`,
    [
      fixture.name ?? `Test Mod ${modCounter}`,
      fixture.game ?? 'fo4',
      fixture.versionHash ?? 'v1',
      fixture.absPath ?? null,
    ],
  );
  return rows[0]!.id;
};

type StringFixture = {
  modId: number;
  text: string;
  formid?: string;
  signature?: string;
  path?: string;
  edid?: string | null;
  lang?: string;
};

/** One record and its source string, normalised the way the importer does it. */
export const insertString = async (db: pg.Pool, fixture: StringFixture): Promise<number> => {
  const signature = fixture.signature ?? 'NPC_';
  const recordPath = fixture.path ?? `${signature}\\FULL`;
  const { rows: rec } = await db.query<{ id: number }>(
    `INSERT INTO records(mod_id, formid_hex, signature, path, edid)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [fixture.modId, fixture.formid ?? '', signature, recordPath, fixture.edid ?? null],
  );
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO strings(record_id, lang, text_raw, text_norm, text_norm_nopunct)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      rec[0]!.id,
      fixture.lang ?? 'en',
      fixture.text,
      normalizeForHash(fixture.text),
      normalizeNoPunct(fixture.text),
    ],
  );
  return rows[0]!.id;
};

type TranslationFixture = {
  stringId: number;
  text: string;
  status?: string;
  targetLang?: string;
  provenance?: string;
};

export const insertTranslation = async (
  db: pg.Pool,
  fixture: TranslationFixture,
): Promise<number> => {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO translations(src_string_id, target_lang, text, status, provenance, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING id`,
    [
      fixture.stringId,
      fixture.targetLang ?? 'uk',
      fixture.text,
      fixture.status ?? 'reviewed',
      fixture.provenance ?? 'human_edit',
    ],
  );
  return rows[0]!.id;
};

/** The one translation a string holds in a language, or null. */
export const translationOf = async (
  db: pg.Pool,
  stringId: number,
  targetLang = 'uk',
): Promise<{ text: string; status: string; provenance: string | null } | null> => {
  const { rows } = await db.query<{ text: string; status: string; provenance: string | null }>(
    `SELECT text, status, provenance FROM translations
      WHERE src_string_id = $1 AND target_lang = $2`,
    [stringId, targetLang],
  );
  return rows[0] ?? null;
};

/**
 * Poll until `check` returns a value other than null/undefined/false — for
 * work the code under test starts fire-and-forget.
 */
export const waitFor = async <T>(
  check: () => Promise<T | null | undefined | false>,
  timeoutMs = 3000,
): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== null && value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error(`waitFor: condition not met in ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};
