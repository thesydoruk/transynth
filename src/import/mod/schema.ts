import type { Tx } from '../../db';

export const ensureModImportSchema = async (db: Tx) => {
  await db.query('ALTER TABLE mod_imports ADD COLUMN IF NOT EXISTS nexus_mod_id INTEGER');
  await db.query('ALTER TABLE mod_imports ADD COLUMN IF NOT EXISTS source_folder TEXT');
  await db.query('ALTER TABLE mod_imports ADD COLUMN IF NOT EXISTS nexus_mod_name TEXT');
  await db.query('ALTER TABLE mod_imports ADD COLUMN IF NOT EXISTS extract_dir TEXT');
  await db.query('ALTER TABLE mod_imports ADD COLUMN IF NOT EXISTS archive_manifest JSONB');
};
