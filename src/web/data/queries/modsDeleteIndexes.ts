import type { Tx } from '../../../db';

/** Trigram GIN indexes that make bulk DELETE of strings/records extremely slow. */
export const STRING_RECORD_TRGM_INDEXES: ReadonlyArray<{ name: string; createSql: string }> = [
  {
    name: 'idx_strings_trgm_text_norm',
    createSql:
      'CREATE INDEX IF NOT EXISTS idx_strings_trgm_text_norm ON strings USING GIN(text_norm gin_trgm_ops)',
  },
  {
    name: 'idx_strings_trgm_text_raw',
    createSql:
      'CREATE INDEX IF NOT EXISTS idx_strings_trgm_text_raw ON strings USING GIN (text_raw gin_trgm_ops)',
  },
  {
    name: 'idx_records_trgm_signature',
    createSql:
      'CREATE INDEX IF NOT EXISTS idx_records_trgm_signature ON records USING GIN (signature gin_trgm_ops)',
  },
  {
    name: 'idx_records_trgm_formid',
    createSql:
      'CREATE INDEX IF NOT EXISTS idx_records_trgm_formid ON records USING GIN (formid_hex gin_trgm_ops)',
  },
  {
    name: 'idx_records_trgm_edid',
    createSql:
      'CREATE INDEX IF NOT EXISTS idx_records_trgm_edid ON records USING GIN (edid gin_trgm_ops)',
  },
  {
    name: 'idx_records_trgm_path',
    createSql:
      'CREATE INDEX IF NOT EXISTS idx_records_trgm_path ON records USING GIN (path gin_trgm_ops)',
  },
];

/** Drop editor ILIKE indexes for the duration of a large mod purge. */
export const dropStringRecordTrgmIndexes = async (client: Tx): Promise<void> => {
  for (const index of STRING_RECORD_TRGM_INDEXES) {
    await client.query(`DROP INDEX IF EXISTS ${index.name}`);
  }
};

/** Recreate editor ILIKE indexes after a large mod purge. */
export const createStringRecordTrgmIndexes = async (client: Tx): Promise<void> => {
  for (const index of STRING_RECORD_TRGM_INDEXES) {
    await client.query(index.createSql);
  }
};
