#!/usr/bin/env tsx
/**
 * Copy the current takes of live mods into the reference voice store.
 *
 * Synthesis keeps every new take there as it is written; this covers the takes
 * made before the store existed. A take is copied when its file is on disk and
 * its stamp is the one the line's present text gives; a stale take says older
 * words and is left out. The store keeps the better-scored take per key, so the
 * run is safe to repeat.
 *
 * Usage:
 *   npm run voice:reference:backfill -- --all
 *   npm run voice:reference:backfill -- --mod 33 --mod 101
 *   npm run voice:reference:backfill -- --mod 33,101 --lang uk --dry-run
 */
// Registers the game plugins; the registry lookups below depend on it.
import '../src/games';
import '../src/loadEnv';
import { CONFIG } from '../src/config';
import { closeDb, openDb } from '../src/db';
import { gamePlugin } from '../src/games/registry';
import { snapshotModVoiceToReference } from '../src/voice/reuseReferenceVoiceTakes';

/** Every value of `--name v`, `--name=v`, repeated or comma-separated. */
const argValues = (name: string): string[] => {
  const out: string[] = [];
  const argv = process.argv.slice(2);
  argv.forEach((value, index) => {
    if (value === `--${name}`) out.push(argv[index + 1] ?? '');
    else if (value.startsWith(`--${name}=`)) out.push(value.slice(name.length + 3));
  });
  return out
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);
};

const all = process.argv.includes('--all');
const dryRun = process.argv.includes('--dry-run');
const lang = (argValues('lang')[0] ?? CONFIG.defaultTgtLang).toLowerCase();
const modIds = argValues('mod').map(Number);

if (modIds.some((id) => !Number.isInteger(id) || id < 1) || all === modIds.length > 0) {
  console.error(
    'Usage: voice:reference:backfill -- (--mod <id>[,<id>…] … | --all) [--lang <code>] [--dry-run]',
  );
  process.exit(1);
}

const db = openDb();
try {
  const { rows: mods } = await db.query<{ id: number; name: string; game: string | null }>(
    `SELECT m.id, m.name, m.game
       FROM mods m
      WHERE ($1::int[] IS NULL OR m.id = ANY($1::int[]))
        AND EXISTS (SELECT 1 FROM voice_synthesis_state v
                     WHERE v.mod_id = m.id AND v.target_lang = $2)
      ORDER BY m.id`,
    [all ? null : modIds, lang],
  );
  const voiced = mods.filter((mod) => gamePlugin(mod.game).voice);
  console.log(
    `Reference voice backfill: ${voiced.length} mod(s), lang=${lang}${dryRun ? ', dry run' : ''}`,
  );
  const total = { saved: 0, keptExisting: 0, skippedStale: 0, noSourceHash: 0, failed: 0 };
  for (const mod of voiced) {
    const result = await snapshotModVoiceToReference(db, mod.id, lang, { dryRun });
    console.log(
      `#${mod.id} ${mod.name}: saved ${result.saved}, kept-existing ${result.keptExisting}, ` +
        `skipped-stale ${result.skippedStale}, no-source-hash ${result.noSourceHash}` +
        (result.failed > 0 ? `, failed ${result.failed}` : ''),
    );
    for (const key of Object.keys(total) as Array<keyof typeof total>) total[key] += result[key];
  }
  console.log(
    `Total: saved ${total.saved}, kept-existing ${total.keptExisting}, ` +
      `skipped-stale ${total.skippedStale}, no-source-hash ${total.noSourceHash}` +
      (total.failed > 0 ? `, failed ${total.failed}` : ''),
  );
} finally {
  await closeDb();
}
