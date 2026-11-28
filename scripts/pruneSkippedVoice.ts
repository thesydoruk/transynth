#!/usr/bin/env tsx
/**
 * Remove synthesized takes of lines TTS no longer speaks — in the mods' own
 * localize trees and in the reference voice store.
 *
 * The skip rules grow (a grunt spelled a new way, a sound label), and the takes
 * made before a rule stay behind: export leaves them out, but they sit on disk,
 * in the editor's dubbed counts and in the store that hands takes to new
 * imports. This removes them. Translations are not touched, and neither are
 * original takes or other languages.
 *
 * Without `--apply` nothing is deleted: the run only counts and shows samples.
 * Do not run it while a voice job is working on the same mod.
 *
 * Usage:
 *   npm run voice:prune-skipped                         # dry run: every mod, then the store
 *   npm run voice:prune-skipped -- --mod=206            # one mod, the store left out
 *   npm run voice:prune-skipped -- --only-reference     # the store alone
 *   npm run voice:prune-skipped -- --apply              # delete
 *   npm run voice:prune-skipped -- --src=en --lang=uk   # languages, when not the defaults
 */
// Registers the game plugins; the registry lookups below depend on it.
import '../src/games';
import '../src/loadEnv';
import { CONFIG } from '../src/config';
import { closeDb, openDb } from '../src/db';
import { pruneSkippedReferenceVoiceTakes } from '../src/voice/pruneReferenceVoiceTakes';
import { pruneSkippedVoiceTakes } from '../src/web/voice/preview/pruneSkippedTakes';

const arg = (name: string): string | undefined => {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
};
const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

const apply = hasFlag('apply');
const onlyModId = arg('mod') ? Number(arg('mod')) : null;
if (onlyModId != null && (!Number.isInteger(onlyModId) || onlyModId <= 0)) {
  console.error('Usage: npm run voice:prune-skipped -- [--mod=ID] [--only-reference] [--apply]');
  process.exit(1);
}
const srcLang = arg('src')?.trim() || CONFIG.defaultSrcLang;
const tgtLang = arg('lang')?.trim() || CONFIG.defaultTgtLang;
const reasons = (byReason: Record<string, number | undefined>): string =>
  Object.entries(byReason)
    .map(([reason, count]) => `${reason} ${count}`)
    .join(', ');

const db = openDb();
try {
  console.log(
    `Prune takes of skipped lines (${srcLang} → ${tgtLang}): ${apply ? 'APPLY' : 'dry run'}`,
  );

  if (!hasFlag('only-reference')) {
    const { rows } = await db.query<{ id: number; name: string }>(
      `SELECT id, name FROM mods
        WHERE abs_path IS NOT NULL AND ($1::int IS NULL OR id = $1)
        ORDER BY id`,
      [onlyModId],
    );
    let lines = 0;
    let takes = 0;
    let stamps = 0;
    for (const mod of rows) {
      let result;
      try {
        result = await pruneSkippedVoiceTakes(db, mod.id, srcLang, tgtLang, { apply });
      } catch (err) {
        console.log(
          `  #${mod.id} ${mod.name}: failed — ${err instanceof Error ? err.message : err}`,
        );
        continue;
      }
      if (!result.ok || result.lines === 0) continue;
      lines += result.lines;
      takes += result.takesRemoved;
      stamps += result.stampsRemoved;
      console.log(
        `  #${mod.id} ${mod.name}: ${result.lines} line(s) [${reasons(result.byReason)}]` +
          (apply
            ? `; removed ${result.takesRemoved} take(s), ${result.stampsRemoved} stamp(s)`
            : ''),
      );
      for (const sample of result.samples) console.log(`      ${sample}`);
    }
    console.log(
      `Mods: ${lines} dubbed line(s) the rules skip` +
        (apply ? `; removed ${takes} take(s), ${stamps} stamp(s)` : ''),
    );
  }

  if (onlyModId == null && !hasFlag('no-reference')) {
    const store = await pruneSkippedReferenceVoiceTakes(db, tgtLang, { apply });
    const games = Object.entries(store.byGame)
      .map(([game, count]) => `${game} ${count}`)
      .join(', ');
    console.log(
      `Reference store: ${store.rows} of ${store.judged} judged row(s), ` +
        `${(store.bytes / 1e6).toFixed(1)} MB [${games}] [${reasons(store.byReason)}]` +
        (apply ? `; removed ${store.rowsRemoved} row(s), ${store.filesRemoved} file(s)` : ''),
    );
    for (const sample of store.samples) console.log(`      ${sample}`);
  }
} finally {
  await closeDb();
}
