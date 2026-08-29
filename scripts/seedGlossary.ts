#!/usr/bin/env tsx
/**
 * Seed the canonical Fallout 4 EN→UK glossary into the `glossary` table.
 *
 * Idempotent: re-running upserts every entry (ON CONFLICT DO UPDATE), so the
 * curated terms in `src/resources/glossary/fo4-uk.ts` are always the source of
 * truth. Manually-added terms (`source = 'manual'`) are left untouched.
 *
 * Usage:
 *   npm run db:seed:glossary
 *
 * No CLI flags. Requires an initialized database (`npm run db:init`).
 */
import '../src/loadEnv';
import { openDb, closeDb } from '../src/db';
import { log } from '../src/logger';
import { FO4_UK_GLOSSARY } from '../src/resources/glossary/fo4-uk';

const SRC_LANG = 'en';
const TGT_LANG = 'uk';
const SOURCE = 'seed:fo4-base';

const db = openDb();

let inserted = 0;
let updated = 0;
let skippedManual = 0;

for (const { term, translation } of FO4_UK_GLOSSARY) {
  const cleanTerm = term.trim();
  const cleanTranslation = translation.trim();
  if (!cleanTerm || !cleanTranslation) continue;

  // Never clobber a translator's manual override; only seed/refresh seed rows.
  const { rows } = await db.query(
    `INSERT INTO glossary(term, translation, src_lang, tgt_lang, source)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT(term, src_lang, tgt_lang) DO UPDATE
       SET translation = EXCLUDED.translation,
           source = EXCLUDED.source
       WHERE glossary.source <> 'manual'
     RETURNING (xmax = 0) AS inserted`,
    [cleanTerm, cleanTranslation, SRC_LANG, TGT_LANG, SOURCE],
  );

  if (rows.length === 0) {
    skippedManual++;
  } else if (rows[0].inserted) {
    inserted++;
  } else {
    updated++;
  }
}

log.info(
  `Glossary seed complete: ${FO4_UK_GLOSSARY.length} terms — ` +
    `inserted=${inserted}, updated=${updated}, skipped(manual)=${skippedManual}`,
);

await closeDb();
