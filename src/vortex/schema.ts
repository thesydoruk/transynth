import type { Tx } from '../db';
import { inferModVersionLabel } from './versionLabel';

export const ensureVortexSchema = async (db: Tx): Promise<void> => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS vortex_groups (
      id SERIAL PRIMARY KEY,
      game TEXT NOT NULL DEFAULT 'fo4',
      group_key TEXT NOT NULL,
      label TEXT NOT NULL,
      staging_path TEXT,
      game_dir TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (game, group_key)
    )`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS vortex_game_releases (
      id SERIAL PRIMARY KEY,
      vortex_group_id INTEGER NOT NULL REFERENCES vortex_groups(id) ON DELETE CASCADE,
      version_label TEXT NOT NULL,
      release_hash TEXT NOT NULL,
      is_current BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (vortex_group_id, release_hash)
    )`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS vortex_sync_runs (
      id SERIAL PRIMARY KEY,
      vortex_group_id INTEGER NOT NULL REFERENCES vortex_groups(id) ON DELETE CASCADE,
      game TEXT NOT NULL DEFAULT 'fo4',
      src_lang TEXT NOT NULL DEFAULT 'en',
      tgt_lang TEXT NOT NULL DEFAULT 'uk',
      channel TEXT NOT NULL DEFAULT 'all',
      status TEXT NOT NULL DEFAULT 'planning',
      current_stage TEXT,
      last_completed_stage TEXT,
      current_mod_id INTEGER,
      job_id INTEGER,
      export_archive_id INTEGER,
      error TEXT,
      plan_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await db.query(`ALTER TABLE mods ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'manual'`);
  await db.query(
    `ALTER TABLE mods ADD COLUMN IF NOT EXISTS vortex_group_id INTEGER REFERENCES vortex_groups(id) ON DELETE SET NULL`,
  );
  await db.query(`ALTER TABLE mods ADD COLUMN IF NOT EXISTS channel TEXT`);
  await db.query(
    `ALTER TABLE mods ADD COLUMN IF NOT EXISTS game_release_id INTEGER REFERENCES vortex_game_releases(id) ON DELETE SET NULL`,
  );
  await db.query(
    `ALTER TABLE mod_imports ADD COLUMN IF NOT EXISTS vortex_group_id INTEGER REFERENCES vortex_groups(id) ON DELETE SET NULL`,
  );
  await db.query(`DROP INDEX IF EXISTS idx_mods_name_version`);
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_mods_name_version_manual
      ON mods(name, version_hash) WHERE vortex_group_id IS NULL`);
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_mods_name_version_vortex
      ON mods(vortex_group_id, name, version_hash) WHERE vortex_group_id IS NOT NULL`);
  await db.query(`ALTER TABLE mods ADD COLUMN IF NOT EXISTS version_label TEXT`);
  await db.query(
    `ALTER TABLE mods ADD COLUMN IF NOT EXISTS is_current BOOLEAN NOT NULL DEFAULT TRUE`,
  );
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_mods_vortex_current
      ON mods(vortex_group_id, is_current) WHERE vortex_group_id IS NOT NULL`);
  await backfillVortexModVersions(db);
};

const backfillVortexModVersions = async (db: Tx): Promise<void> => {
  const { rows } = await db.query<{
    id: number;
    channel: string | null;
    version_hash: string | null;
    version_label: string | null;
    source_folder: string | null;
    release_label: string | null;
  }>(
    `SELECT m.id, m.channel, m.version_hash, m.version_label,
            i.source_folder, r.version_label AS release_label
     FROM mods m
     LEFT JOIN LATERAL (
       SELECT source_folder FROM mod_imports
       WHERE mod_id = m.id ORDER BY id DESC LIMIT 1
     ) i ON TRUE
     LEFT JOIN vortex_game_releases r ON r.id = m.game_release_id
     WHERE m.vortex_group_id IS NOT NULL
       AND (m.version_label IS NULL OR btrim(m.version_label) = '')`,
  );
  for (const row of rows) {
    const label = inferModVersionLabel({
      sourceFolder: row.source_folder,
      channel: row.channel === 'game' ? 'game' : 'mods',
      gameReleaseLabel: row.release_label,
      contentHash: row.version_hash,
    });
    await db.query(`UPDATE mods SET version_label = $2 WHERE id = $1`, [row.id, label]);
  }

  await db.query(
    `UPDATE mods m SET is_current = r.is_current
     FROM vortex_game_releases r
     WHERE m.game_release_id = r.id
       AND m.is_current IS DISTINCT FROM r.is_current`,
  );
};
