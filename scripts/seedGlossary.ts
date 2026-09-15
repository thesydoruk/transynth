#!/usr/bin/env tsx
/**
 * Seed canonical EN→UK glossaries into the `glossary` table, one game at a time.
 *
 * Idempotent: re-running upserts every entry (ON CONFLICT DO UPDATE), so the
 * curated lists in `src/resources/glossary/*-uk.ts` stay the source of truth.
 * Manually-added terms (`source = 'manual'`) are left untouched.
 *
 * Usage:
 *   npm run db:seed:glossary
 *
 * No CLI flags. Requires an initialized database (`npm run db:init`).
 */
// Registers the game plugins; the registry lookups below depend on it.
import '../src/games';
import '../src/loadEnv';
import { openDb, closeDb } from '../src/db';
import { log } from '../src/logger';
import { gameUkGlossaries } from '../src/resources/glossary';

const SRC_LANG = 'en';
const TGT_LANG = 'uk';

const db = openDb();

let inserted = 0;
let updated = 0;
let skippedManual = 0;

// Keyed by storage key, so editions that share a list are already deduped.
for (const [game, entries] of gameUkGlossaries()) {
  const source = `seed:${game}-base`;
  for (const { term, translation } of entries) {
    const cleanTerm = term.trim();
    const cleanTranslation = translation.trim();
    if (!cleanTerm || !cleanTranslation) continue;

    const { rows } = await db.query(
      `INSERT INTO glossary(term, translation, src_lang, tgt_lang, game, source)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT(term, src_lang, tgt_lang, game) DO UPDATE
         SET translation = EXCLUDED.translation,
             source = EXCLUDED.source
         WHERE glossary.source <> 'manual'
       RETURNING (xmax = 0) AS inserted`,
      [cleanTerm, cleanTranslation, SRC_LANG, TGT_LANG, game, source],
    );

    if (rows.length === 0) {
      skippedManual++;
    } else if (rows[0].inserted) {
      inserted++;
    } else {
      updated++;
    }
  }
}

log.info(
  `Glossary seed complete — inserted=${inserted}, updated=${updated}, skipped(manual)=${skippedManual}`,
);

await closeDb();
