#!/usr/bin/env tsx
/**
 * Clear text_stressed rows where letters drifted from translations.text
 * (strip U+0301 ≠ text), even when stress_src_text still equals text.
 *
 * Usage:
 *   npm run stress:clear-drifted -- [--dry-run] [--target-lang uk] [--mod-id N]
 */
import '../src/loadEnv';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { CONFIG, validateConfig } from '../src/config';
import { closeDb, openDb } from '../src/db';
import { log } from '../src/logger';

const argv = await yargs(hideBin(process.argv))
  .scriptName('stress:clear-drifted')
  .option('target-lang', { type: 'string', default: CONFIG.defaultTgtLang })
  .option('mod-id', { type: 'number', describe: 'Limit to one mod' })
  .option('dry-run', { type: 'boolean', default: false })
  .help()
  .parse();

validateConfig();
const db = openDb();

try {
  const targetLang = String(argv['target-lang']).trim().toLowerCase();
  const modId = argv['mod-id'] as number | undefined;

  const { rows } = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n
       FROM translations t
       JOIN strings s ON s.id = t.src_string_id
       JOIN records r ON r.id = s.record_id
      WHERE t.target_lang = $1
        AND t.text_stressed IS NOT NULL
        AND btrim(t.text_stressed) <> ''
        AND replace(t.text_stressed, chr(769), '') IS DISTINCT FROM t.text
        AND ($2::int IS NULL OR r.mod_id = $2)`,
    [targetLang, modId ?? null],
  );
  const n = Number(rows[0]?.n ?? 0);
  log.info(`Drifted stress rows: ${n} (lang=${targetLang}${modId != null ? ` mod=${modId}` : ''})`);
  if (argv['dry-run'] || n === 0) return;

  const { rowCount } = await db.query(
    `UPDATE translations t
        SET text_stressed = NULL,
            stress_src_text = NULL,
            stress_source = NULL,
            updated_at = NOW()
       FROM strings s
       JOIN records r ON r.id = s.record_id
      WHERE t.src_string_id = s.id
        AND t.target_lang = $1
        AND t.text_stressed IS NOT NULL
        AND btrim(t.text_stressed) <> ''
        AND replace(t.text_stressed, chr(769), '') IS DISTINCT FROM t.text
        AND ($2::int IS NULL OR r.mod_id = $2)`,
    [targetLang, modId ?? null],
  );
  log.info(`Cleared ${rowCount ?? 0} drifted stress row(s)`);
} finally {
  await closeDb();
}
